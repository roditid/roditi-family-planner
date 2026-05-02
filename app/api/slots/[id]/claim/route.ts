import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';
import { claimSlot } from '@/lib/demo-store';
import { recordEvent } from '@/lib/events';
import { DEMO } from '@/lib/demo-store';
import { emailProvider, renderClaimConfirmation } from '@/lib/notify';
import { updateEventTitleForClaim, addAttendeeToEvent } from '@/lib/google/calendar';
import { sendLiezelSummaryUpdate } from '@/lib/notify-liezel';
import { sendAdminClaimUpdate } from '@/lib/notify-admins';

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

  // pickup_slots.status flip needs the admin client. RLS on pickup_slots
  // only allows admins to write — without service-role here, a helper's
  // claim would silently leave slot.status='unclaimed' and the chip
  // would render as "open" for everyone except the helper who claimed
  // it. We also use the admin client for the assignment swap so the
  // override-then-insert sequence isn't blocked by RLS.
  const admin = supabaseAdmin();

  // Idempotent claim: there's a unique constraint on slot_assignments
  // ("one_active") preventing two active rows per slot. If someone else
  // (or a previous-claim path that didn't release) already has it, we
  // override their row first. If the same user is already on it, we
  // no-op. Without this, the second claim hit the DB with a duplicate-
  // key error and the rest of the flow (confirmation email, .ics,
  // admin notification) never ran.
  const { data: existing } = await admin
    .from('slot_assignments')
    .select('id, assigned_to_user_id')
    .eq('pickup_slot_id', params.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing?.assigned_to_user_id === user.id) {
    // Already claimed by this user — nothing to do, but make sure the
    // slot.status reflects it.
    await admin.from('pickup_slots').update({ status: 'claimed' }).eq('id', params.id);
    return NextResponse.json({ ok: true, idempotent: true });
  }
  if (existing) {
    await admin
      .from('slot_assignments')
      .update({ status: 'overridden', released_at: new Date().toISOString() })
      .eq('id', existing.id);
  }

  const { error } = await admin.from('slot_assignments').insert({
    pickup_slot_id: params.id,
    assigned_to_user_id: user.id,
    status: 'active',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from('pickup_slots').update({ status: 'claimed' }).eq('id', params.id);

  // Hydrate the slot enough to send a confirmation email + log the event.
  const { data: slot } = await sb
    .from('pickup_slots')
    .select(`
      *,
      child:children(*),
      activity:activities(*),
      pickup_location:pickup_location_id(*),
      via_location:via_location_id(*),
      destination_location:destination_location_id(*)
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (slot?.household_id) {
    await recordEvent({
      householdId: slot.household_id, slotId: params.id,
      actorUserId: user.id, subjectUserId: user.id, kind: 'claimed',
    });
  }

  // Look up the claimer's profile + role once — used by every branch
  // below.
  const { data: profile } = await sb
    .from('profiles')
    .select('full_name, email, email_enabled')
    .eq('id', user.id)
    .maybeSingle();
  const { data: membership } = slot?.household_id
    ? await sb
        .from('household_members')
        .select('role')
        .eq('household_id', slot.household_id)
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null as any };
  const claimerIsAdmin = membership?.role === 'admin';

  // Update the source Google Calendar event's title to "[Helper] …" so
  // both calendars (the household one and the claimer's personal one)
  // show who's on the pickup. For ADMIN claimers, also add their email
  // as a Google Calendar attendee with sendUpdates='none' — that pushes
  // the event onto their personal calendar (paularoditi@gmail.com,
  // daniel@meron.co) without triggering an "event updated" email to
  // anyone else. Helpers stay off the attendee list (they manage their
  // own calendar separately).
  if (slot?.source_event_id) {
    try {
      const firstName = (profile?.full_name ?? '').split(/[\s(]/)[0] || null;
      if (firstName) {
        await updateEventTitleForClaim(sb, slot.household_id, slot.source_event_id, firstName);
      }
      if (claimerIsAdmin && profile?.email) {
        await addAttendeeToEvent(sb, slot.household_id, slot.source_event_id, profile.email, { sendUpdates: 'none' });
      }
    } catch (e) {
      console.error('calendar update failed', e);
    }
  }

  // Send the rich confirmation email to the claimer (admin or helper —
  // same email format). Best-effort; failures don't block the claim.
  try {
    if (slot && profile?.email && profile?.email_enabled !== false) {
      const extraIds = (slot.additional_child_ids as string[] | null) ?? [];
      let additional_children: any[] = [];
      if (extraIds.length > 0) {
        const { data: kids } = await sb.from('children').select('*').in('id', extraIds);
        additional_children = kids ?? [];
      }
      const hydrated = { ...slot, additional_children };
      const { subject, body, html } = renderClaimConfirmation(hydrated as any, profile.full_name ?? null);
      // No .ics attachment — admins are added as Google attendees above
      // (the event lands on their personal calendar natively); helpers
      // don't manage personal calendars for pickups.
      await emailProvider.send({ to: profile.email, subject, body, html });
    }
  } catch (e) {
    console.error('claim confirmation email failed', e);
  }

  // Cross-actor notifications:
  //   • ALWAYS refresh Liezel's weekly summary so she has the current
  //     picture (her email is unaffected by who claimed).
  //   • SKIP the cross-admin claim email when an admin is the actor —
  //     Paula and Dani are independent; Paula's claim shouldn't ping
  //     Dani's inbox and vice versa. Only fire when a HELPER claims,
  //     so admins still see helper claims mid-week.
  if (slot?.household_id) {
    await sendLiezelSummaryUpdate(sb, slot.household_id);
    if (!claimerIsAdmin) {
      const childName = (slot as any).child?.name ?? null;
      const slotLabel = childName
        ? `${childName} · ${slot.title} · ${slot.date} ${(slot.pickup_time as string).slice(0, 5)}`
        : `${slot.title} · ${slot.date} ${(slot.pickup_time as string).slice(0, 5)}`;
      await sendAdminClaimUpdate(sb, slot.household_id, {
        actorName: profile?.full_name?.split(' ')[0] ?? null,
        action: 'claimed',
        slotLabel,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
