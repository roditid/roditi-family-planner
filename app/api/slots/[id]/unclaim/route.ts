import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';
import { unclaimSlot, DEMO } from '@/lib/demo-store';
import { recordEvent } from '@/lib/events';
import { updateEventTitleForClaim } from '@/lib/google/calendar';
import { sendLiezelSummaryUpdate } from '@/lib/notify-liezel';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (demoMode()) {
    const u = demoCurrentUser();
    if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const r = unclaimSlot(params.id, u.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await recordEvent({
      householdId: DEMO.householdId, slotId: params.id,
      actorUserId: u.id, subjectUserId: u.id, kind: 'released',
    });
    return NextResponse.json({ ok: true });
  }

  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { error } = await sb
    .from('slot_assignments')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('pickup_slot_id', params.id)
    .eq('assigned_to_user_id', user.id)
    .eq('status', 'active');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from('pickup_slots').update({ status: 'unclaimed' }).eq('id', params.id);

  const { data: slot } = await sb
    .from('pickup_slots')
    .select('household_id, source_event_id')
    .eq('id', params.id)
    .maybeSingle();
  if (slot?.household_id) {
    await recordEvent({
      householdId: slot.household_id, slotId: params.id,
      actorUserId: user.id, subjectUserId: user.id, kind: 'released',
    });
  }

  // Strip the "[Helper]" prefix from the calendar event title.
  if (slot?.source_event_id) {
    try {
      await updateEventTitleForClaim(sb, slot.household_id, slot.source_event_id, null);
    } catch (e) {
      console.error('calendar event title revert failed', e);
    }
  }

  // Refresh Liezel's weekly summary.
  if (slot?.household_id) await sendLiezelSummaryUpdate(sb, slot.household_id);

  return NextResponse.json({ ok: true });
}
