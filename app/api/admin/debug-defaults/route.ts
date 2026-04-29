/**
 * Admin-only diagnostic for the defaults generator. Given ?date=YYYY-MM-DD,
 * returns the full picture of what the generator sees for that day:
 *   • All kids + which are eligible (school + home + dismissal_time set)
 *   • daily_overrides on that date (no_gan / early_dismissal)
 *   • All activity slots on that date and which kids they cover
 *   • The final "goingHome" list the generator would build
 *
 * Used to debug "why is X missing from the combined Gan→Home trip".
 * Safe to leave deployed — guarded by admin role.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'pass ?date=YYYY-MM-DD' }, { status: 400 });
  }
  const sb = supabaseServer();
  const householdId = ctx.household!.id;

  const { data: kids } = await sb
    .from('children')
    .select('id, name, color, school_location_id, home_location_id, gan_dismissal_time')
    .eq('household_id', householdId);

  const eligible = (kids ?? []).map((k: any) => ({
    id: k.id,
    name: k.name,
    school_location_id: k.school_location_id,
    home_location_id: k.home_location_id,
    gan_dismissal_time: k.gan_dismissal_time,
    eligible: !!(k.school_location_id && k.home_location_id && k.gan_dismissal_time),
    why_not: [
      !k.school_location_id ? 'missing school_location_id' : null,
      !k.home_location_id ? 'missing home_location_id' : null,
      !k.gan_dismissal_time ? 'missing gan_dismissal_time' : null,
    ].filter(Boolean),
  }));

  const { data: overrides } = await sb
    .from('daily_overrides')
    .select('child_id, kind, dismissal_time, notes, source_event_id')
    .eq('household_id', householdId)
    .eq('date', date);

  const { data: activitySlots } = await sb
    .from('pickup_slots')
    .select('id, child_id, additional_child_ids, title, pickup_time, source, status, activity_id')
    .eq('household_id', householdId)
    .eq('date', date)
    .not('activity_id', 'is', null);

  const { data: autoDefaults } = await sb
    .from('pickup_slots')
    .select('id, child_id, additional_child_ids, title, pickup_time, source, status')
    .eq('household_id', householdId)
    .eq('date', date)
    .eq('source', 'auto-default');

  // Build the same earliestActivityPickup map the generator uses, so we can
  // show which kids the generator currently considers "covered" by an
  // activity (and therefore skips for Gan→Home defaults).
  const coverage: Record<string, { earliest: string; bySlot: string }> = {};
  for (const s of activitySlots ?? []) {
    const ids = [s.child_id, ...((s.additional_child_ids ?? []) as string[])];
    for (const id of ids) {
      const prev = coverage[id];
      if (!prev || s.pickup_time < prev.earliest) {
        coverage[id] = { earliest: s.pickup_time, bySlot: `${s.title} (${s.pickup_time})` };
      }
    }
  }

  // Simulate the goingHome decision for each eligible kid.
  const noGanIds = new Set((overrides ?? []).filter((o: any) => o.kind === 'no_gan').map((o: any) => o.child_id));
  const dismissalOverrides: Record<string, string> = {};
  for (const o of overrides ?? []) {
    if (o.kind === 'early_dismissal' && o.dismissal_time && o.child_id) {
      dismissalOverrides[o.child_id] = o.dismissal_time;
    }
  }
  const goingHome = eligible
    .filter((k: any) => k.eligible)
    .map((k: any) => {
      const dismissal = dismissalOverrides[k.id] ?? k.gan_dismissal_time;
      const cov = coverage[k.id];
      const noGan = noGanIds.has(k.id);
      const decision = noGan
        ? 'skip — no_gan'
        : !cov
          ? 'include — no activity'
          : cov.earliest <= dismissal
            ? `skip — covered by ${cov.bySlot}`
            : `include — activity ${cov.bySlot} starts AFTER dismissal ${dismissal}`;
      return {
        id: k.id,
        name: k.name,
        dismissal,
        coverage: cov ?? null,
        no_gan: noGan,
        decision,
      };
    });

  // Also pull the raw calendar_events table for this date, so we can see
  // what Google sent us and whether the early-dismissal title pattern was
  // recognized. We probe the same regex the calendar import uses.
  const dayStartUtc = new Date(date + 'T00:00:00Z');
  const nextDayUtc = new Date(date + 'T00:00:00Z');
  nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
  const probeStart = new Date(date + 'T00:00:00Z');
  probeStart.setUTCHours(probeStart.getUTCHours() - 12); // include all-day events that started "yesterday" in UTC
  const { data: calEvents } = await sb
    .from('calendar_events')
    .select('id, title, start_at, end_at, location_text, description')
    .eq('household_id', householdId)
    .gte('start_at', probeStart.toISOString())
    .lt('start_at', nextDayUtc.toISOString())
    .order('start_at');

  // Re-run the detection patterns from lib/google/calendar.ts so we can
  // see what each title would parse as without re-syncing.
  const childNames = (kids ?? []).map((k: any) => k.name);
  function detect(title: string) {
    const t = title.trim();
    if (/prep\s*day\s*(for\s*)?tomorrow/i.test(t)) return { kind: 'prep_day' };
    const noGan = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*no\s*gan\s*$/i);
    if (noGan) return { kind: 'no_gan', kids: noGan[1] };
    const until = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*gan\s*until\s*(\d{1,2})[:.](\d{2})/i);
    if (until) return { kind: 'early_dismissal', kids: until[1], time: `${until[2]}:${until[3]}` };
    const lastDay = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*last\s*day\s*of\s*gan/i);
    if (lastDay) return { kind: 'last_day_school', kids: lastDay[1] };
    return null;
  }

  const calendarEventsWithDetection = (calEvents ?? []).map((e: any) => ({
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    detected_as: detect(e.title ?? ''),
  }));

  return NextResponse.json({
    date,
    household_id: householdId,
    kids: eligible,
    overrides: overrides ?? [],
    activity_slots: activitySlots ?? [],
    auto_defaults_currently_in_db: autoDefaults ?? [],
    going_home_decision: goingHome,
    calendar_events_seen: calendarEventsWithDetection,
  }, { status: 200 });
}
