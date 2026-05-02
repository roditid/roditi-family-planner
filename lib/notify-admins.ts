/**
 * Admin claim-update notifier.
 *
 * Anytime a slot is claimed / unclaimed / reassigned, every admin in the
 * household gets an email with the full updated week summary plus a
 * tap-to-WhatsApp button to forward to Liezel. This is the mid-week
 * "claim update" flow (#4 in the design).
 *
 * Best-effort and silent on failure.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { sendAndLog, logNotification } from './notify-log';
import { buildFullWeekSummary } from './summaries';

export async function sendAdminClaimUpdate(
  sb: SupabaseClient,
  householdId: string,
  context: { actorName?: string | null; action: 'claimed' | 'unclaimed' | 'reassigned'; slotLabel?: string | null }
) {
  try {
    // Suppression window: between Saturday 10:00 IL (when the helper
    // roundup fires) and Sunday 07:00 IL (when the full week recap
    // lands). In that window we still want admins to know a claim
    // happened — just without spamming them the full week summary +
    // Liezel forward button (Liezel gets her own summary on Sunday).
    const isLite = isInSuppressionWindow();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
    // Skip the expensive summary query when running lite — we don't
    // include the breakdown in the email anyway.
    const summary = isLite ? null : await buildFullWeekSummary(sb, householdId);

    const { data: members } = await sb
      .from('household_members')
      .select('helper_kind, role, profiles:user_id(id, full_name, email, email_enabled, phone_number)')
      .eq('household_id', householdId);
    const admins = (members ?? [])
      .filter((m: any) => m.role === 'admin')
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.email && p.email_enabled !== false);
    const liezel = (members ?? [])
      .filter((m: any) => m.helper_kind === 'nanny')
      .map((m: any) => m.profiles)
      .find((p: any) => p && (p.full_name ?? '').toLowerCase().startsWith('liezel'));
    const liezelPhone = (liezel?.phone_number ?? '').replace(/[^\d]/g, '');
    const waHref = !isLite && liezelPhone && summary
      ? `https://wa.me/${liezelPhone}?text=${encodeURIComponent(summary.body)}`
      : null;

    const verb = context.action === 'claimed' ? 'claimed'
               : context.action === 'unclaimed' ? 'released'
               : 'reassigned';
    const headline = context.actorName && context.slotLabel
      ? `${context.actorName} ${verb} ${context.slotLabel}.`
      : context.actorName
        ? `${context.actorName} ${verb} a pickup.`
        : `An assignment changed.`;

    // Subject uses the descriptive form too — "Paula reassigned Adam ·
    // Soccer · 16:15" rather than a generic "Pickup reassigned". Both
    // lite (suppression window) and full modes share the subject; the
    // body content is what differs.
    const subject = context.actorName && context.slotLabel
      ? `${context.actorName} ${verb} ${context.slotLabel}`
      : context.actorName
        ? `${context.actorName} ${verb} a pickup`
        : `A pickup ${context.action === 'claimed' ? 'was claimed' : context.action === 'unclaimed' ? 'was released' : 'was reassigned'}`;

    const html = isLite
      ? `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
        `<p>${escapeHtml(headline)}</p>` +
        `<p style="color:#777;font-size:13px">You'll get the full week summary tomorrow morning in the Sunday recap. This is just a heads-up so you know the assignment changed.</p>` +
        `<p style="margin-top:1.5em"><a href="${baseUrl}/home" style="display:inline-block;background:#5C7A5F;color:#FBF6EC;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Open ${baseUrl.replace(/^https?:\/\//, '')}/home →</a></p>` +
        `</div>`
      : `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
        `<p>${escapeHtml(headline)}</p>` +
        `<p>Updated week summary below. Open the dashboard:</p>` +
        `<p><a href="${baseUrl}/home" style="display:inline-block;background:#5C7A5F;color:#FBF6EC;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">${baseUrl.replace(/^https?:\/\//, '')}/home →</a></p>` +
        `<pre style="background:#f6f3ec;padding:14px;border-radius:8px;font:14px/1.5 system-ui;white-space:pre-wrap;margin-top:1.5em">${escapeHtml(summary!.body)}</pre>` +
        (waHref ? `<p style="margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Forward to Liezel on WhatsApp →</a></p>` : '') +
        `</div>`;

    const body = isLite
      ? `${headline}\n\nYou'll get the full week summary tomorrow morning in the Sunday recap.\n\nOpen the dashboard: ${baseUrl}/home`
      : `${headline}\n\nUpdated week summary:\n\n${summary!.body}\n\nOpen the dashboard: ${baseUrl}/home` +
        (waHref ? `\n\nForward to Liezel on WhatsApp:\n${waHref}` : '');

    for (const a of admins) {
      await sendAndLog(sb, {
        household_id: householdId,
        to: a.email,
        subject,
        body: body.replace(/\n\nFamily password.*$/m, ''),
        html,
      });
    }
    if (waHref) {
      await logNotification(sb, {
        household_id: householdId,
        kind: 'wa_link_built',
        channel: 'whatsapp',
        recipient: liezelPhone,
        subject: `Mid-week update (${context.action})`,
      });
    }
  } catch (e) {
    console.error('admin claim-update notify failed', e);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** True between Saturday 10:00 IL and Sunday 07:00 IL — i.e., the
 *  window when the Saturday roundup has fired but the Sunday recap
 *  hasn't yet. We suppress mid-week claim emails to admins during
 *  this stretch so Paula's inbox stays quiet until Sunday morning. */
function isInSuppressionWindow(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  if (weekday === 'Sat' && hour >= 10) return true;
  if (weekday === 'Sun' && hour < 7) return true;
  return false;
}
