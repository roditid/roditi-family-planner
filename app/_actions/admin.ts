'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import * as demo from '@/lib/demo-store';
import { recordEvent } from '@/lib/events';

// ----------------------------------------------------------------------
// Locations
// ----------------------------------------------------------------------
export async function createLocationAction(formData: FormData) {
  const ctx = await requireAdmin();
  const input = {
    label: String(formData.get('label') ?? '').trim(),
    street: strOrNull(formData.get('street')),
    city: strOrNull(formData.get('city')),
    notes: strOrNull(formData.get('notes')),
    is_common: formData.get('is_common') === 'on',
  };
  if (!input.label) return;
  if (demoMode()) { demo.createLocation(input); }
  else {
    const sb = supabaseServer();
    await sb.from('locations').insert({ household_id: ctx.household!.id, ...input, country: 'IL' });
  }
  revalidatePath('/admin/locations');
}

export async function updateLocationAction(formData: FormData) {
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const patch = {
    label: strOrNull(formData.get('label')) ?? '',
    street: strOrNull(formData.get('street')),
    city: strOrNull(formData.get('city')),
    notes: strOrNull(formData.get('notes')),
    is_common: formData.get('is_common') === 'on',
  };
  if (!id || !patch.label) return;
  if (demoMode()) { demo.updateLocation(id, patch); }
  else {
    const sb = supabaseServer();
    await sb.from('locations').update(patch).eq('id', id).eq('household_id', ctx.household!.id);
  }
  revalidatePath('/admin/locations');
}

export async function deleteLocationAction(formData: FormData) {
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  if (demoMode()) return; // demo store has no delete-location helper
  const sb = supabaseServer();
  // Null any references on slots/activities/children before deleting,
  // otherwise the FK constraint blocks the delete.
  await sb.from('pickup_slots').update({ pickup_location_id: null }).eq('pickup_location_id', id);
  await sb.from('pickup_slots').update({ destination_location_id: null }).eq('destination_location_id', id);
  await sb.from('activities').update({ default_pickup_location_id: null }).eq('default_pickup_location_id', id);
  await sb.from('activities').update({ default_destination_location_id: null }).eq('default_destination_location_id', id);
  await sb.from('children').update({ school_location_id: null }).eq('school_location_id', id);
  await sb.from('children').update({ home_location_id: null }).eq('home_location_id', id);
  await sb.from('locations').delete().eq('id', id).eq('household_id', ctx.household!.id);
  revalidatePath('/admin/locations');
}

// ----------------------------------------------------------------------
// Activity defaults (on Children & activities screen)
// ----------------------------------------------------------------------
export async function updateActivityAction(formData: FormData) {
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const patch = {
    title: String(formData.get('title') ?? '').trim(),
    default_pickup_location_id: strOrNull(formData.get('default_pickup_location_id')),
    default_destination_location_id: strOrNull(formData.get('default_destination_location_id')),
    notes: strOrNull(formData.get('notes')),
    event_keyword: strOrNull(formData.get('event_keyword')),
  };
  if (!id || !patch.title) return;
  if (demoMode()) { demo.updateActivity(id, patch); }
  else {
    const sb = supabaseServer();
    await sb.from('activities').update(patch).eq('id', id);

    // Apply the new defaults to ALL upcoming pickup_slots tied to this
    // activity so the parent doesn't have to re-sync. We only touch slots
    // that don't already have explicit per-slot overrides set in the past.
    if (patch.default_pickup_location_id) {
      await sb.from('pickup_slots').update({ pickup_location_id: patch.default_pickup_location_id })
        .eq('activity_id', id);
    }
    if (patch.default_destination_location_id) {
      await sb.from('pickup_slots').update({ destination_location_id: patch.default_destination_location_id })
        .eq('activity_id', id);
    }
  }
  revalidatePath('/admin/children');
  revalidatePath('/admin');
  revalidatePath('/my-pickups');
  revalidatePath('/pickups');
}

export async function deleteActivityAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  if (demoMode()) return;
  const sb = supabaseServer();
  await sb.from('activities').delete().eq('id', id);
  revalidatePath('/admin/children');
}

// ----------------------------------------------------------------------
// Manual pickup slot creation
// ----------------------------------------------------------------------
export async function createSlotAction(formData: FormData) {
  const ctx = await requireAdmin();
  const input = {
    child_id: String(formData.get('child_id') ?? ''),
    title: String(formData.get('title') ?? '').trim(),
    date: String(formData.get('date') ?? ''),
    pickup_time: String(formData.get('pickup_time') ?? ''),
    end_time: strOrNull(formData.get('end_time')),
    pickup_location_id: strOrNull(formData.get('pickup_location_id')),
    destination_location_id: strOrNull(formData.get('destination_location_id')),
    notes: strOrNull(formData.get('notes')),
  };
  if (!input.child_id || !input.title || !input.date || !input.pickup_time) return;
  let slotId: string | null = null;
  if (demoMode()) {
    slotId = demo.createSlot(input).id;
  } else {
    const sb = supabaseServer();
    const { data } = await sb.from('pickup_slots').insert({
      household_id: ctx.household!.id,
      source: 'manual',
      status: 'unclaimed',
      ...input,
    }).select('id').single();
    slotId = data?.id ?? null;
  }
  if (slotId) {
    await recordEvent({
      householdId: ctx.household!.id, slotId,
      actorUserId: ctx.user.id, subjectUserId: null, kind: 'created',
    });
  }
  revalidatePath('/admin');
  redirect('/admin');
}

// ----------------------------------------------------------------------
// Slot notes — quick edit from the detail modal. Lets Paula add a one-off
// reminder ("water bottle stays at Gan today", "Levanah will pick up,
// please bring her keys") to any single pickup at any time.
// ----------------------------------------------------------------------
export async function updateSlotNotesAction(formData: FormData) {
  const ctx = await requireAdmin();
  const slotId = String(formData.get('slot_id') ?? '');
  const notes = strOrNull(formData.get('notes'));
  if (!slotId) return;
  if (demoMode()) {
    // demo store doesn't support note edit; ignore
  } else {
    const sb = supabaseServer();
    await sb.from('pickup_slots').update({ notes, updated_at: new Date().toISOString() }).eq('id', slotId);
  }
  revalidatePath('/admin');
  revalidatePath('/admin/unassigned');
  revalidatePath('/my-pickups');
}

// ----------------------------------------------------------------------
// Assignment override
// ----------------------------------------------------------------------
export async function reassignSlotAction(formData: FormData) {
  const ctx = await requireAdmin();
  const slotId = String(formData.get('slot_id') ?? '');
  const userId = String(formData.get('user_id') ?? '');
  if (!slotId) return;

  if (userId === '__clear__') {
    if (demoMode()) { demo.clearAssignment(slotId); }
    else {
      const sb = supabaseServer();
      await sb.from('slot_assignments')
        .update({ status: 'overridden', released_at: new Date().toISOString() })
        .eq('pickup_slot_id', slotId).eq('status', 'active');
      await sb.from('pickup_slots').update({ status: 'unclaimed' }).eq('id', slotId);
      // Strip the "[Helper]" prefix from the source calendar event.
      const { data: slot } = await sb.from('pickup_slots').select('source_event_id').eq('id', slotId).maybeSingle();
      if (slot?.source_event_id) {
        try {
          const { updateEventTitleForClaim } = await import('@/lib/google/calendar');
          await updateEventTitleForClaim(sb, ctx.household!.id, slot.source_event_id, null);
        } catch (e) { console.error('calendar revert failed', e); }
      }
    }
    await recordEvent({
      householdId: ctx.household!.id, slotId,
      actorUserId: ctx.user.id, subjectUserId: null, kind: 'unassigned',
    });
  } else {
    if (!userId) return;
    if (demoMode()) { demo.reassignSlot(slotId, userId, ctx.user.id); }
    else {
      const sb = supabaseServer();
      await sb.from('slot_assignments')
        .update({ status: 'overridden', released_at: new Date().toISOString() })
        .eq('pickup_slot_id', slotId).eq('status', 'active');
      await sb.from('slot_assignments').insert({
        pickup_slot_id: slotId,
        assigned_to_user_id: userId,
        assigned_by_user_id: ctx.user.id,
        status: 'active',
      });
      await sb.from('pickup_slots').update({ status: 'claimed' }).eq('id', slotId);
      // Update the calendar event title to "[NewHelper] Activity - Kid".
      const { data: slot } = await sb.from('pickup_slots').select('source_event_id').eq('id', slotId).maybeSingle();
      const { data: profile } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle();
      if (slot?.source_event_id && profile?.full_name) {
        const firstName = profile.full_name.split(/[\s(]/)[0] || null;
        if (firstName) {
          try {
            const { updateEventTitleForClaim } = await import('@/lib/google/calendar');
            await updateEventTitleForClaim(sb, ctx.household!.id, slot.source_event_id, firstName);
          } catch (e) { console.error('calendar update failed', e); }
        }
      }
    }
    await recordEvent({
      householdId: ctx.household!.id, slotId,
      actorUserId: ctx.user.id, subjectUserId: userId, kind: 'reassigned',
    });
  }
  // Refresh Liezel's weekly summary so she has the latest assignments.
  if (!demoMode()) {
    const { sendLiezelSummaryUpdate } = await import('@/lib/notify-liezel');
    const sb = supabaseServer();
    await sendLiezelSummaryUpdate(sb, ctx.household!.id);
  }

  revalidatePath('/admin');
  revalidatePath('/admin/unassigned');
}

// ----------------------------------------------------------------------
// Reminder settings
// ----------------------------------------------------------------------
export async function updateReminderSettingsAction(formData: FormData) {
  const ctx = await requireAdmin();
  const patch = {
    morning_send_time: String(formData.get('morning_send_time') ?? '07:30'),
    send_evening_before: formData.get('send_evening_before') === 'on',
    evening_send_time: String(formData.get('evening_send_time') ?? '20:00'),
    cutoff_time: String(formData.get('cutoff_time') ?? '20:00'),
    parent_fallback_alert: formData.get('parent_fallback_alert') === 'on',
    timezone: String(formData.get('timezone') ?? 'Asia/Jerusalem'),
  };
  if (demoMode()) { demo.updateReminderSettings(patch); }
  else {
    const sb = supabaseServer();
    await sb.from('reminder_settings').upsert({ household_id: ctx.household!.id, ...patch });
  }
  revalidatePath('/admin/reminders');
}

/**
 * Send a sample reminder email to the current admin's inbox so they can
 * see what the helpers receive in the morning.
 */
export async function sendTestReminderAction() {
  const ctx = await requireAdmin();
  if (!ctx.profile?.email) return;
  const { renderReminder, emailProvider } = await import('@/lib/notify');
  const sb = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const { fetchSlots } = await import('@/lib/slots');
  const todayPlus = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const slots = await fetchSlots(sb, ctx.household!.id, today, todayPlus);
  const example = slots.find((s) => s.pickup_location) ?? slots[0];
  if (!example) return;
  const { subject, body } = renderReminder(example);
  await emailProvider.send({
    to: ctx.profile.email,
    subject: `[TEST] ${subject}`,
    body: `(This is a test from Roditi Family Planner — it's what helpers receive in the morning.)\n\n${body}`,
  });
  revalidatePath('/admin/reminders');
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
