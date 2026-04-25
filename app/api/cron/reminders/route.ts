import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailProvider, renderReminder } from '@/lib/notify';
import { fetchSlots } from '@/lib/slots';
import { format, toZonedTime } from 'date-fns-tz';

/**
 * Cron endpoint — fires morning reminders for all households.
 *
 * Guard: requires ?secret=<CRON_SECRET>. Configure in Vercel Cron:
 *   crons: [{ path: '/api/cron/reminders?secret=...', schedule: '* * * * *' }]
 * The endpoint itself checks each household's configured send time + timezone
 * and only fires when the current minute in that timezone matches.
 *
 * For each helper with an active assignment for today, send their reminder
 * via the configured provider. Records every attempt in notification_logs.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: households } = await sb.from('households').select('id, timezone');
  const { data: settings } = await sb.from('reminder_settings').select('*');
  const now = new Date();
  const results: any[] = [];

  for (const h of households ?? []) {
    const s = (settings ?? []).find((x) => x.household_id === h.id);
    const tz = s?.timezone ?? h.timezone;
    const localNow = toZonedTime(now, tz);
    const hhmm = format(localNow, 'HH:mm', { timeZone: tz });
    const sendAt = (s?.morning_send_time ?? '07:30').slice(0, 5);
    if (hhmm !== sendAt) {
      results.push({ household: h.id, skipped: `not yet (${hhmm} !== ${sendAt})` });
      continue;
    }
    const today = format(localNow, 'yyyy-MM-dd', { timeZone: tz });
    const tomorrow = format(new Date(localNow.getTime() + 86400_000), 'yyyy-MM-dd', { timeZone: tz });
    const slots = await fetchSlots(sb, h.id, today, tomorrow);

    for (const slot of slots) {
      if (!slot.assignment?.profile) continue;
      if (slot.reminder_sent_at) continue;
      const profile = slot.assignment.profile;
      if (!profile.email_enabled || !profile.email) continue;

      const { subject, body } = renderReminder(slot);
      const send = await emailProvider.send({ to: profile.email, subject, body });

      await sb.from('notification_logs').insert({
        household_id: h.id,
        pickup_slot_id: slot.id,
        to_user_id: profile.id,
        channel: 'email',
        to_address: profile.email,
        subject,
        body,
        status: send.error ? 'failed' : 'sent',
        provider_id: send.id,
        error: send.error,
        sent_at: send.error ? null : new Date().toISOString(),
      });

      if (!send.error) {
        await sb.from('pickup_slots').update({ reminder_sent_at: new Date().toISOString() }).eq('id', slot.id);
      }
      results.push({ household: h.id, slot: slot.id, to: profile.email, status: send.error ? 'failed' : 'sent' });
    }

    // Parent fallback: if there are still unclaimed slots today and the setting is on, poke admins.
    if (s?.parent_fallback_alert) {
      const orphans = slots.filter((x) => x.status === 'unclaimed');
      if (orphans.length) {
        const { data: admins } = await sb
          .from('household_members')
          .select('profiles:user_id(*)')
          .eq('household_id', h.id)
          .eq('role', 'admin');
        for (const a of admins ?? []) {
          const p: any = (a as any).profiles;
          if (!p?.email) continue;
          await emailProvider.send({
            to: p.email,
            subject: `Pickup Planner: ${orphans.length} unclaimed pickup${orphans.length > 1 ? 's' : ''} today`,
            body: `Today still has ${orphans.length} unclaimed pickup(s):\n\n` +
              orphans.map((o) => `• ${o.child.name} at ${o.pickup_time.slice(0, 5)} — ${o.title}`).join('\n'),
          });
        }
      }
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), results });
}
