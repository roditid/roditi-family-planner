/**
 * Weekly invite cron — fires every minute, only sends when the current
 * minute in each household's timezone matches `weekly_invite_day` and
 * `weekly_invite_time`.
 *
 * Sends each helper their personal magic-link URL.
 *
 * Configure in vercel.json (or any cron service):
 *   schedule: every minute, path: /api/cron/saturday-invites?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { format, toZonedTime } from 'date-fns-tz';
import { sendInvitesForHousehold } from '@/app/_actions/invites';
import { demoMode } from '@/lib/demo-session';
import { DEMO, getReminderSettings } from '@/lib/demo-store';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results: any[] = [];

  if (demoMode()) {
    const r = getReminderSettings();
    const tz = r.timezone;
    const local = toZonedTime(now, tz);
    const hhmm = format(local, 'HH:mm', { timeZone: tz });
    const dow = local.getDay(); // 0=Sun..6=Sat
    const want = (r as any).weekly_invite_day ?? 6;
    const wantTime = ((r as any).weekly_invite_time ?? '09:00').slice(0, 5);
    if (dow !== want || hhmm !== wantTime) {
      return NextResponse.json({ ran_at: now.toISOString(), skipped: `not Saturday at ${wantTime}` });
    }
    const sent = await sendInvitesForHousehold(DEMO.householdId);
    return NextResponse.json({ ran_at: now.toISOString(), sent });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id, timezone');
  const { data: settings } = await sb.from('reminder_settings').select('*');

  for (const h of households ?? []) {
    const s = (settings ?? []).find((x) => x.household_id === h.id);
    const tz = s?.timezone ?? h.timezone;
    const local = toZonedTime(now, tz);
    const hhmm = format(local, 'HH:mm', { timeZone: tz });
    const dow = local.getDay();
    const wantDow = s?.weekly_invite_day ?? 6;
    const wantTime = (s?.weekly_invite_time ?? '09:00').slice(0, 5);
    if (dow !== wantDow || hhmm !== wantTime) {
      results.push({ household: h.id, skipped: `not yet (${dow} ${hhmm})` });
      continue;
    }
    const sent = await sendInvitesForHousehold(h.id);
    results.push({ household: h.id, sent });
  }

  return NextResponse.json({ ran_at: now.toISOString(), results });
}
