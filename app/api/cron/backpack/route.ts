/**
 * Evening backpack reminder cron — runs daily at 17:00 UTC = 20:00 Israel
 * time (IDT). Looks at tomorrow's pickups and emails Paula + Liezel a
 * consolidated list of what each kid needs in their backpack.
 *
 * Sends nothing on quiet days (no pickups, or no pack-list items on any
 * pickup) so we don't train the household to ignore the channel.
 *
 * Configured in vercel.json: `0 17 * * *`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailProvider } from '@/lib/notify';
import { buildBackpackReminder } from '@/lib/summaries';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id');
  const results: any[] = [];

  for (const h of households ?? []) {
    const message = await buildBackpackReminder(sb, h.id);
    if (!message) {
      results.push({ household: h.id, sent: 0, reason: 'nothing to pack' });
      continue;
    }

    // Recipients: every admin + every helper with helper_kind='nanny'
    // (Paula and Liezel for the Roditi family).
    const { data: members } = await sb
      .from('household_members')
      .select('role, helper_kind, profiles:user_id(id, full_name, email, email_enabled)')
      .eq('household_id', h.id);

    const targets = (members ?? [])
      .filter((m: any) => m.role === 'admin' || m.helper_kind === 'nanny')
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.email && p.email_enabled !== false);

    let sent = 0;
    for (const t of targets) {
      const r = await emailProvider.send({ to: t.email, subject: message.subject, body: message.body });
      if (!r.error) sent++;
    }
    results.push({ household: h.id, sent });
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}
