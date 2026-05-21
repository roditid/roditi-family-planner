'use server';
/**
 * Admin override actions for combined Gan→Home pickups.
 *   • splitSlotAction — turns a combined trip (primary + N additional)
 *     into N+1 separate Gan→Home pickups, each marked manually_arranged
 *     so the defaults generator leaves them alone.
 *   • mergeSlotsAction — combines a set of solo slots into one trip
 *     (primary = earliest dismissal, rest as additional_child_ids).
 */
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface Kid {
  id: string;
  name: string;
  school_location_id: string | null;
  home_location_id: string | null;
  gan_dismissal_time: string | null;
}

/**
 * Take one combined slot and break it into N separate solo Gan→Home
 * slots — one per kid in the trip. Each new row is marked
 * manually_arranged so the defaults generator preserves it.
 */
export async function splitSlotAction(formData: FormData) {
  const ctx = await requireAdmin();
  const slotId = String(formData.get('slot_id') ?? '');
  if (!slotId) return { ok: false, error: 'missing slot_id' };

  const sb = supabaseAdmin();
  const { data: slot } = await sb
    .from('pickup_slots')
    .select('*, child:children(*)')
    .eq('id', slotId)
    .eq('household_id', ctx.household!.id)
    .maybeSingle();
  if (!slot) return { ok: false, error: 'slot not found' };
  if ((slot as any).source !== 'auto-default') {
    return { ok: false, error: 'only auto-default Gan→Home trips can be split' };
  }

  const extraIds = ((slot as any).additional_child_ids as string[] | null) ?? [];
  if (extraIds.length === 0) {
    return { ok: false, error: 'this is already a solo pickup' };
  }

  // Hydrate every kid in the trip.
  const allKidIds = [(slot as any).child_id, ...extraIds];
  const { data: kids } = await sb
    .from('children')
    .select('id, name, school_location_id, home_location_id, gan_dismissal_time')
    .in('id', allKidIds);
  const kidList: Kid[] = (kids ?? []) as any;

  // Delete the original combined slot.
  await sb.from('pickup_slots').delete().eq('id', slotId);

  // Insert one solo slot per kid, each at their own dismissal time.
  for (const kid of kidList) {
    await sb.from('pickup_slots').insert({
      household_id: ctx.household!.id,
      child_id: kid.id,
      additional_child_ids: [],
      activity_id: null,
      source: 'auto-default',
      title: 'Home',
      date: (slot as any).date,
      pickup_time: kid.gan_dismissal_time ?? (slot as any).pickup_time,
      end_time: null,
      pickup_location_id: kid.school_location_id,
      via_location_id: null,
      destination_location_id: kid.home_location_id,
      notes: null,
      manually_arranged: true,
    });
  }

  revalidatePath('/home');
  revalidatePath('/admin');
  return { ok: true, splitCount: kidList.length };
}

/**
 * Merge a list of solo Gan→Home slots into one combined trip on the
 * same date. Primary = earliest-dismissed kid (Yali first if tied).
 * Drops the others; inserts a new combined slot marked
 * manually_arranged.
 */
export async function mergeSlotsAction(formData: FormData) {
  const ctx = await requireAdmin();
  const ids = formData.getAll('slot_ids[]').map((v) => String(v));
  if (ids.length < 2) return { ok: false, error: 'pick at least 2 slots' };

  const sb = supabaseAdmin();
  const { data: slots } = await sb
    .from('pickup_slots')
    .select('id, date, child_id, additional_child_ids, source, child:children(id, name, school_location_id, home_location_id, gan_dismissal_time)')
    .in('id', ids)
    .eq('household_id', ctx.household!.id);
  const list = (slots ?? []) as any[];

  if (list.length < 2) return { ok: false, error: 'some slots not found' };
  const dates = new Set(list.map((s) => s.date));
  if (dates.size !== 1) return { ok: false, error: 'all slots must be on the same date' };
  if (list.some((s) => s.source !== 'auto-default')) {
    return { ok: false, error: 'only auto-default Gan→Home slots can be merged' };
  }
  if (list.some((s) => ((s.additional_child_ids as string[] | null) ?? []).length > 0)) {
    return { ok: false, error: 'some slots are already combined — split them first' };
  }

  const date = list[0].date;

  // Sort by dismissal ascending; Yali wins ties.
  const kids: Kid[] = list.map((s) => s.child);
  const ordered = [...kids].sort((a, b) => {
    const at = a.gan_dismissal_time ?? '99:99:99';
    const bt = b.gan_dismissal_time ?? '99:99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    if (a.name === 'Yali') return -1;
    if (b.name === 'Yali') return 1;
    return 0;
  });

  // Back-chain pickup times: last kid at their dismissal; previous kid
  // = min(own_dismissal, next_pickup - 15min). Same rule the defaults
  // generator uses for auto-combined trips.
  const stopGapMin = 15;
  const pickupTimes: string[] = new Array(ordered.length);
  pickupTimes[ordered.length - 1] = ordered[ordered.length - 1].gan_dismissal_time!;
  for (let i = ordered.length - 2; i >= 0; i--) {
    const own = ordered[i].gan_dismissal_time!;
    const constrained = subtractMinutes(pickupTimes[i + 1], stopGapMin);
    pickupTimes[i] = own <= constrained ? own : constrained;
  }

  const primary = ordered[0];
  const additionalIds = ordered.slice(1).map((k) => k.id);

  // Delete the input slots, then insert the combined one.
  await sb.from('pickup_slots').delete().in('id', ids);
  await sb.from('pickup_slots').insert({
    household_id: ctx.household!.id,
    child_id: primary.id,
    additional_child_ids: additionalIds,
    activity_id: null,
    source: 'auto-default',
    title: 'Home',
    date,
    pickup_time: pickupTimes[0],
    end_time: null,
    pickup_location_id: primary.school_location_id,
    via_location_id: null,
    destination_location_id: primary.home_location_id,
    notes: null,
    manually_arranged: true,
  });

  revalidatePath('/home');
  revalidatePath('/admin');
  return { ok: true };
}

function subtractMinutes(t: string, minutes: number): string {
  const [h, m] = t.split(':').map(Number);
  let total = h * 60 + m - minutes;
  if (total < 0) total = 0;
  const h2 = Math.floor(total / 60);
  const m2 = total % 60;
  return `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00`;
}
