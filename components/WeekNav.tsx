'use client';
import { addDays, format } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';

export default function WeekNav({ anchor }: { anchor: Date }) {
  const router = useRouter();
  const params = useSearchParams();

  function go(offsetDays: number) {
    const next = addDays(anchor, offsetDays);
    const q = new URLSearchParams(params);
    q.set('w', format(next, 'yyyy-MM-dd'));
    router.push(`?${q.toString()}`);
  }

  const end = addDays(anchor, 6);
  const label = format(anchor, 'MMM d') + ' – ' + format(end, 'MMM d');

  return (
    <div className="flex items-center gap-2 justify-between">
      <button onClick={() => go(-7)} className="btn-ghost text-sm px-3 py-1.5" aria-label="Previous week">← Prev</button>
      <div className="font-display text-lg">{label}</div>
      <button onClick={() => go(7)} className="btn-ghost text-sm px-3 py-1.5" aria-label="Next week">Next →</button>
    </div>
  );
}
