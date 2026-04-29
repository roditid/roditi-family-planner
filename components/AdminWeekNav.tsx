'use client';
/**
 * Compact week-step nav for the admin dashboard. Mirrors the CalendarToolbar
 * pattern (`?d=YYYY-MM-DD` query param, ±7 day steps, "today" jump in the
 * middle) so the dashboard browses through future weeks the same way the
 * helper-facing schedule does.
 *
 * Past weeks aren't reachable — Paula doesn't want yesterday's pickups in
 * her view, and the page itself clamps anchor to today. The Prev button
 * is disabled when the current week is already this week.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';

interface Props {
  anchor: Date;
  rangeLabel: string;
}

export default function AdminWeekNav({ anchor, rangeLabel }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function navigate(d: Date) {
    const q = new URLSearchParams(params);
    q.set('d', format(d, 'yyyy-MM-dd'));
    router.replace(`?${q.toString()}`, { scroll: false });
  }

  function step(deltaDays: number) {
    navigate(addDays(anchor, deltaDays));
  }

  function goToday() {
    navigate(new Date());
  }

  // Prev disabled when the current anchor is already in this week.
  const todayStart = startOfDay(new Date());
  const anchorStart = startOfDay(anchor);
  const sameWeek =
    isSameDay(anchorStart, todayStart) ||
    (anchorStart >= todayStart && anchorStart < addDays(todayStart, 7));
  const prevDisabled = sameWeek;

  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        onClick={() => step(-7)}
        disabled={prevDisabled}
        aria-label="Previous week"
        className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 active:scale-90 transition-transform text-lg disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        ←
      </button>
      <button
        onClick={goToday}
        title="Jump to this week"
        className="px-3 py-1.5 rounded-lg hover:bg-black/5 active:scale-95 transition-transform font-display text-base sm:text-lg tabular-nums text-ink-800"
      >
        {rangeLabel}
      </button>
      <button
        onClick={() => step(7)}
        aria-label="Next week"
        className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 active:scale-90 transition-transform text-lg"
      >
        →
      </button>
    </div>
  );
}
