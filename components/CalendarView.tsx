import { format } from 'date-fns';
import type { SlotView } from '@/lib/types';
import { type CalView, daysForView, isoDay, isToday, prettyDay } from '@/lib/week';
import CalendarToolbar from './CalendarToolbar';
import SlotChip from './SlotChip';

interface Props {
  view: CalView;
  anchor: Date;
  slots: SlotView[];
  currentUserId: string;
  /** When set, filter to only slots assigned to this user. */
  onlyMine?: boolean;
}

/**
 * Vertical day-stack layout. Mobile-first: scrolling top-to-bottom is the
 * grandparent-native gesture. Day / 3-day / Week now choose how many days
 * to show, not the layout — there's no horizontal scrolling to fight with.
 */
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

  return (
    <div className="space-y-3">
      <CalendarToolbar view={view} anchor={anchor} rangeLabel={rangeLabel} />

      <div className="space-y-5">
        {days.map((d) => {
          const k = isoDay(d);
          const todays = (byDay.get(k) ?? []).sort((a, b) => a.pickup_time.localeCompare(b.pickup_time));
          return <DayBlock key={k} date={d} slots={todays} currentUserId={currentUserId} />;
        })}
      </div>

      {filtered.length === 0 && (
        <div className="card p-8 text-center mt-4">
          <div className="text-3xl mb-2">🌿</div>
          <p className="font-medium">{onlyMine ? "You're not on any pickups yet." : "Nothing scheduled."}</p>
          <p className="text-sm text-ink-700/65 mt-1">
            {onlyMine ? 'Tap any open pickup below to claim it.' : 'Quiet stretch — sync the calendar or check next week.'}
          </p>
        </div>
      )}
    </div>
  );
}

function DayBlock({ date, slots, currentUserId }: { date: Date; slots: SlotView[]; currentUserId: string }) {
  const today = isToday(date);
  const empty = slots.length === 0;
  return (
    <section>
      <div className="px-1 mb-2 flex items-baseline gap-3">
        <h2 className={`font-display text-xl sm:text-2xl tracking-tight ${today ? 'text-sage-700' : ''}`}>
          {prettyDay(date)}
        </h2>
        {today && <span className="chip bg-sage-500 text-cream-50 text-[10px] px-2 py-0.5 leading-none">today</span>}
        {!empty && <span className="text-xs text-ink-700/45 ml-auto tabular-nums">{slots.length} pickup{slots.length === 1 ? '' : 's'}</span>}
      </div>
      {empty ? (
        <div className="rounded-xl border border-dashed border-black/10 px-4 py-3 text-sm text-ink-700/45">
          —
        </div>
      ) : (
        <div className="space-y-2">
          {slots.map((s) => (
            <SlotChip key={s.id} slot={s} currentUserId={currentUserId} density="roomy" />
          ))}
        </div>
      )}
    </section>
  );
}
