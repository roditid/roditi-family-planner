'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode } from '@/lib/demo-session';
import { allUsers, DEMO } from '@/lib/demo-store';
import { emailProvider } from '@/lib/notify';
import { sendAndLog, logNotification } from '@/lib/notify-log';
import { buildFullWeekSummary } from '@/lib/summaries';

/**
 * Send everyone their personal link by email. Used by:
 *   - the "Send now" button on /admin/invites
 *   - the Saturday cron at /api/cron/saturday-invites
 */
export async function sendInvitesNowAction() {
  const ctx = await requireAdmin();
  await sendInvitesForHousehold(ctx.household!.id);
  revalidatePath('/admin/invites');
}


/**
 * Send the weekly invite to helpers. By default targets grandparents only —
 * Liezel and the parents fill the gaps via /admin/unassigned, they don't
 * need a "claim what you want" prompt.
 *
 * Pass `{ kinds: ['grandparent', 'nanny', 'other'] }` to widen the audience
 * for the manual "Send invites now" admin button.
 */
export async function sendInvitesForHousehold(
  householdId: string,
  options: { kinds?: string[] } = {}
) {
  const kinds = options.kinds ?? ['grandparent']; // Saturday-cron default
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

  type Row = { id: string; full_name: string; email: string | null; magic_token: string | null; helper_kind?: string | null };
  let helpers: Row[] = [];

  if (demoMode()) {
    helpers = allUsers()
      .filter((u) => u.role === 'helper')
      .map((u: any) => ({ id: u.id, full_name: u.full_name, email: u.email, magic_token: u.magic_token, helper_kind: u.helper_kind }));
  } else {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('household_members')
      .select('helper_kind, profiles:user_id(id, full_name, email, magic_token)')
      .eq('household_id', householdId)
      .eq('role', 'helper');
    helpers = (data ?? []).map((m: any) => ({ ...m.profiles, helper_kind: m.helper_kind })) as Row[];
  }

  // Filter to the requested helper kinds
  helpers = helpers.filter((h) => kinds.includes(h.helper_kind ?? 'other'));

  const familyPwd = process.env.FAMILY_PASSWORD;
  const sb = demoMode() ? null : supabaseAdmin();

  const sent: { to: string; ok: boolean; error?: string }[] = [];
  for (const h of helpers) {
    if (!h.email) continue;
    // Backfill: a helper without a magic_token can't be invited via
    // the personal link. Generate one on the fly so the very first
    // Saturday email lands a working URL — no manual setup needed.
    if (!h.magic_token) {
      if (!sb) continue; // demo mode: just skip
      const newToken = `tok-${randomBytes(8).toString('hex')}`;
      await sb.from('profiles').update({
        magic_token: newToken,
        token_issued_at: new Date().toISOString(),
      }).eq('id', h.id);
      h.magic_token = newToken;
    }
    const url = `${baseUrl}/i/${h.magic_token}`;
    const fName = firstName(h.full_name);
    const subject = `${fName}, can you help with pickups this week?`;
    const lines = [
      `Hi ${fName},`,
      ``,
      `Here are next week's pickup options for your beautiful grandchildren. Tap your link to see what's available and claim any that work for you:`,
      ``,
      url,
      ``,
    ];
    if (familyPwd) {
      lines.push(`When prompted for the family password, please enter:`);
      lines.push(familyPwd);
      lines.push(``);
    }
    lines.push(`If you can, please claim your pickups by tonight so we can finalize the schedule. Anything you don't claim will be covered by Paula and Liezel.`);
    lines.push(``);
    lines.push(`Thank you so much for always being there and helping us — we truly appreciate it.`);
    lines.push(``);
    lines.push(`Love,`);
    lines.push(`The Roditi family`);
    const body = lines.join('\n');
    const r = sb
      ? await sendAndLog(sb, { household_id: householdId, to: h.email, subject, body })
      : await emailProvider.send({ to: h.email, subject, body });
    sent.push({
      to: h.email,
      ok: !r.error,
      error: r.error ? String((r.error as any)?.message ?? r.error) : undefined,
    });

    if (sb) {
      await sb.from('profiles').update({ last_invite_sent_at: new Date().toISOString() }).eq('id', h.id);
    }
  }
  return sent;
}

/**
 * Saturday admin "Helper roundup" — same email the Saturday cron sends
 * to admins, exposed as a function so a manual button can fire it too.
 * Pulled out of the cron handler so /admin/invites can re-run it on
 * demand (e.g. when a deploy lands after the cron's window).
 *
 * The family password lives in the WhatsApp share message (which goes
 * to the family group) but NOT in the email body itself — admins know
 * the password and don't need it repeated to them.
 */
export async function sendAdminHelperRoundup(householdId: string) {
  if (demoMode()) return { sent: 0 };
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  const familyPwd = process.env.FAMILY_PASSWORD;
  const sb = supabaseAdmin();
  const summary = await buildFullWeekSummary(sb, householdId);

  // Pull kids' names so the email reads "Adam, Liam and Yali's
  // grandparents…" rather than the generic "the grandparents…".
  const { data: kidRows } = await sb
    .from('children')
    .select('name')
    .eq('household_id', householdId)
    .order('name');
  const kidNames = (kidRows ?? []).map((k: any) => k.name);
  const kidsList = formatNameList(kidNames);

  const { data: members } = await sb
    .from('household_members')
    .select('role, profiles:user_id(id, full_name, email, email_enabled)')
    .eq('household_id', householdId)
    .eq('role', 'admin');
  const admins = (members ?? [])
    .map((m: any) => m.profiles)
    .filter((p: any) => p && p.email && p.email_enabled !== false);
  if (admins.length === 0) return { sent: 0 };

  // The WhatsApp message (sent to the family group) DOES include the
  // password — that's the whole point of forwarding it.
  const groupMessage =
    `Hi family ❤️\n\n` +
    `This week's pickups are up. ${summary.unclaimedCount} of ${summary.totalCount} still need a helper.\n\n` +
    `Check your email for your personal link, or open the schedule at ${baseUrl}.\n\n` +
    (familyPwd ? `Family password: ${familyPwd}\n\n` : '') +
    `Please try to claim what fits your week by tonight 🙏`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(groupMessage)}`;

  const subject = `Saturday roundup — ${summary.unclaimedCount} pickup${summary.unclaimedCount === 1 ? '' : 's'} need a helper`;
  const grandparentsLine = kidsList
    ? `${escapeHtml(kidsList)}'s grandparents just got their personal claim links via email.`
    : `The grandparents just got their personal claim links via email.`;
  const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
    `<p>${grandparentsLine}</p>` +
    `<p><b>${summary.unclaimedCount}</b> of ${summary.totalCount} pickup${summary.totalCount === 1 ? '' : 's'} need a helper this week.</p>` +
    `<p>Forward this nudge to the family group chat so everyone sees it:</p>` +
    `<p style="margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Share to family group on WhatsApp →</a></p>` +
    `<p style="color:#888;font-size:13px;margin-top:1.5em">You'll get the full week breakdown tomorrow morning — the Sunday recap. For now, just nudge the family.</p>` +
    `<p style="margin-top:1.5em">Open the dashboard: <a href="${baseUrl}/home">${baseUrl}/home</a></p>` +
    `</div>`;
  const grandparentsLineText = kidsList
    ? `${kidsList}'s grandparents just got their personal claim links via email.`
    : `The grandparents just got their personal claim links via email.`;
  const body = `${grandparentsLineText}\n\n` +
    `${summary.unclaimedCount} of ${summary.totalCount} pickups need a helper this week.\n\n` +
    `Forward this nudge to the family group chat so everyone sees it:\n${waHref}\n\n` +
    `You'll get the full week breakdown tomorrow morning — the Sunday recap. For now, just nudge the family.\n\n` +
    `Open the dashboard: ${baseUrl}/home`;

  let sent = 0;
  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const a of admins) {
    const r = await sendAndLog(sb, { household_id: householdId, to: a.email, subject, body, html });
    if (!r.error) sent++;
    results.push({
      to: a.email,
      ok: !r.error,
      error: r.error ? String((r.error as any)?.message ?? r.error) : undefined,
    });
  }
  await logNotification(sb, {
    household_id: householdId,
    kind: 'wa_link_built',
    channel: 'whatsapp',
    recipient: '-',
    subject: 'Saturday family-group roundup link',
  });
  return { sent, results };
}

function firstName(s: string) { return (s ?? '').split(' ')[0] || 'there'; }
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
/** Format ['Adam','Liam','Yali'] → "Adam, Liam and Yali". */
function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
