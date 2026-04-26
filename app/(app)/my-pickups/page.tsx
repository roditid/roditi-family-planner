import Link from 'next/link';
import { addDays, format, parseISO } from 'date-fns';
import { requireAuth } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchSlots } from '@/lib/slots';
import { defaultAnchor, type CalView, daysForView } from '@/lib/week';
import CalendarView from '@/components/CalendarView';
import HelperAvatar from '@/components/HelperAvatar';

export const dynamic = 'force-dynamic';

export default async function MyPickupsPage({ searchParams }: { searchParams: { v?: string; d?: string; only?: string } }) {
  const ctx = await requireAuth();
  const sb = supabaseServer();

  // Default to schedule view — vertical agenda is the most grandparent-friendly
  // first impression. They can switch to Day / 3-day / Week from the toolbar.
  const view: CalView = (searchParams.v as CalView) ?? 'schedule';
  // Schedule view always anchors on today and scrolls forward 4 weeks — past
  // dates never show up. Other views respect ?d= for prev/next navigation
  // but we still clamp to today so yesterday isn't accessible.
  const requestedAnchor = searchParams.d ? parseISO(searchParams.d) : new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const anchor = view === 'schedule'
    ? new Date()
    : (requestedAnchor < todayStart ? new Date() : requestedAnchor);
  const onlyMine = searchParams.only === 'mine';

  const days = daysForView(view, anchor);
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(addDays(days[days.length - 1], 1), 'yyyy-MM-dd');

  const slots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);
  const myCount = slots.filter((s) => s.assignment?.assigned_to_user_id === ctx.user.id).length;
  const openCount = slots.filter((s) => s.status === 'unclaimed').length;

  const firstName = (ctx.profile?.full_name ?? '').split(' ')[0] || 'there';

  // Build query-string for filter toggle
  const baseQS = new URLSearchParams();
  if (searchParams.v) baseQS.set('v', searchParams.v);
  if (searchParams.d) baseQS.set('d', searchParams.d);
  const allHref = `?${baseQS.toString()}`;
  const mineQS = new URLSearchParams(baseQS);
  mineQS.set('only', 'mine');
  const mineHref = `?${mineQS.toString()}`;

  return (
    <div className="space-y-3">
      <header className="px-1 flex items-center gap-3.5 sm:gap-4">
        <HelperAvatar name={ctx.profile?.full_name ?? firstName} photoUrl={ctx.profile?.photo_url} size={56} ring />
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight inline-flex items-baseline gap-2">
            Hi, {firstName}
            {/* Heart in coral — replaces the waving-hand emoji. */}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="inline-block translate-y-[1px]">
              <path
                d="M12 21s-7.5-5-7.5-11.2A4.3 4.3 0 0 1 12 6.5a4.3 4.3 0 0 1 7.5 3.3C19.5 16 12 21 12 21Z"
                fill="#E89070"
              />
            </svg>
          </h1>
          <p className="text-ink-700/70 text-sm sm:text-base mt-0.5">
            {myCount === 0
              ? `${openCount} pickup${openCount === 1 ? '' : 's'} need a helper this week. Tap any to claim.`
              : `You're on ${myCount} pickup${myCount === 1 ? '' : 's'} this week.${openCount ? ` Plus ${openCount} still open.` : ''}`}
          </p>
        </div>
      </header>

      {/* Filter toggle (only useful when there's something to filter) */}
      {(myCount > 0) && (
        <div className="flex gap-1 px-1">
          <Link
            href={allHref}
            className={`text-xs px-3 py-1.5 rounded-full transition ${!onlyMine ? 'bg-sage-500 text-cream-50' : 'bg-black/5 text-ink-700 hover:bg-black/10'}`}
          >
            All ({slots.length})
          </Link>
          <Link
            href={mineHref}
            className={`text-xs px-3 py-1.5 rounded-full transition ${onlyMine ? 'bg-sage-500 text-cream-50' : 'bg-black/5 text-ink-700 hover:bg-black/10'}`}
          >
            Just mine ({myCount})
          </Link>
        </div>
      )}

      <CalendarView
        view={view}
        anchor={anchor}
        slots={slots}
        currentUserId={ctx.user.id}
        currentUserPhone={ctx.profile?.phone_number ?? null}
        currentUserName={ctx.profile?.full_name ?? null}
        isAdmin={ctx.role === 'admin'}
        onlyMine={onlyMine}
      />

      {ctx.role === 'admin' && (
        <p className="text-xs text-ink-700/50 px-1 mt-4">
          Admin? <Link href="/admin" className="underline">Open the dashboard →</Link>
        </p>
      )}
    </div>
  );
}
