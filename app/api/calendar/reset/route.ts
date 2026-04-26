/**
 * Reset & resync — wipes ALL calendar-sourced state for the household, then
 * triggers a fresh sync. Use this when Paula switches the connected calendar
 * to a different account (e.g. roditikids@gmail.com) so old slots don't
 * linger as orphans referencing events that no longer exist.
 *
 * Preserves manual slots and auto-default Gan→Home slots — only blows away
 * source='calendar' slots, calendar_events, and daily_overrides.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncCalendar } from '@/lib/google/calendar';
import { generateDefaultSlots } from '@/lib/defaults';

export async function POST() {
  try {
    const ctx = await requireAdmin();
    const sb = supabaseAdmin();
    const householdId = ctx.household!.id;

    // Wipe in dependency order
    await sb.from('pickup_slots')
      .delete()
      .eq('household_id', householdId)
      .eq('source', 'calendar');
    await sb.from('daily_overrides').delete().eq('household_id', householdId);
    await sb.from('calendar_events').delete().eq('household_id', householdId);

    // Resync from the connected calendar
    const sync = await syncCalendar(sb, householdId, 30);
    const defaults = await generateDefaultSlots(sb, householdId, 30);

    return NextResponse.redirect(
      new URL(
        `/admin/calendar?reset=1&events=${sync.eventsSeen}&slots=${sync.slotsCreated}&defaults=${defaults.slotsCreated}`,
        process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      ),
      { status: 303 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
