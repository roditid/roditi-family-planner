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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
    const summary = await buildFullWeekSummary(sb, householdId);

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
    const waHref = liezelPhone
      ? `https://wa.me/${liezelPhone}?text=${encodeURIComponent(summary.body)}`
      : null;

    const verb = context.action === 'claimed' ? 'claimed'
               : context.action === 'unclaimed' ? 'released'
               : 'was reassigned';
    const headline = context.actorName && context.slotLabel
      ? `${context.actorName} ${verb} ${context.slotLabel}.`
      : `An assignment changed.`;

    const subject = `Pickup update — ${summary.unclaimedCount} of ${summary.totalCount} open`;
    const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
      `<p>${escapeHtml(headline)}</p>` +
      `<p>Updated week summary below. Open the dashboard:</p>` +
      `<p><a href="${baseUrl}/home" style="display:inline-block;background:#5C7A5F;color:#FBF6EC;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">${baseUrl.replace(/^https?:\/\//, '')}/home →</a></p>` +
      `<pre style="background:#f6f3ec;padding:14px;border-radius:8px;font:14px/1.5 system-ui;white-space:pre-wrap;margin-top:1.5em">${escapeHtml(summary.body)}</pre>` +
      (waHref ? `<p style="margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Forward to Liezel on WhatsApp →</a></p>` : '') +
      `</div>`;
    const body = `${headline}\n\nUpdated week summary:\n\n${summary.body}\n\nOpen the dashboard: ${baseUrl}/home` +
      (waHref ? `\n\nForward to Liezel on WhatsApp:\n${waHref}` : '');

    for (const a of admins) {
      await sendAndLog(sb, {
        household_id: householdId,
        to: a.email,
        subject,
        body,
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
