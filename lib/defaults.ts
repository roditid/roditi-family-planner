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
  //    have a trip that day (and so don't need a Gan→Home default).
  const { data: activitySlots } = await sb
    .from('pickup_slots')
    .select('child_id, date')
    .eq('household_id', householdId)
    .not('activity_id', 'is', null)
    .gte('date', start)
    .lt('date', end);
  const hasActivity = new Map<string, Set<string>>();
  for (const s of activitySlots ?? []) {
    if (!hasActivity.has(s.date)) hasActivity.set(s.date, new Set());
    hasActivity.get(s.date)!.add(s.child_id);
  }

  // 3. Wipe unclaimed auto-defaults so we can regenerate cleanly.
  await sb
    .from('pickup_slots')
    .delete()
    .eq('household_id', householdId)
    .eq('source', 'auto-default')
    .eq('status', 'unclaimed')
    .gte('date', start)
    .lt('date', end);

  // 4. Walk every weekday and generate the combined Gan→Home slot.
  let daysProcessed = 0;
  let slotsCreated = 0;
  for (let i = 0; i < days; i++) {
    const date = format(addDays(today, i), 'yyyy-MM-dd');
    const dow = addDays(today, i).getDay(); // 0=Sun..6=Sat
    if (dow === 5 || dow === 6) continue;   // skip Fri/Sat (Israeli weekend)
    daysProcessed++;

    const withActivity = hasActivity.get(date) ?? new Set<string>();
    const goingHome = eligibleKids
      .filter((k) => !withActivity.has(k.id))
      .sort(
        (a, b) =>
          (PROXIMITY_RANK[b.name] ?? 99) - (PROXIMITY_RANK[a.name] ?? 99)
      );
    if (goingHome.length === 0) continue;

    const primary = goingHome[0];
    const additionalIds = goingHome.slice(1).map((k) => k.id);
    const tripStart = primary.gan_dismissal_time!; // primary = first kid in route
    const title = goingHome.map((k) => k.name).join(' → ') + ' → Home';

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

  return { daysProcessed, slotsCreated };
}
