/**
 * Evening backpack + prep-day cron — runs daily at 17:00 UTC = 20:00 IL.
 *
 * Two messages can fire from this single cron, in priority order:
 *
 *   1. Backpack reminder (Paula + Liezel) — "tomorrow's backpacks". Built
 *      from per-activity pack_list values + per-event pack_notes.
 *
 *   2. Prep-day list (Paula only, with a one-tap WhatsApp link to forward
 *      to Liezel) — built from the description of any "prep day for
 *      tomorrow" calendar event found by the importer. The link uses
 *      wa.me deep-linking so Paula can fire the WhatsApp message herself
 *      without us needing Twilio. Liezel's number is read from her profile.
 *
 * Both messages are skipped silently when their source data is empty so
 * we don't train the household to ignore the channel.
 *
 * Configured in vercel.json: `0 17 * * *`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendAndLog } from '@/lib/notify-log';
import { buildBackpackReminder, buildPrepDayMessage } from '@/lib/summaries';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id');
  const results: any[] = [];

  for (const h of households ?? []) {
    const householdResults: any = { household: h.id, backpack_sent: 0, prep_sent: 0 };

    // Pull household members once
    const { data: members } = await sb
      .from('household_members')
      .select('role, helper_kind, profiles:user_id(id, full_name, email, phone_number, email_enabled)')
      .eq('household_id', h.id);

    const admins = (members ?? [])
      .filter((m: any) => m.role === 'admin')
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.email && p.email_enabled !== false);

    const liezel = (members ?? [])
      .filter((m: any) => m.helper_kind === 'nanny')
      .map((m: any) => m.profiles)
      .find((p: any) => p && (p.full_name ?? '').toLowerCase().startsWith('liezel'));

    // ── 1. Backpack reminder — Paula's choice is WhatsApp, but automated
    // outbound WhatsApp needs Twilio. Same pattern as prep-day: admins
    // get an email with a tap-and-send wa.me button to forward to Liezel.
    // No more crowding Liezel's inbox; she gets the WhatsApp she expects
    // once Paula taps the button.
    const backpack = await buildBackpackReminder(sb, h.id);
    if (backpack) {
      const liezelPhone = (liezel?.phone_number ?? '').replace(/[^\d]/g, '');
      const waHref = liezelPhone
        ? `https://wa.me/${liezelPhone}?text=${encodeURIComponent(backpack.body)}`
        : null;
      const html = `<pre style="font:16px/1.5 system-ui">${escapeHtml(backpack.body)}</pre>` +
        (waHref ? `<p style="font:14px/1.5 system-ui;margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Send to Liezel on WhatsApp →</a></p>` : '');
      for (const a of admins) {
        const r = await sendAndLog(sb, {
          household_id: h.id,
          to: a.email,
          subject: backpack.subject,
          body: backpack.body + (waHref ? `\n\nTap to send to Liezel on WhatsApp:\n${waHref}` : ''),
          html,
        });
        if (!r.error) householdResults.backpack_sent++;
      }
    }

    // ── 2. Prep-day list — Paula gets it with a tap-to-WhatsApp-Liezel link.
    const prep = await buildPrepDayMessage(sb, h.id);
    if (prep) {
      const liezelPhone = (liezel?.phone_number ?? '').replace(/[^\d]/g, '');
      const waHref = liezelPhone
        ? `https://wa.me/${liezelPhone}?text=${encodeURIComponent(prep.body)}`
        : null;
      const html = `<pre style="font:16px/1.5 system-ui">${escapeHtml(prep.body)}</pre>` +
        (waHref ? `<p style="font:14px/1.5 system-ui;margin-top:1.5em"><a href="${waHref}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Send to Liezel on WhatsApp →</a></p>` : '');
      for (const a of admins) {
        const r = await sendAndLog(sb, {
          household_id: h.id,
          to: a.email,
          subject: prep.subject,
          body: prep.body + (waHref ? `\n\nTap to send to Liezel on WhatsApp:\n${waHref}` : ''),
          html,
        });
        if (!r.error) householdResults.prep_sent++;
      }
    }

    results.push(householdResults);
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
