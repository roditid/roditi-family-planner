/**
 * Weekly-summary message builders for the household.
 *
 * Three personas, three slightly different views:
 *
 *   • Grandparents (Liviu / Levanah / Eliane): a Saturday-evening reminder
 *     pointing at their personal claim page. They scan, claim what fits,
 *     and the rest gets handled by Paula on Sunday.
 *
 *   • Paula (Sunday morning): a count of unclaimed pickups for the upcoming
 *     week and a deep link into /admin/unassigned to clean them up.
 *
 *   • Liezel: a full breakdown of every pickup she's assigned for the week,
 *     refreshed any time the assignment landscape changes. She doesn't
 *     hunt; she just gets a plain list with addresses and ganenet phones.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';
import type { SlotView } from './types';
import { fetchSlots } from './slots';

function dateLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtKidNames(slot: SlotView) {
  return [slot.child, ...(slot.additional_children ?? [])].map((k) => k.name).join(' → ');
}

function fmtRoute(slot: SlotView) {
  const stops: string[] = [];
  if (slot.pickup_location) stops.push(slot.pickup_location.label);
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    if (sl) stops.push(sl.label);
  }
  if (slot.via_location) stops.push(slot.via_location.label);
  if (slot.destination_location) stops.push(slot.destination_location.label);
  return stops.join(' → ');
}

/**
 * Plain-text summary of every pickup assigned to a specific user across the
 * upcoming week. Used for Liezel's WhatsApp/email summary.
 */
export async function buildWeeklySummaryForUser(
  sb: SupabaseClient,
  householdId: string,
  userId: string,
  helperFirstName: string
): Promise<{ subject: string; body: string }> {
  const today = new Date();
  const startISO = format(today, 'yyyy-MM-dd');
  const endISO = format(addDays(today, 8), 'yyyy-MM-dd');
  const slots = await fetchSlots(sb, householdId, startISO, endISO);
  const mine = slots
    .filter((s) => s.assignment?.assigned_to_user_id === userId)
    .sort((a, b) => (a.date + a.pickup_time).localeCompare(b.date + b.pickup_time));

  const lines: string[] = [];
  lines.push(`Hi ${helperFirstName}, here's your week:`);
  lines.push('');

  if (mine.length === 0) {
    lines.push('No pickups assigned to you this week.');
  } else {
    let lastDate = '';
    for (const s of mine) {
      if (s.date !== lastDate) {
        if (lastDate) lines.push('');
        lines.push(dateLabel(s.date).toUpperCase());
        lastDate = s.date;
      }
      const time = s.pickup_time.slice(0, 5);
      const kids = fmtKidNames(s);
      const route = fmtRoute(s);
      lines.push(`${time} · ${kids} — ${s.title}`);
      if (route) lines.push(`  ${route}`);
    }
  }

  lines.push('');
  lines.push('Tap your personal link to see full details, addresses, and door codes:');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  lines.push(`${baseUrl}/my-pickups`);

  return {
    subject: `${helperFirstName} — your pickups for this week (${mine.length})`,
    body: lines.join('\n'),
  };
}

/**
 * Sunday-morning summary for Paula. Tells her how many slots still need a
 * helper and links straight into the unassigned-pickups admin page.
 */
export async function buildPaulaSundaySummary(
  sb: SupabaseClient,
  householdId: string,
  paulaFirstName: string
): Promise<{ subject: string; body: string }> {
  const today = new Date();
  const startISO = format(today, 'yyyy-MM-dd');
  const endISO = format(addDays(today, 8), 'yyyy-MM-dd');
  const slots = await fetchSlots(sb, householdId, startISO, endISO);
  const unclaimed = slots.filter((s) => s.status === 'unclaimed');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';

  const lines: string[] = [];
  lines.push(`Good morning, ${paulaFirstName}.`);
  lines.push('');
  if (unclaimed.length === 0) {
    lines.push('Every pickup this week has a helper. Nothing to assign.');
  } else {
    lines.push(`${unclaimed.length} pickup${unclaimed.length === 1 ? '' : 's'} still need a helper this week.`);
    lines.push('');
    lines.push('Quick view:');
    let lastDate = '';
    for (const s of unclaimed.slice(0, 12)) {
      if (s.date !== lastDate) {
        lines.push(dateLabel(s.date));
        lastDate = s.date;
      }
      const time = s.pickup_time.slice(0, 5);
      lines.push(`  ${time} · ${fmtKidNames(s)} — ${s.title}`);
    }
    if (unclaimed.length > 12) lines.push(`  …and ${unclaimed.length - 12} more`);
    lines.push('');
    lines.push(`Tap to assign Liezel and yourself: ${baseUrl}/admin/unassigned`);
  }

  return {
    subject: `Sunday recap — ${unclaimed.length} pickup${unclaimed.length === 1 ? '' : 's'} need a helper`,
    body: lines.join('\n'),
  };
}

/**
 * Saturday-evening reminder for the grandparents. Short and warm: just
 * point at their personal link and let them browse.
 */
export function buildGrandparentSaturdayReminder(
  helperFirstName: string,
  magicToken: string
): { subject: string; body: string } {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  const url = `${baseUrl}/i/${magicToken}`;
  const lines = [
    `Hi ${helperFirstName},`,
    ``,
    `Here are next week's pickups. Tap your link to see what's on and claim any you can do:`,
    ``,
    url,
    ``,
    `Whatever you don't claim, Paula and Liezel will pick up. Thanks for being there.`,
    ``,
    `— The Roditi family`,
  ];
  return {
    subject: `${helperFirstName} — pickups for this week`,
    body: lines.join('\n'),
  };
}
