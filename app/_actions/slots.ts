'use server';
/**
 * Admin actions for editing / deleting pickup slots directly.
 *
 * Both action paths set manually_arranged = true so the daily defaults
 * generator and calendar sync don't blow away the change on the next
 * regeneration.
 *
 * For calendar-sourced slots, the title edit ALSO pushes back to the
 * Google Calendar event so the family calendar stays in sync. Time /
 * date / location edits are website-only (the source of truth for
 * those is still Google Calendar — edit on the calendar to flow back
 * through sync).
 */
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface UpdateResult {
  ok: boolean;
  error?: string;
}

export async function updateSlotAction(formData: FormData): Promise<UpdateResult> {
  const ctx = await requireAdmin();
  const id = String(formData.get('slot_id') ?? '');
  if (!id) return { ok: false, error: 'missing slot_id' };

  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('pickup_slots')
    .select('id, source, source_event_id, title')
    .eq('id', id)
    .eq('household_id', ctx.household!.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'slot not found' };

  // Parse fields. Empty strings → null for optional ones.
  const title = strOrNull(formData.get('title'));
  const pickupTime = strOrNull(formData.get('pickup_time'));
  const endTime = strOrNull(formData.get('end_time'));
  const additionalChildIdsRaw = formData.getAll('additional_child_ids[]').map((v) => String(v));
  const notes = strOrNull(formData.get('notes'));

  const patch: Record<string, any> = {
    manually_arranged: true,
  };
  if (title != null) patch.title = title;
  if (pickupTime != null) patch.pickup_time = ensureSeconds(pickupTime);
  if (endTime != null) patch.end_time = endTime ? ensureSeconds(endTime) : null;
  if (notes !== undefined) patch.notes = notes;
  // additional_child_ids = always written (so clearing the list works
  // when the form sends zero values).
  patch.additional_child_ids = additionalChildIdsRaw;

  const { error: upErr } = await sb
    .from('pickup_slots')
    .update(patch)
    .eq('id', id)
    .eq('household_id', ctx.household!.id);
  if (upErr) return { ok: false, error: upErr.message };

  // If title changed AND this slot came from a Google Calendar event,
  // push the new title back to the source event so the family calendar
  // reflects it. Strip any "[Helper] " prefix first — it's a display
  // directive, not part of the slot's name.
  if (title && title !== existing.title && existing.source_event_id) {
    try {
      const { updateEventSummary } = await import('@/lib/google/calendar');
      await updateEventSummary(sb, ctx.household!.id, existing.source_event_id, title);
    } catch (e) {
      console.error('push title to Google failed', e);
    }
  }

  revalidatePath('/home');
  revalidatePath('/admin');
  return { ok: true };
}

export async function deleteSlotAction(formData: FormData): Promise<UpdateResult> {
  const ctx = await requireAdmin();
  const id = String(formData.get('slot_id') ?? '');
  if (!id) return { ok: false, error: 'missing slot_id' };

  const sb = supabaseAdmin();

  // Free up any related assignments first (FK won't auto-cascade for
  // notification_events.slot_id either, but the schema uses ON DELETE
  // SET NULL there so we don't need to touch them).
  await sb.from('slot_assignments').delete().eq('pickup_slot_id', id);
  const { error } = await sb
    .from('pickup_slots')
    .delete()
    .eq('id', id)
    .eq('household_id', ctx.household!.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/home');
  revalidatePath('/admin');
  return { ok: true };
}

function strOrNull(v: FormDataEntryValue | null): string | null | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : null;
}

function ensureSeconds(t: string): string {
  // Accept "HH:MM" → "HH:MM:00"; pass through "HH:MM:SS".
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
}
