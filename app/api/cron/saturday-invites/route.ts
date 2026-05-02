/**
 * Weekly invite cron — Saturday 07:00 UTC = 10:00 Israel (IDT).
 *
 * Two messages fire:
 *   1. Each grandparent gets an email with their /i/{token} portal link
 *      and the family password.
 *   2. Admins (Paula, Dani) get a "Helper roundup" email at the same
 *      time with a one-tap WhatsApp button that opens the family-
 *      group-chat compose pre-filled with a generic nudge + the family
 *      password to share.
 *
 * Configured in vercel.json: `0 7 * * 6`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendInvitesForHousehold, sendAdminHelperRoundup } from '@/app/_actions/invites';
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
    const adminRoundup = await sendAdminHelperRoundup(h.id);
    results.push({ household: h.id, sent, adminRoundup });
  }

  return NextResponse.json({ ran_at: now.toISOString(), results });
}
