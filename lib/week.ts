import { addDays, format, parseISO, startOfWeek } from 'date-fns';

export type CalView = 'schedule' | 'day' | 'week';

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
 *  - schedule: Sun→Thu of the anchor's school week (5 days, vertical).
 *  - day:      anchor only.
 *  - week:     Sun→Thu of the anchor's school week (5 columns side-by-side).
 *
 * Both schedule and week snap to Sunday so weeks always read as
 * separated units. Tapping prev/next steps a full week either way.
 */
export function daysForView(view: CalView, anchor: Date | string = new Date()): Date[] {
  const a = typeof anchor === 'string' ? parseISO(anchor) : anchor;
  if (view === 'day') return [a];
  // schedule + week → Sun..Thu of anchor's week
  const sunday = weekStart(a);
  return [0, 1, 2, 3, 4].map((i) => addDays(sunday, i));
}

/** Step amount when user clicks prev/next, in days. */
export function stepForView(view: CalView): number {
  if (view === 'day') return 1;
  return 7; // schedule + week — both step a full week
}

/**
 * End of the current Israeli school week (Sunday–Thursday). If today is
 * Sun..Thu, returns end-of-Thursday this week. If today is Fri or Sat,
 * returns end-of-Thursday next week (school resumes Sunday).
 */
export function endOfSchoolWeek(now = new Date()): Date {
  const dow = now.getDay(); // 0=Sun..6=Sat
  const daysToThursday = dow <= 4 ? 4 - dow : (4 - dow + 7);
  const thursday = addDays(now, daysToThursday);
  thursday.setHours(23, 59, 59, 999);
  return thursday;
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
