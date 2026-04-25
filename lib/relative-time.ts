/**
 * Relative-time helpers for the schedule view. Built on top of date-fns and
 * tuned for the helper-grandparent UX: short labels, never ambiguous, with
 * an explicit urgency hint for pickups that are very soon.
 *
 * Examples:
 *   relativeDay('2026-04-26') → 'today' / 'tomorrow' / 'this week' / 'next week' / 'in 2 weeks'
 *   relativeTimeUntil('2026-04-26', '16:30') → null | 'in 4 hours' | 'in 25 min' | 'starting now'
 */
import { differenceInCalendarDays, differenceInMinutes, parseISO } from 'date-fns';

/** "today" | "tomorrow" | "this week" | "next week" | "in N weeks" */
export function relativeDay(dateISO: string, now = new Date()): string {
  const target = parseISO(dateISO);
  const days = differenceInCalendarDays(target, now);
  if (days < 0) return 'past';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  // "This week" = the same calendar week as today (Sunday-anchored, Israeli).
  // We approximate by treating Sun..Sat starting from this Sunday as "this week".
  const todayDow = now.getDay(); // 0=Sun
  const daysIntoThisWeek = todayDow; // 0..6 already past in this week
  const daysLeftThisWeek = 6 - todayDow + 1; // through Sat
  if (days < daysLeftThisWeek) return 'this week';
  if (days < daysLeftThisWeek + 7) return 'next week';
  const weeks = Math.ceil(days / 7);
  return `in ${weeks} weeks`;
}

/**
 * Returns a relative time string ONLY when the pickup is about to happen
 * (within the next 6 hours). Otherwise returns null so the chip stays
 * uncluttered.
 *
 * The `urgent` flag is true when the pickup is < 30 min away — caller can
 * use it to color the label coral / pulse it for attention.
 */
export function relativeTimeUntil(
  dateISO: string,
  timeHHMMSS: string,
  now = new Date()
): { label: string; urgent: boolean } | null {
  const [hh, mm] = timeHHMMSS.split(':');
  const target = parseISO(dateISO);
  target.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
  const mins = differenceInMinutes(target, now);
  if (mins < -30) return null;          // already happened
  if (mins > 6 * 60) return null;       // too far in the future to bother

  if (mins <= 0) return { label: 'starting now', urgent: true };
  if (mins < 60) return { label: `in ${mins} min`, urgent: mins < 30 };
  const hours = Math.round(mins / 60);
  return { label: `in ${hours} hour${hours === 1 ? '' : 's'}`, urgent: false };
}
