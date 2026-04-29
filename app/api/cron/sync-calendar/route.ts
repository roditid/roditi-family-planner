/**
 * Calendar auto-sync cron — runs once a day.
 *
 * Polls every household's connected calendar and reflects edits Paula
 * made in Google Calendar (e.g. adding a "[Levanah] Soccer - Liam"
 * prefix to claim a slot, or a new "Liam - gan until 12:30" early-
 * dismissal event) onto the website without requiring an admin to
 * press "Sync now".
 *
 * Configured in vercel.json: 03:00 UTC daily (Vercel Hobby caps cron
 * frequency at once-per-day; on Pro this would be every 1-4 hours).
 *
 * This is a stopgap until we wire Google Calendar push notifications
 * (webhooks) for true live sync — captured in the roadmap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncCalendar } from '@/lib/google/calendar';
import { generateDefaultSlots } from '@/lib/defaults';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id');
  const results: any[] = [];

  for (const h of households ?? []) {
    try {
      const sync = await syncCalendar(sb, h.id, 30);
      const defaults = await generateDefaultSlots(sb, h.id, 30);
      results.push({
        household: h.id,
        events: sync.eventsSeen,
        slots: sync.slotsCreated,
        defaults: defaults.slotsCreated,
      });
    } catch (e: any) {
      results.push({ household: h.id, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}
