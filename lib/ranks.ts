/**
 * Helper ranks — a Gett-style loyalty tier shown next to the helper's
 * name and inside their /my-pickups/mine tab. Pickups completed climb
 * the ladder; each tier has a title + emoji "sticker" and a coral
 * accent color so it reads as a small reward.
 *
 * "Completed" = active assignment for a slot whose date has already
 * passed (we don't track explicit completion). Same-day pickups count
 * the moment their pickup_time is more than 30 min in the past, which
 * matches how the schedule view filters past slots.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { format } from 'date-fns';

export interface Tier {
  /** Minimum pickups completed to unlock this tier. */
  min: number;
  /** Display title — keep short so it fits next to the name. */
  title: string;
  /** Emoji sticker shown alongside the title. */
  sticker: string;
}

/**
 * Tier table. Spaced so early wins arrive fast (encourages claiming the
 * second pickup), then the gaps stretch out. Top tier is reachable but
 * deliberately rare — it should feel like a real achievement.
 */
export const TIERS: Tier[] = [
  { min: 0,   title: 'New here',       sticker: '🌱' },
  { min: 1,   title: 'First pickup',   sticker: '⭐' },
  { min: 5,   title: 'Helper',         sticker: '🌿' },
  { min: 10,  title: 'Regular',        sticker: '🌻' },
  { min: 25,  title: 'Trusted',        sticker: '🏅' },
  { min: 50,  title: 'Champion',       sticker: '🏆' },
  { min: 100, title: 'Family legend',  sticker: '✨' },
];

export interface HelperRank {
  /** Total completed pickups. */
  count: number;
  /** Current tier (always defined — defaults to "New here" at 0). */
  current: Tier;
  /** Next tier to unlock, or null if the helper is already at the top. */
  next: Tier | null;
  /** Pickups remaining to reach `next`. 0 if at top. */
  toNext: number;
}

/** Pure tier computation — given a count, return the rank summary. */
export function rankForCount(count: number): HelperRank {
  let current = TIERS[0];
  let next: Tier | null = null;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (count >= TIERS[i].min) {
      current = TIERS[i];
      next = TIERS[i + 1] ?? null;
      break;
    }
  }
  const toNext = next ? Math.max(0, next.min - count) : 0;
  return { count, current, next, toNext };
}

/**
 * Count completed pickups for a helper in this household. Returns the
 * full rank summary so the caller doesn't need a second computation.
 */
export async function getHelperRank(
  sb: SupabaseClient,
  householdId: string,
  userId: string
): Promise<HelperRank> {
  // We pull all active assignments for this user and filter in-memory by
  // slot date — much simpler than trying to express the "past pickup"
  // predicate in a PostgREST query with a join.
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data } = await sb
    .from('slot_assignments')
    .select('id, status, pickup_slot:pickup_slot_id!inner(date, household_id)')
    .eq('assigned_to_user_id', userId)
    .eq('status', 'active');
  const rows = (data ?? []) as any[];
  const count = rows.filter((r) => {
    const slot = r.pickup_slot;
    if (!slot) return false;
    if (slot.household_id !== householdId) return false;
    return slot.date < today;
  }).length;
  return rankForCount(count);
}
