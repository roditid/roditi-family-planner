/**
 * Weekly invite cron — fires once per Saturday from Vercel Cron (06:00 UTC =
 * 09:00 Israel time IDT). Sends each helper their personal magic-link URL.
 *
 * Configured in vercel.json: `0 6 * * 6` (Saturday 06:00 UTC).
 *
 * Hobby plan caps cron at once-per-day, so we always send when invoked
 * (no per-minute time-check) — the Vercel schedule itself is the gate.
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
    const sent = await sendInvitesForHousehold(DEMO.householdId);
    return NextResponse.json({ ran_at: now.toISOString(), sent });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id, timezone');

  for (const h of households ?? []) {
    const sent = await sendInvitesForHousehold(h.id);
    results.push({ household: h.id, sent });
  }

  return NextResponse.json({ ran_at: now.toISOString(), results });
}
