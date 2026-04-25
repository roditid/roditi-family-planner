import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';
import { claimSlot } from '@/lib/demo-store';
import { recordEvent } from '@/lib/events';
import { DEMO } from '@/lib/demo-store';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (demoMode()) {
    const u = demoCurrentUser();
    if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const r = claimSlot(params.id, u.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await recordEvent({
      householdId: DEMO.householdId, slotId: params.id,
      actorUserId: u.id, subjectUserId: u.id, kind: 'claimed',
    });
    return NextResponse.json({ ok: true });
  }

  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { error } = await sb.from('slot_assignments').insert({
    pickup_slot_id: params.id,
    assigned_to_user_id: user.id,
    status: 'active',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from('pickup_slots').update({ status: 'claimed' }).eq('id', params.id);

  // Find household for the event
  const { data: slot } = await sb.from('pickup_slots').select('household_id').eq('id', params.id).maybeSingle();
  if (slot?.household_id) {
    await recordEvent({
      householdId: slot.household_id, slotId: params.id,
      actorUserId: user.id, subjectUserId: user.id, kind: 'claimed',
    });
  }
  return NextResponse.json({ ok: true });
}
