/**
 * Sunday-morning summary cron — once a week, fires Sunday 04:00 UTC =
 * 07:00 Israel time (IDT). Sends each admin a count of unclaimed pickups
 * for the upcoming week + a link to /admin/unassigned for one-tap cleanup.
 *
 * Configured in vercel.json: `0 4 * * 0` (Sunday 04:00 UTC).
 *
 * Hobby plan: once-per-day max — the schedule is the gate, no per-minute
 * time check inside the handler.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailProvider } from '@/lib/notify';
import { buildPaulaSundaySummary } from '@/lib/summaries';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id');
  const results: any[] = [];

  for (const h of households ?? []) {
    // Find admins for this household
    const { data: members } = await sb
      .from('household_members')
      .select('profiles:user_id(id, full_name, email, email_enabled)')
      .eq('household_id', h.id)
      .eq('role', 'admin');
    const admins = (members ?? []).map((m: any) => m.profiles).filter(Boolean);

    for (const a of admins) {
      if (!a.email || a.email_enabled === false) continue;
      const firstName = (a.full_name ?? '').split(' ')[0] || 'there';
      const { subject, body } = await buildPaulaSundaySummary(sb, h.id, firstName);
      const r = await emailProvider.send({ to: a.email, subject, body });
      results.push({ to: a.email, ok: !r.error });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}
