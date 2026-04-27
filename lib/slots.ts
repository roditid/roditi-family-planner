import { cache } from 'react';
import type { SlotView, Child } from './types';
import { demoMode } from './demo-session';
import { listSlots } from './demo-store';
import { supabaseServer } from './supabase/server';

/**
 * Fetch hydrated pickup slots for a household between two dates (inclusive of
 * start, exclusive of end).
 *
 * Performance:
 *  - Wrapped in React cache() so the layout (NextPickupBanner), page, and
 *    any nested server components share a single round-trip per request.
 *  - The two follow-up queries (assignments + extra-children) run in
 *    parallel via Promise.all, cutting the round-trip count from 3 to 2.
 *
 * In DEMO_MODE, reads from the in-memory demo store instead.
 */
export const fetchSlots = cache(_fetchSlots);

async function _fetchSlots(
  // The first parameter used to be the SupabaseClient, but caching keys
  // can't include functions / clients. We now grab the client inside —
  // every caller was already passing the same supabaseServer() anyway.
  // The legacy signature (sb, householdId, startISO, endISO) is preserved
  // for compatibility — the sb argument is ignored when cached.
  _sbOrHousehold: any,
  householdIdOrStart?: string,
  startISOorEnd?: string,
  endISOarg?: string
): Promise<SlotView[]> {
  // Argument compatibility: support both old (sb, householdId, start, end)
  // and new (householdId, start, end) callers.
  let householdId: string;
  let startISO: string;
  let endISO: string;
  if (typeof _sbOrHousehold === 'string') {
    householdId = _sbOrHousehold;
    startISO = householdIdOrStart!;
    endISO = startISOorEnd!;
  } else {
    householdId = householdIdOrStart!;
    startISO = startISOorEnd!;
    endISO = endISOarg!;
  }

  if (demoMode()) return listSlots(startISO, endISO);

  const sb = supabaseServer();

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
  const extraIds = Array.from(new Set(
    slots.flatMap((s: any) => (s.additional_child_ids as string[] | null) ?? [])
  ));

  // Run assignments + extra-children fetches in parallel — both depend on
  // the slots query but neither on each other, so we save a round-trip.
  const [assignsResult, kidsResult] = await Promise.all([
    sb
      .from('slot_assignments')
      .select('*, profile:assigned_to_user_id(*)')
      .in('pickup_slot_id', ids)
      .eq('status', 'active'),
    extraIds.length > 0
      ? sb
        .from('children')
        .select('*, school_location:school_location_id(*)')
        .in('id', extraIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const assignById = new Map((assignsResult.data ?? []).map((a: any) => [a.pickup_slot_id, a]));
  const childById = new Map<string, Child & { school_location: any }>(
    (kidsResult.data ?? []).map((k: any) => [k.id, k])
  );

  return slots.map((s: any) => ({
    ...s,
    assignment: assignById.get(s.id) ?? null,
    additional_children: ((s.additional_child_ids as string[] | null) ?? [])
      .map((id) => childById.get(id))
      .filter((c): c is Child & { school_location: any } => Boolean(c)),
  })) as any;
}

export { mapsHref } from './maps';
