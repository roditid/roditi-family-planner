'use client';
import { useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, format } from 'date-fns';
import type { CalView } from '@/lib/week';
import { stepForView } from '@/lib/week';

/**
 * Wraps the calendar body. Horizontal touch/pointer swipes navigate
 * forward/back by the view's step (1 / 3 / 7 days). Vertical scrolls
 * pass through untouched. ~80px threshold to avoid accidental triggers
 * during reading or scrolling at an angle.
 */
export default function SwipeArea({
  view, anchor, children,
}: { view: CalView; anchor: Date; children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  function nav(delta: number) {
    const next = addDays(anchor, delta * stepForView(view));
    const q = new URLSearchParams(params);
    q.set('d', format(next, 'yyyy-MM-dd'));
    router.replace(`?${q.toString()}`, { scroll: false });
  }

  useEffect(() => {
    // Schedule view is a forward-scrolling 4-week list — there's nothing to
    // swipe to. Skip the listener entirely so vertical reading doesn't
    // accidentally trigger horizontal nav.
    if (view === 'schedule') return;

    const el = ref.current;
    if (!el) return;

    function onStart(e: TouchEvent | PointerEvent) {
      const p = ('touches' in e) ? e.touches[0] : (e as PointerEvent);
      start.current = { x: p.clientX, y: p.clientY, t: Date.now() };
    }
    function onEnd(e: TouchEvent | PointerEvent) {
      if (!start.current) return;
      const p = ('changedTouches' in e) ? e.changedTouches[0] : (e as PointerEvent);
      const dx = p.clientX - start.current.x;
      const dy = p.clientY - start.current.y;
      const dt = Date.now() - start.current.t;
      start.current = null;
      // Must be primarily horizontal, ≥80px, and "quick" (< 800ms)
      if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.4 || dt > 800) return;
      nav(dx < 0 ? 1 : -1);  // swipe left = forward in time
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [view, anchor, params, router]);

  return <div ref={ref}>{children}</div>;
}
