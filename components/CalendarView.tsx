import { format } from 'date-fns';
import type { SlotView } from '@/lib/types';
import { type CalView, daysForView, isoDay, isToday, shortDay, dayNumber } from '@/lib/week';
import CalendarToolbar from './CalendarToolbar';
import SlotChip from './SlotChip';

interface Props {
  view: CalView;
  anchor: Date;
  slots: SlotView[];
  currentUserId: string;
  /** When set, filter to only slots assigned to this user (for "my pickups" mode). */
  onlyMine?: boolean;
}

export default function CalendarView({ view, anchor, slots, currentUserId, onlyMine }: Props) {
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
    view === 'day'
      ? format(days[0], 'EEEE, MMMM d')
      : `${format(days[0], 'MMM d')} – ${format(days[days.length - 1], 'MMM d')}`;

  // Layout: each column min-w-[170px] (~enough for time + child + 5-char title).
  // On narrow screens the row scrolls horizontally with snap points so a swipe
  // between days feels deliberate instead of cramped.
  const density: 'compact' | 'roomy' = view === 'day' ? 'roomy' : 'compact';

  return (
    <div className="space-y-2">
      <CalendarToolbar view={view} anchor={anchor} rangeLabel={rangeLabel} />

      <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 snap-x snap-mandatory">
        <div
          className="grid gap-2 pb-4"
          style={{
            gridTemplateColumns:
              view === 'day'
                ? 'minmax(280px, 1fr)'
                : view === '3day'
                  ? 'repeat(3, minmax(220px, 1fr))'
                  : 'repeat(5, minmax(170px, 1fr))',
          }}
        >
          {days.map((d) => {
            const k = isoDay(d);
            const todays = (byDay.get(k) ?? []).sort((a, b) => a.pickup_time.localeCompare(b.pickup_time));
            return (
              <div key={k} className="snap-start">
                <DayHeader d={d} count={todays.length} />
                <div className="mt-2 space-y-1.5 min-h-[80px]">
                  {todays.length === 0 ? (
                    <EmptyDay />
                  ) : (
                    todays.map((s) => (
                      <SlotChip key={s.id} slot={s} currentUserId={currentUserId} density={density} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayHeader({ d, count }: { d: Date; count: number }) {
  const today = isToday(d);
  return (
    <div className="px-1 pt-1 flex items-baseline gap-2">
      <div className="text-xs uppercase tracking-wider text-ink-700/60">{shortDay(d)}</div>
      <div className={`font-display text-2xl leading-none ${today ? 'text-sage-600' : ''}`}>{dayNumber(d)}</div>
      {today && <span className="chip bg-sage-500 text-cream-50 text-[10px] px-2 py-0.5">today</span>}
      {count > 0 && (
        <span className="ml-auto text-xs text-ink-700/50">{count}</span>
      )}
    </div>
  );
}

function EmptyDay() {
  return (
    <div className="rounded-xl border border-dashed border-black/10 px-3 py-4 text-center text-xs text-ink-700/45">
      nothing
    </div>
  );
}
