/**
 * Daily default-pickup generator.
 *
 * Every weekday (Sun–Thu in Israel), each kid needs to come home from their
 * Gan. If they don't have an activity that day, the default trip is
 * Gan → Home. When 2+ siblings are all going straight home, they share a
 * single combined trip — one helper, one route, multiple stops.
 *
 * Route ordering: farthest-Gan-from-home → closest-Gan-to-home → home. With
 * Yali (closest), Adam (mid), Liam (farthest), the canonical 3-kid order is
 * **Liam → Adam → Yali → Home**. The helper starts at Liam's Gan at his
 * dismissal time and walks each leg toward home.
 *
 * Idempotency: deletes UNCLAIMED 'auto-default' slots in the date range
 * before regenerating, so re-running this picks up new activity overrides
 * but never disturbs a claimed pickup.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';

/** Lower number = closer to home. Used to sort the combined-trip route. */
const PROXIMITY_RANK: Record<string, number> = {
  Yali: 0,
  Adam: 1,
  Liam: 2,
};

interface KidRow {
  id: string;
  name: string;
  color: string;
  school_location_id: string | null;
  home_location_id: string | null;
  gan_dismissal_time: string | null;
}

/** Generate Gan→Home default slots for the next `days` weekdays. */
export async function generateDefaultSlots(
  sb: SupabaseClient,
  householdId: string,
  days = 21
): Promise<{ daysProcessed: number; slotsCreated: number }> {
  const today = new Date();
  const start = format(today, 'yyyy-MM-dd');
  const end = format(addDays(today, days), 'yyyy-MM-dd');

  // 1. Pull kids
  const { data: kidsRaw } = await sb
    .from('children')
    .select('id, name, color, school_location_id, home_location_id, gan_dismissal_time')
    .eq('household_id', householdId);
  const kids = (kidsRaw ?? []) as KidRow[];
  // Only kids with full Gan setup (school + home + dismissal time) get defaults.
  const eligibleKids = kids.filter(
    (k) => k.school_location_id && k.home_location_id && k.gan_dismissal_time
  );
  if (eligibleKids.length === 0) return { daysProcessed: 0, slotsCreated: 0 };

  // 2. Pull existing activity slots in range to figure out which kids already
  //    have a trip that day (and so don't need a Gan→Home default). We
  //    consider both the primary child AND any tag-along siblings on the
  //    slot — e.g. Yali rides with Adam to 1st Grade Prep, so she's
  //    already covered for the day and shouldn't get a separate Gan→Home.
  //
  //    We also track the EARLIEST pickup_time per kid per date — needed for
  //    early-dismissal handling: an activity covers a kid only if it picks
  //    them up at or before their effective dismissal. On May 5 Liam is
  //    dismissed at 12:30 but Picnic Lag Baomer is at 16:15 — that activity
  //    runs from Home, not the Gan, so it doesn't cover the 12:30→home leg.
  const { data: activitySlots } = await sb
    .from('pickup_slots')
    .select('child_id, additional_child_ids, date, pickup_time, destination_location_id')
    .eq('household_id', householdId)
    .not('activity_id', 'is', null)
    .gte('date', start)
    .lt('date', end);
  // Only activities that DROP THE KID AT HOME count as coverage for the
  // Gan→Home default. A morning-from-home event that ends at the Gan
  // (e.g. Judo Competition at 8:45 → drops Adam at his Gan after) does
  // NOT cover the afternoon home trip — kid still needs Gan→Home later.
  // Build kidId → home_location_id from kids list so we can match.
  const homeByKid = new Map<string, string | null>();
  for (const k of kids) homeByKid.set(k.id, k.home_location_id);
  // date → child_id → earliest pickup_time (HH:MM:SS string)
  const earliestActivityPickup = new Map<string, Map<string, string>>();
  for (const s of activitySlots ?? []) {
    if (!earliestActivityPickup.has(s.date)) earliestActivityPickup.set(s.date, new Map());
    const dayMap = earliestActivityPickup.get(s.date)!;
    const ids = [s.child_id, ...((s.additional_child_ids ?? []) as string[])];
    for (const id of ids) {
      const home = homeByKid.get(id);
      // Skip activities that don't end at this kid's home — they don't
      // cover the home trip.
      if (!home || s.destination_location_id !== home) continue;
      const prev = dayMap.get(id);
      if (!prev || s.pickup_time < prev) dayMap.set(id, s.pickup_time);
    }
  }

  // 2b. Pull daily_overrides — no_gan suppresses defaults, early_dismissal
  //     overrides the kid's pickup time for that day.
  const { data: overrides } = await sb
    .from('daily_overrides')
    .select('child_id, date, kind, dismissal_time')
    .eq('household_id', householdId)
    .gte('date', start)
    .lt('date', end);
  const noGan = new Map<string, Set<string>>();         // date → set of child_id
  const earlyDismissal = new Map<string, Map<string, string>>(); // date → child_id → time
  for (const o of overrides ?? []) {
    if (!o.child_id) continue;
    if (o.kind === 'no_gan') {
      if (!noGan.has(o.date)) noGan.set(o.date, new Set());
      noGan.get(o.date)!.add(o.child_id);
    } else if (o.kind === 'early_dismissal' && o.dismissal_time) {
      if (!earlyDismissal.has(o.date)) earlyDismissal.set(o.date, new Map());
      earlyDismissal.get(o.date)!.set(o.child_id, o.dismissal_time);
    }
  }

  // 3. Wipe unclaimed auto-defaults so we can regenerate cleanly.
  //    Claimed defaults are preserved — see step 4 for how we skip
  //    re-creating them on dates where one already exists.
  await sb
    .from('pickup_slots')
    .delete()
    .eq('household_id', householdId)
    .eq('source', 'auto-default')
    .eq('status', 'unclaimed')
    .gte('date', start)
    .lt('date', end);

  // 3b. Build a per-date set of kids already covered by a claimed
  //     auto-default. Step 3 deleted unclaimed ones, so what remains is
  //     guaranteed to be claimed. We exclude these kids from the
  //     candidate list below — but we DON'T skip the whole date, so a
  //     claimed Liam-12:30 doesn't prevent Yali+Adam from getting their
  //     own combined 16:00 trip on the same day.
  const { data: existing } = await sb
    .from('pickup_slots')
    .select('date, child_id, additional_child_ids')
    .eq('household_id', householdId)
    .eq('source', 'auto-default')
    .gte('date', start)
    .lt('date', end);
  const coveredByClaimed = new Map<string, Set<string>>();
  for (const r of existing ?? []) {
    if (!coveredByClaimed.has(r.date)) coveredByClaimed.set(r.date, new Set());
    const set = coveredByClaimed.get(r.date)!;
    set.add(r.child_id);
    for (const id of (r.additional_child_ids ?? []) as string[]) set.add(id);
  }

  // 3b. Also delete CLAIMED auto-defaults that conflict with a no_gan
  //     override — the Gan is closed, the trip can't happen, and leaving
  //     a stale claim would confuse the helper. Activity slots are kept.
  for (const [date, kidIds] of noGan) {
    if (kidIds.size === 0) continue;
    await sb
      .from('pickup_slots')
      .delete()
      .eq('household_id', householdId)
      .eq('source', 'auto-default')
      .eq('date', date)
      .in('child_id', Array.from(kidIds));
  }

  // 4. Walk every weekday and generate the combined Gan→Home slot.
  let daysProcessed = 0;
  let slotsCreated = 0;
  for (let i = 0; i < days; i++) {
    const date = format(addDays(today, i), 'yyyy-MM-dd');
    const dow = addDays(today, i).getDay(); // 0=Sun..6=Sat
    if (dow === 5 || dow === 6) continue;   // skip Fri/Sat (Israeli weekend)
    daysProcessed++;

    const activityPickupByKid = earliestActivityPickup.get(date) ?? new Map<string, string>();
    const offToday = noGan.get(date) ?? new Set<string>();
    const dismissalToday = earlyDismissal.get(date);
    const claimedToday = coveredByClaimed.get(date) ?? new Set<string>();

    // Decide which kids need a Gan→Home default today. A kid is "covered"
    // by an existing activity slot only if that slot picks them up at or
    // before their effective dismissal — i.e. it actually collects them
    // from the Gan. An activity that starts hours after early-dismissal
    // (e.g. 16:15 picnic on a 12:30-dismissal day) does NOT cover the
    // dismissal-to-home leg.
    // Step A: pull eligible kids who need Gan→Home today. Also skip kids
    // already covered by a CLAIMED auto-default — don't duplicate pickups
    // someone has already volunteered for.
    const candidates = eligibleKids
      .filter((k) => !offToday.has(k.id))
      .filter((k) => !claimedToday.has(k.id))
      .map((k) => {
        const override = dismissalToday?.get(k.id);
        return {
          ...k,
          gan_dismissal_time: override ?? k.gan_dismissal_time,
          isEarlyDismissal: !!override,
        };
      })
      .filter((k) => {
        const earliest = activityPickupByKid.get(k.id);
        const dismissal = k.gan_dismissal_time!;
        if (!earliest) return true;
        if (earliest <= dismissal) return false;
        return true;
      });
    if (candidates.length === 0) continue;

    // Step B: split early-dismissal kids OUT of the combined trip.
    // They get solo Gan→Home slots at their override time — combining a
    // 12:30 early dismissal with a sibling at 16:00 would mean either
    // the early kid waits 4 hours at the Gan or the helper makes two
    // trips on a single chip. Cleaner: one slot per pickup window.
    const earlyKids = candidates.filter((k) => k.isEarlyDismissal);
    // Regular Gan→Home: sort by dismissal time ASCENDING. Earliest-dismissed
    // kid is the first stop on the route — Yali (16:00) before Adam (16:30).
    // The helper collects each kid as they're released, then walks home.
    const regularKids = candidates.filter((k) => !k.isEarlyDismissal)
      .sort((a, b) => {
        const at = a.gan_dismissal_time ?? '99:99:99';
        const bt = b.gan_dismissal_time ?? '99:99:99';
        return at < bt ? -1 : at > bt ? 1 : 0;
      });

    // Title is intentionally just the destination ("Home") — the kids' names
    // already appear on the chip via the photo stack and the small-caps kid
    // labels, so repeating them in the title would be noise.
    const title = 'Home';

    // Step B1: solo Gan→Home for each early-dismissal kid.
    for (const kid of earlyKids) {
      const { error } = await sb.from('pickup_slots').insert({
        household_id: householdId,
        child_id: kid.id,
        additional_child_ids: [],
        activity_id: null,
        source: 'auto-default',
        title,
        date,
        pickup_time: kid.gan_dismissal_time!,
        end_time: null,
        pickup_location_id: kid.school_location_id,
        via_location_id: null,
        destination_location_id: kid.home_location_id,
        notes: null,
      });
      if (!error) slotsCreated++;
    }

    if (regularKids.length > 0) {
      const primary = regularKids[0];
      const additionalIds = regularKids.slice(1).map((k) => k.id);
      // Back-chain pickup times so the helper has 15 min walk time
      // between each Gan. Last kid's pickup = their dismissal; each
      // preceding kid is 15 min before the next. Two kids both at
      // 16:00 → first kid 15:45, second kid 16:00.
      const lastKid = regularKids[regularKids.length - 1];
      const lastPickup = lastKid.gan_dismissal_time!;
      const stopGapMin = 15;
      const numKids = regularKids.length;
      const tripStart = subtractMinutes(lastPickup, stopGapMin * (numKids - 1));
      const { error } = await sb.from('pickup_slots').insert({
        household_id: householdId,
        child_id: primary.id,
        additional_child_ids: additionalIds,
        activity_id: null,
        source: 'auto-default',
        title,
        date,
        pickup_time: tripStart,
        end_time: null,
        pickup_location_id: primary.school_location_id,
        via_location_id: null,
        destination_location_id: primary.home_location_id,
        notes: null,
      });
      if (!error) slotsCreated++;
    }
  }

  return { daysProcessed, slotsCreated };
}

/** Subtract `minutes` from an "HH:MM[:SS]" time. Returns "HH:MM:SS". */
function subtractMinutes(t: string, minutes: number): string {
  const [h, m] = t.split(':').map(Number);
  let total = h * 60 + m - minutes;
  if (total < 0) total = 0;
  const h2 = Math.floor(total / 60);
  const m2 = total % 60;
  return `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00`;
}
