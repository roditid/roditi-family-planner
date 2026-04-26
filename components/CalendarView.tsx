import { format } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { SlotView } from '@/lib/types';
import { type CalView, daysForView, isoDay, isToday, prettyDay, shortDay, dayNumber } from '@/lib/week';
import { relativeDay } from '@/lib/relative-time';
import CalendarToolbar from './CalendarToolbar';
import SlotChip from './SlotChip';
import SwipeArea from './SwipeArea';

interface Props {
  view: CalView;
  anchor: Date;
  slots: SlotView[];
  currentUserId: string;
  currentUserPhone?: string | null;
  currentUserName?: string | null;
  isAdmin?: boolean;
  onlyMine?: boolean;
}

/**
 * Four layouts, à la Google Calendar:
 *  - schedule: vertical agenda — one day after another, all events in line
 *  - day:      single day, vertical
 *  - 3-day:    three day-columns side-by-side
 *  - week:     seven day-columns side-by-side (horizontal scroll on mobile)
 */
export default function CalendarView({ view, anchor, slots, currentUserId, currentUserPhone, currentUserName, isAdmin, onlyMine }: Props) {
  const days = daysForView(view, anchor);
  // Past pickups (30+ min past pickup_time) are filtered out of the
  // schedule + day views so the chip list only shows what's actionable.
  // The week view KEEPS past slots so the helper sees a full week's
  // record — chips for past slots render in a "done" state inside SlotChip.
  const nowMs = Date.now();
  const stillRelevant = (s: SlotView) => {
    const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, 'Asia/Jerusalem');
    return slotUtc.getTime() > nowMs - 30 * 60 * 1000;
  };
  const upcoming = view === 'week' ? slots : slots.filter(stillRelevant);
  const filtered = onlyMine
    ? upcoming.filter((s) => s.assignment?.assigned_to_user_id === currentUserId)
    : upcoming;
  const byDay = new Map<string, SlotView[]>();
  for (const s of filtered) {
    const k = s.date;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }

  const rangeLabel =
    view === 'day' ? format(days[0], 'EEEE, MMMM d')
      : `${format(days[0], 'MMM d')} – ${format(days[days.length - 1], 'MMM d')}`;

  return (
    <div className="space-y-3">
      <CalendarToolbar view={view} anchor={anchor} rangeLabel={rangeLabel} />

      <SwipeArea view={view} anchor={anchor}>
        {view === 'schedule' && <ScheduleLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} isAdmin={isAdmin} />}
        {view === 'day'      && <ScheduleLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} isAdmin={isAdmin} />}
        {view === 'week'     && <ColumnsLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} isAdmin={isAdmin} cols={7} />}
      </SwipeArea>

      {filtered.length === 0 && (() => {
        // Three different "empty" reasons need three different messages:
        //   1. onlyMine — helper has nothing claimed (raw doesn't matter)
        //   2. raw > 0 but everything is past — pickups happened, day's done
        //   3. raw === 0 — truly nothing scheduled
        const allPast = !onlyMine && slots.length > 0 && upcoming.length === 0;
        const headline = onlyMine
          ? "You're not on any pickups yet."
          : allPast
            ? 'Today\'s pickups are all done.'
            : 'Nothing scheduled.';
        const sub = onlyMine
          ? 'Tap any open pickup below to claim it.'
          : allPast
            ? 'Nice work. Check tomorrow or next week.'
            : 'Quiet stretch — check next week.';
        const icon = allPast ? '✓' : '🌿';
        return (
          <div className="card p-8 text-center mt-4">
            <div className="text-3xl mb-2">{icon}</div>
            <p className="font-medium">{headline}</p>
            <p className="text-sm text-ink-700/65 mt-1">{sub}</p>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Schedule + Day: vertical, day-by-day list
// ─────────────────────────────────────────────────────────────────────

function ScheduleLayout({ days, byDay, currentUserId, currentUserPhone, currentUserName, isAdmin }: { days: Date[]; byDay: Map<string, SlotView[]>; currentUserId: string; currentUserPhone?: string | null; currentUserName?: string | null; isAdmin?: boolean }) {
  // Schedule view: only render days that actually have pickups. The list
  // scrolls forward through the next ~4 weeks; empty Fri/Sat (Israeli weekend)
  // and Picnic-Lag-only days collapse out so the agenda reads tight.
  const populatedDays = days.filter((d) => (byDay.get(isoDay(d))?.length ?? 0) > 0);
  return (
    <div className="space-y-6 pp-stagger">
      {populatedDays.map((d) => {
        const k = isoDay(d);
        const todays = (byDay.get(k) ?? []).sort((a, b) => a.pickup_time.localeCompare(b.pickup_time));
        const today = isToday(d);
        const rel = relativeDay(k);
        // Show the relative-when chip in EVERY header (today / tomorrow /
        // this week / next week / in N weeks). Coral for today/tomorrow so
        // urgency reads instantly; sage for further out.
        const chipClass = rel === 'today' || rel === 'tomorrow'
          ? 'bg-coral-400/15 text-coral-600'
          : 'bg-black/[0.05] text-ink-700/65';
        return (
          <section key={k}>
            <div className="px-1 mb-2 flex items-baseline gap-3 flex-wrap">
              <h2 className={`font-display text-xl sm:text-2xl tracking-tight ${today ? 'text-sage-700' : ''}`}>
                {prettyDay(d)}
              </h2>
              {rel !== 'past' && (
                <span className={`text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded-full ${chipClass}`}>
                  {rel}
                </span>
              )}
              <span className="text-xs text-ink-700/45 ml-auto tabular-nums">{todays.length} pickup{todays.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-2">
              {todays.map((s) => (
                <SlotChip key={s.id} slot={s} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} isAdmin={isAdmin} density="roomy" />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3-day + Week: side-by-side columns. On narrow screens, columns stay
// reasonable width and the row scrolls horizontally with snap points.
// ─────────────────────────────────────────────────────────────────────

function ColumnsLayout({
  days, byDay, currentUserId, currentUserPhone, currentUserName, isAdmin, cols,
}: { days: Date[]; byDay: Map<string, SlotView[]>; currentUserId: string; currentUserPhone?: string | null; currentUserName?: string | null; isAdmin?: boolean; cols: 7 }) {
  // Week: keeps 7 cols viable but each is a real card with route + status.
  const minColWidth = 150;
  // Past = pickup time more than 30 min ago in IL local time. Used to
  // collapse a column whose every chip has already happened.
  const nowMs = Date.now();
  const isPastSlot = (s: SlotView) => {
    const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, 'Asia/Jerusalem');
    return slotUtc.getTime() < nowMs - 30 * 60 * 1000;
  };
  return (
    <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 snap-x snap-mandatory pb-2">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(${minColWidth}px, 1fr))`,
          minWidth: cols === 7 ? `${cols * minColWidth + 12}px` : undefined,
        }}
      >
        {days.map((d) => {
          const k = isoDay(d);
          const todays = (byDay.get(k) ?? []).sort((a, b) => a.pickup_time.localeCompare(b.pickup_time));
          // If every chip in this day is past, replace the whole stack with
          // a single "All done" tile (mirrors the day-view empty state).
          const allPast = todays.length > 0 && todays.every(isPastSlot);
          return (
            <div key={k} className="snap-start min-w-0">
              <DayHeader d={d} count={todays.length} />
              <div className="mt-2 space-y-1.5 min-h-[80px]">
                {todays.length === 0 ? (
                  <EmptyDay />
                ) : allPast ? (
                  <DayDone count={todays.length} />
                ) : (
                  todays.map((s) => (
                    <SlotChip key={s.id} slot={s} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} isAdmin={isAdmin} density="compact" />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayHeader({ d, count }: { d: Date; count: number }) {
  const today = isToday(d);
  return (
    <div className="px-1 pt-1 flex items-baseline gap-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-700/55 font-semibold">{shortDay(d)}</div>
      <div className={`font-display text-xl leading-none ${today ? 'text-sage-700' : ''}`}>{dayNumber(d)}</div>
      {today && <span className="chip bg-sage-500 text-cream-50 text-[9px] px-1.5 py-0.5 leading-none">today</span>}
      {count > 0 && <span className="ml-auto text-[11px] text-ink-700/45 tabular-nums">{count}</span>}
    </div>
  );
}

function EmptyDay() {
  return (
    <div className="rounded-lg border border-dashed border-black/10 px-2 py-3 text-center text-[11px] text-ink-700/40">—</div>
  );
}

/** Compact "all done" tile for week-view columns whose pickups have
 *  all already happened. Mirrors the day-view empty state. */
function DayDone({ count }: { count: number }) {
  return (
    <div className="rounded-xl bg-cream-200/40 px-2 py-4 text-center">
      <div className="text-2xl mb-1">✓</div>
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-700/65">All done</div>
      <div className="text-[10px] text-ink-700/45 mt-0.5 tabular-nums">{count} pickup{count === 1 ? '' : 's'}</div>
    </div>
  );
}
