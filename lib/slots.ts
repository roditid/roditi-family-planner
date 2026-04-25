import { SupabaseClient } from '@supabase/supabase-js';
import type { SlotView } from './types';
import { demoMode } from './demo-session';
import { listSlots } from './demo-store';

/**
 * Fetch hydrated pickup slots for a household between two dates (inclusive of
 * start, exclusive of end). Uses a left-join pattern so unclaimed slots
 * aren't dropped: first pull slots + child/activity/locations in one round
 * trip, then pull active assignments separately and stitch them.
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
      destination_location:destination_location_id(*)
    `)
    .eq('household_id', householdId)
    .gte('date', startISO)
    .lt('date', endISO)
    .order('date', { ascending: true })
    .order('pickup_time', { ascending: true });

  if (error) throw error;
  if (!slots || slots.length === 0) return [];

  const ids = slots.map((s) => s.id);
  const { data: assigns } = await sb
    .from('slot_assignments')
    .select('*, profile:assigned_to_user_id(*)')
    .in('pickup_slot_id', ids)
    .eq('status', 'active');

  const byId = new Map((assigns ?? []).map((a) => [a.pickup_slot_id, a]));
  return slots.map((s) => ({ ...s, assignment: byId.get(s.id) ?? null })) as any;
}

export { mapsHref } from './maps';
