import { addDays, format, parseISO } from 'date-fns';
import { requireAuth } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchSlots } from '@/lib/slots';
import { defaultAnchor, type CalView, daysForView } from '@/lib/week';
import CalendarView from '@/components/CalendarView';

export const dynamic = 'force-dynamic';

export default async function MyPickupsPage({ searchParams }: { searchParams: { v?: string; d?: string } }) {
  const ctx = await requireAuth();
  const sb = supabaseServer();

  const view: CalView = (searchParams.v as CalView) ?? 'week';
  const anchor = searchParams.d ? parseISO(searchParams.d) : (view === 'week' ? defaultAnchor() : new Date());

  // Fetch a buffer wide enough for any view + 7 days ahead so the next-week
  // nav doesn't trigger a cold cache on the first click.
  const days = daysForView(view, anchor);
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(addDays(days[days.length - 1], 1), 'yyyy-MM-dd');

  const slots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);
  const firstName = (ctx.profile?.full_name ?? '').split(' ')[0] || 'there';

  return (
    <div className="space-y-3">
      <header className="px-1">
        <h1 className="font-display text-3xl sm:text-4xl">Hi, {firstName} 👋</h1>
        <p className="text-ink-700/70 text-sm sm:text-base mt-0.5">
          Your week at a glance. Tap any pickup to see details and claim it.
        </p>
      </header>

      <CalendarView
        view={view}
        anchor={anchor}
        slots={slots}
        currentUserId={ctx.user.id}
      />
    </div>
  );
}
