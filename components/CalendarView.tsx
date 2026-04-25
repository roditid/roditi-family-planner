import { format } from 'date-fns';
import type { SlotView } from '@/lib/types';
import { type CalView, daysForView, isoDay, isToday, prettyDay, shortDay, dayNumber } from '@/lib/week';
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
  onlyMine?: boolean;
}

/**
 * Four layouts, à la Google Calendar:
 *  - schedule: vertical agenda — one day after another, all events in line
 *  - day:      single day, vertical
 *  - 3-day:    three day-columns side-by-side
 *  - week:     seven day-columns side-by-side (horizontal scroll on mobile)
 */
export default function CalendarView({ view, anchor, slots, currentUserId, currentUserPhone, currentUserName, onlyMine }: Props) {
  const days = daysForView(view, anchor);
  const filtered = onlyMine
    ? slots.filter((s) => s.assignment?.assigned_to_user_id === currentUserId)
    : slots;
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
        {view === 'schedule' && <ScheduleLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} />}
        {view === 'day'      && <ScheduleLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} />}
        {view === '3day'     && <ColumnsLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} cols={3} />}
        {view === 'week'     && <ColumnsLayout days={days} byDay={byDay} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} cols={7} />}
      </SwipeArea>

      {filtered.length === 0 && (
        <div className="card p-8 text-center mt-4">
          <div className="text-3xl mb-2">🌿</div>
          <p className="font-medium">{onlyMine ? "You're not on any pickups yet." : "Nothing scheduled."}</p>
          <p className="text-sm text-ink-700/65 mt-1">
            {onlyMine ? 'Tap any open pickup below to claim it.' : 'Quiet stretch — check next week.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Schedule + Day: vertical, day-by-day list
// ─────────────────────────────────────────────────────────────────────

function ScheduleLayout({ days, byDay, currentUserId, currentUserPhone, currentUserName }: { days: Date[]; byDay: Map<string, SlotView[]>; currentUserId: string; currentUserPhone?: string | null; currentUserName?: string | null }) {
  return (
    <div className="space-y-5">
      {days.map((d) => {
        const k = isoDay(d);
        const todays = (byDay.get(k) ?? []).sort((a, b) => a.pickup_time.localeCompare(b.pickup_time));
        const today = isToday(d);
        const empty = todays.length === 0;
        return (
          <section key={k}>
            <div className="px-1 mb-2 flex items-baseline gap-3">
              <h2 className={`font-display text-xl sm:text-2xl tracking-tight ${today ? 'text-sage-700' : ''}`}>
                {prettyDay(d)}
              </h2>
              {today && <span className="chip bg-sage-500 text-cream-50 text-[10px] px-2 py-0.5 leading-none">today</span>}
              {!empty && <span className="text-xs text-ink-700/45 ml-auto tabular-nums">{todays.length} pickup{todays.length === 1 ? '' : 's'}</span>}
            </div>
            {empty ? (
              <div className="rounded-xl border border-dashed border-black/10 px-4 py-3 text-sm text-ink-700/45">—</div>
            ) : (
              <div className="space-y-2">
                {todays.map((s) => (
                  <SlotChip key={s.id} slot={s} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} density="roomy" />
                ))}
              </div>
            )}
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
  days, byDay, currentUserId, currentUserPhone, currentUserName, cols,
}: { days: Date[]; byDay: Map<string, SlotView[]>; currentUserId: string; currentUserPhone?: string | null; currentUserName?: string | null; cols: 3 | 7 }) {
  // 3-day: 3 cols always fit on phone (~120px each)
  // Week: 7 cols at min 130px each → scrolls on phones with snap-x
  const minColWidth = cols === 3 ? 100 : 130;
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
          return (
            <div key={k} className="snap-start min-w-0">
              <DayHeader d={d} count={todays.length} />
              <div className="mt-2 space-y-1.5 min-h-[80px]">
                {todays.length === 0 ? (
                  <EmptyDay />
                ) : (
                  todays.map((s) => (
                    <SlotChip key={s.id} slot={s} currentUserId={currentUserId} currentUserPhone={currentUserPhone} currentUserName={currentUserName} density="compact" />
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
