'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, format, parseISO } from 'date-fns';
import type { CalView } from '@/lib/week';
import { stepForView } from '@/lib/week';

interface Props {
  view: CalView;
  anchor: Date;
  rangeLabel: string;
}

export default function CalendarToolbar({ view, anchor, rangeLabel }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function navigate(updates: Record<string, string | undefined>) {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`?${q.toString()}`);
  }

  function step(delta: number) {
    const next = addDays(anchor, delta * stepForView(view));
    navigate({ d: format(next, 'yyyy-MM-dd') });
  }

  function setView(v: CalView) {
    navigate({ v });
  }

  function goToday() {
    navigate({ d: format(new Date(), 'yyyy-MM-dd') });
  }

  return (
    <div className="sticky top-14 z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 py-3 bg-cream-100/95 backdrop-blur border-b border-black/5">
      <div className="flex items-center gap-2 justify-between flex-wrap">
        {/* View toggle */}
        <div className="inline-flex rounded-xl bg-black/5 p-1 text-sm">
          <ViewBtn label="Day"    v="day"   active={view === 'day'}   onClick={() => setView('day')} />
          <ViewBtn label="3-day"  v="3day"  active={view === '3day'}  onClick={() => setView('3day')} />
          <ViewBtn label="Week"   v="week"  active={view === 'week'}  onClick={() => setView('week')} />
        </div>

        {/* Date nav */}
        <div className="inline-flex items-center gap-1">
          <button onClick={() => step(-1)} aria-label="Previous"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 text-lg">←</button>
          <button onClick={goToday} className="px-3 py-1.5 rounded-lg hover:bg-black/5 text-sm font-medium">
            Today
          </button>
          <button onClick={() => step(1)} aria-label="Next"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-black/5 text-lg">→</button>
        </div>
      </div>

      <div className="mt-2 font-display text-lg sm:text-xl">{rangeLabel}</div>
    </div>
  );
}

function ViewBtn({ label, active, onClick }: { label: string; v: CalView; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-lg transition font-medium ' +
        (active ? 'bg-cream-50 shadow-sm text-ink-900' : 'text-ink-700/70 hover:text-ink-900')
      }
    >
      {label}
    </button>
  );
}
