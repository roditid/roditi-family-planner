/**
 * Weekly invite cron — Saturday 07:00 UTC = 10:00 Israel (IDT).
 *
 * Two messages fire:
 *   1. Each grandparent gets an email with their /i/{token} portal link.
 *   2. Admins (Paula, Dani) get a "Helper roundup" email with a tap-to-
 *      WhatsApp button that pre-fills a generic group-chat nudge — they
 *      can forward it to the family group with one tap.
 *
 * Configured in vercel.json: `0 7 * * 6`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendInvitesForHousehold } from '@/app/_actions/invites';
import { emailProvider } from '@/lib/notify';
import { buildFullWeekSummary } from '@/lib/summaries';
import { demoMode } from '@/lib/demo-session';
import { DEMO } from '@/lib/demo-store';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results: any[] = [];

  if (demoMode()) {
    const sent = await sendInvitesForHousehold(DEMO.householdId);
    return NextResponse.json({ ran_at: now.toISOString(), sent });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id, timezone');

  for (const h of households ?? []) {
    const sent = await sendInvitesForHousehold(h.id);
    const adminRoundup = await sendAdminHelperRoundup(sb, h.id);
    results.push({ household: h.id, sent, adminRoundup });
  }

  return NextResponse.json({ ran_at: now.toISOString(), results });
}

/**
 * Send the admin "Helper roundup" email with one tap-to-WhatsApp button
 * pre-filled for the family group chat. wa.me without a phone opens the
 * recipient picker with the message text already in the box — Dani/Paula
 * pick the group and tap send.
 */
async function sendAdminHelperRoundup(sb: any, householdId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  const summary = await buildFullWeekSummary(sb, householdId);

  const { data: members } = await sb
    .from('household_members')
    .select('role, profiles:user_id(id, full_name, email, email_enabled)')
    .eq('household_id', householdId)
    .eq('role', 'admin');
  const admins = (members ?? [])
    .map((m: any) => m.profiles)
    .filter((p: any) => p && p.email && p.email_enabled !== false);
  if (admins.length === 0) return { sent: 0 };

  // Generic group-chat nudge — no recipient pre-set, so the admin picks
  // the family group on their phone. wa.me/?text=... opens WhatsApp with
  // the text in the compose box.
  const groupMessage =
    `Hi family ❤️\n\n` +
    `This week's pickups are up. ${summary.unclaimedCount} of ${summary.totalCount} still need a helper.\n\n` +
    `Check your email for your personal link, or open the schedule at ${baseUrl}.\n\n` +
    `Try to claim what fits your week by tonight 🙏`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(groupMessage)}`;

  const subject = `Saturday roundup — ${summary.unclaimedCount} pickup${summary.unclaimedCount === 1 ? '' : 's'} need a helper`;
  const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
    `<p>The grandparents just got their personal claim links by email.</p>` +
    `<p>Forward the family group chat the nudge below to keep everyone in sync:</p>` +
    `<p style="margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Share to family group on WhatsApp →</a></p>` +
    `<pre style="background:#f6f3ec;padding:14px;border-radius:8px;font:14px/1.5 system-ui;white-space:pre-wrap;margin-top:1.5em">${escapeHtml(summary.body)}</pre>` +
    `<p style="margin-top:1.5em">Open the dashboard: <a href="${baseUrl}/home">${baseUrl}/home</a></p>` +
    `</div>`;
  const body = `${groupMessage}\n\n---\n\n${summary.body}\n\nOpen the dashboard: ${baseUrl}/home`;

  let sent = 0;
  for (const a of admins) {
    const r = await emailProvider.send({ to: a.email, subject, body, html });
    if (!r.error) sent++;
  }
  return { sent };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
