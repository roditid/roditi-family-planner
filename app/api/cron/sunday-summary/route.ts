/**
 * Sunday-morning summary cron — Sunday 04:00 UTC = 07:00 Israel (IDT).
 *
 * Sends each admin the FULL weekly schedule (every pickup, claimed or
 * open, with the assignee shown). The email also has a tap-to-WhatsApp
 * button to forward the same summary to Liezel once Paula has finished
 * sorting out the unassigned ones — that's flow #3 from the design.
 *
 * Configured in vercel.json: `0 4 * * 0`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendAndLog, logNotification } from '@/lib/notify-log';
import { buildFullWeekSummary } from '@/lib/summaries';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  const familyPwd = process.env.FAMILY_PASSWORD;
  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id');
  const results: any[] = [];

  for (const h of households ?? []) {
    const summary = await buildFullWeekSummary(sb, h.id);

    const { data: members } = await sb
      .from('household_members')
      .select('helper_kind, role, profiles:user_id(id, full_name, email, email_enabled, phone_number)')
      .eq('household_id', h.id);
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

    for (const a of admins) {
      const firstName = (a.full_name ?? '').split(' ')[0] || 'there';
      // Note: family password intentionally NOT in the body — admins
      // know it. The password lives in the WhatsApp share message that
      // goes to the family group.
      const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
        `<p>Good morning, ${escapeHtml(firstName)}.</p>` +
        `<p>${summary.unclaimedCount === 0 ? 'Every pickup this week has a helper — no sorting needed.' : `<b>${summary.unclaimedCount}</b> of ${summary.totalCount} pickup${summary.totalCount === 1 ? '' : 's'} still need a helper. Open the dashboard to assign:`}</p>` +
        `<p><a href="${baseUrl}/home" style="display:inline-block;background:#5C7A5F;color:#FBF6EC;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Open ${baseUrl.replace(/^https?:\/\//, '')}/home →</a></p>` +
        `<pre style="background:#f6f3ec;padding:14px;border-radius:8px;font:14px/1.5 system-ui;white-space:pre-wrap;margin-top:1.5em">${escapeHtml(summary.body)}</pre>` +
        (waHref ? `<p style="margin-top:1.5em"><b>Don't forget to send the weekly summary to Liezel once everything is assigned:</b></p>` +
          `<p><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Send weekly summary to Liezel on WhatsApp →</a></p>` : '') +
        `</div>`;
      const body = `Good morning, ${firstName}.\n\n` +
        (summary.unclaimedCount === 0
          ? 'Every pickup this week has a helper — no sorting needed.'
          : `${summary.unclaimedCount} of ${summary.totalCount} pickups still need a helper.`) +
        `\n\nOpen the dashboard: ${baseUrl}/home` +
        `\n\n${summary.body}` +
        (waHref ? `\n\n---\n\nDon't forget to send the weekly summary to Liezel once everything is assigned:\n${waHref}` : '');
      const r = await sendAndLog(sb, {
        household_id: h.id,
        to: a.email,
        subject: `Sunday recap — ${summary.unclaimedCount} of ${summary.totalCount} need a helper`,
        body,
        html,
      });
      results.push({ to: a.email, ok: !r.error });
      if (waHref) {
        await logNotification(sb, {
          household_id: h.id,
          kind: 'wa_link_built',
          channel: 'whatsapp',
          recipient: liezelPhone,
          subject: 'Sunday weekly summary (forward link)',
        });
      }
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
