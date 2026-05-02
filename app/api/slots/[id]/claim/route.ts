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

  const { error } = await sb.from('slot_assignments').insert({
    pickup_slot_id: params.id,
    assigned_to_user_id: user.id,
    status: 'active',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // pickup_slots.status flip needs the admin client. RLS on pickup_slots
  // only allows admins to write — without service-role here, a helper's
  // claim would silently leave slot.status='unclaimed' and the chip
  // would render as "open" for everyone except the helper who claimed
  // it. (That was the "Tataia claimed but Levanah still sees it open"
  // bug.)
  const admin = supabaseAdmin();
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

  // Update the source Google Calendar event's title to "[Helper] …" so
  // Paula sees the claim immediately on her own calendar. Best-effort.
  // For admin claimers, ALSO add them as a Google attendee so they get
  // a real calendar invite in their personal email — Dani sees it on
  // his Meron calendar, Paula on her personal calendar, etc.
  if (slot?.source_event_id) {
    try {
      const { data: profile } = await sb.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle();
      const firstName = (profile?.full_name ?? '').split(/[\s(]/)[0] || null;
      if (firstName) {
        await updateEventTitleForClaim(sb, slot.household_id, slot.source_event_id, firstName);
      }
      // Check if the claimer is an admin → add as Google attendee
      const { data: membership } = await sb
        .from('household_members')
        .select('role')
        .eq('household_id', slot.household_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (membership?.role === 'admin' && profile?.email) {
        await addAttendeeToEvent(sb, slot.household_id, slot.source_event_id, profile.email);
      }
    } catch (e) {
      console.error('calendar event title/attendee update failed', e);
    }
  }

  // Send a confirmation email to the helper. Best-effort; we don't want to
  // fail the claim if the email provider is down or the helper has no email.
  try {
    const { data: profile } = await sb.from('profiles').select('full_name, email, email_enabled').eq('id', user.id).maybeSingle();
    if (slot && profile?.email && profile?.email_enabled !== false) {
      // Stitch additional_children for the formatter
      const extraIds = (slot.additional_child_ids as string[] | null) ?? [];
      let additional_children: any[] = [];
      if (extraIds.length > 0) {
        const { data: kids } = await sb.from('children').select('*').in('id', extraIds);
        additional_children = kids ?? [];
      }
      const hydrated = { ...slot, additional_children };
      const { subject, body, html } = renderClaimConfirmation(hydrated as any, profile.full_name ?? null);
      await emailProvider.send({ to: profile.email, subject, body, html });
    }
  } catch (e) {
    // Log only — do not surface email errors to the claim caller.
    console.error('claim confirmation email failed', e);
  }

  // Refresh Liezel's weekly summary so she has the current picture.
  if (slot?.household_id) {
    await sendLiezelSummaryUpdate(sb, slot.household_id);
    // Mid-week claim update to admins — full week summary + Liezel
    // forward button. Fires on every claim/unclaim/reassign so Paula
    // and Dani always know who's on what.
    const { data: profile } = await sb.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const slotLabel = `${slot.title} ${(slot.pickup_time as string).slice(0, 5)} on ${slot.date}`;
    await sendAdminClaimUpdate(sb, slot.household_id, {
      actorName: profile?.full_name?.split(' ')[0] ?? null,
      action: 'claimed',
      slotLabel,
    });
  }

  return NextResponse.json({ ok: true });
}
