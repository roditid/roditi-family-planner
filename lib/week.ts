import { addDays, format, parseISO, startOfWeek } from 'date-fns';

export type CalView = 'schedule' | 'day' | '3day' | 'week';

export function weekStart(d: Date | string = new Date()) {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return startOfWeek(date, { weekStartsOn: 0 }); // Sunday — Israeli week
}

export function weekRange(anchor: Date | string = new Date()) {
  const start = weekStart(anchor);
  const end = addDays(start, 7);
  return { start, end, startISO: format(start, 'yyyy-MM-dd'), endISO: format(end, 'yyyy-MM-dd') };
}

/** Sun..Thu — the Israeli school week. */
export function schoolWeekDays(anchor: Date | string = new Date()) {
  const sun = weekStart(anchor);
  return [0, 1, 2, 3, 4].map((i) => addDays(sun, i));
}

/**
 * Default anchor when the user doesn't pass `?d=`.
 *  Today. The 'week' view shows today + next 6 days, so this is what
 *  helpers see when they arrive: a rolling 7-day window starting now.
 */
export function defaultAnchor(now = new Date()) {
  return now;
}

export function daysOfWeek(anchor: Date | string = new Date()) {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Days the calendar should render for a given view, anchored on `anchor`.
 *  - schedule: anchor + next 27 (4-week vertical agenda — long-form scroll)
 *  - day:      anchor only
 *  - 3day:     anchor + next 2 (3 columns side-by-side)
 *  - week:     anchor + next 6 (7 columns side-by-side)
 *
 * The schedule view spans 4 weeks so helpers can scroll forward through the
 * month without paging. Past days are filtered out at the page level so
 * yesterday's pickups never appear.
 */
export function daysForView(view: CalView, anchor: Date | string = new Date()): Date[] {
  const a = typeof anchor === 'string' ? parseISO(anchor) : anchor;
  if (view === 'day') return [a];
  if (view === '3day') return [0, 1, 2].map((i) => addDays(a, i));
  if (view === 'schedule') return Array.from({ length: 28 }, (_, i) => addDays(a, i));
  // week = 7 columns side-by-side
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(a, i));
}

/** Step amount when user clicks prev/next, in days. */
export function stepForView(view: CalView): number {
  if (view === 'day') return 1;
  if (view === '3day') return 3;
  return 7; // schedule + week
}

export function prettyDay(d: Date) { return format(d, 'EEEE, MMM d'); }
export function shortDay(d: Date) { return format(d, 'EEE'); }
export function dayNumber(d: Date) { return format(d, 'd'); }
export function isoDay(d: Date) { return format(d, 'yyyy-MM-dd'); }
export function isToday(d: Date) {
  return isoDay(d) === isoDay(new Date());
}
export function prettyTime(t: string) {
  const [h, m] = t.split(':');
  return `${h}:${m}`;
}
