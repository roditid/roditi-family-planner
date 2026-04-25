import { SupabaseClient } from '@supabase/supabase-js';
import type { SlotView, Child } from './types';
import { demoMode } from './demo-session';
import { listSlots } from './demo-store';

/**
 * Fetch hydrated pickup slots for a household between two dates (inclusive of
 * start, exclusive of end). Uses a left-join pattern so unclaimed slots
 * aren't dropped: first pull slots + child/activity/locations in one round
 * trip, then pull active assignments separately and stitch them.
 *
 * Also stitches:
 *   - the via_location (intermediate stop, e.g. activity location)
 *   - additional_children (combined siblings on a Gan→Home trip)
 *
 * In DEMO_MODE, reads from the in-memory demo store instead.
 */
export async function fetchSlots(
  sb: SupabaseClient,
  householdId: string,
  startISO: string,
  endISO: string
): Promise<SlotView[]> {
  if (demoMode()) return listSlots(startISO, endISO);

  const { data: slots, error } = await sb
    .from('pickup_slots')
    .select(`
      *,
      child:children(*),
      activity:activities(*),
      pickup_location:pickup_location_id(*),
      via_location:via_location_id(*),
      destination_location:destination_location_id(*)
    `)
    .eq('household_id', householdId)
    .gte('date', startISO)
    .lt('date', endISO)
    .order('date', { ascending: true })
    .order('pickup_time', { ascending: true });

  if (error) throw error;
  if (!slots || slots.length === 0) return [];

  const ids = slots.map((s: any) => s.id);
  const { data: assigns } = await sb
    .from('slot_assignments')
    .select('*, profile:assigned_to_user_id(*)')
    .in('pickup_slot_id', ids)
    .eq('status', 'active');
  const assignById = new Map((assigns ?? []).map((a: any) => [a.pickup_slot_id, a]));

  // Collect every additional_child_id across all slots and fetch them in one go.
  const extraIds = Array.from(new Set(
    slots.flatMap((s: any) => (s.additional_child_ids as string[] | null) ?? [])
  ));
  let childById = new Map<string, Child>();
  if (extraIds.length > 0) {
    const { data: kids } = await sb.from('children').select('*').in('id', extraIds);
    childById = new Map((kids ?? []).map((k: any) => [k.id, k as Child]));
  }

  return slots.map((s: any) => ({
    ...s,
    assignment: assignById.get(s.id) ?? null,
    additional_children: ((s.additional_child_ids as string[] | null) ?? [])
      .map((id) => childById.get(id))
      .filter((c): c is Child => Boolean(c)),
  })) as any;
}

export { mapsHref } from './maps';
