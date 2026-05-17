import Link from 'next/link';
import { addDays, format, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { requireAuth } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchSlots } from '@/lib/slots';
import { defaultAnchor, type CalView, daysForView, endOfSchoolWeek, weekStart } from '@/lib/week';
import CalendarView from '@/components/CalendarView';
import HelperAvatar from '@/components/HelperAvatar';
import { RankBadge } from '@/components/RankBadge';
import { getHelperRank } from '@/lib/ranks';
import { fetchHelpers } from '@/lib/helpers';
import SendSummaryToLiezel from '@/components/SendSummaryToLiezel';
import { buildFullWeekSummary } from '@/lib/summaries';

export const dynamic = 'force-dynamic';

export default async function MyPickupsPage({ searchParams }: { searchParams: { v?: string; d?: string; only?: string } }) {
  const ctx = await requireAuth();
  const sb = supabaseServer();

  // Default to schedule view — vertical agenda is the most grandparent-friendly
  // first impression. They can switch to Day / 3-day / Week from the toolbar.
  const view: CalView = (searchParams.v as CalView) ?? 'schedule';
  // All views respect ?d= for prev/next navigation. We clamp to today so
  // yesterday isn't accessible. Schedule paginates by week (Sun→Thu) —
  // daysForView() snaps the anchor to the week's Sunday automatically.
  const requestedAnchor = searchParams.d ? parseISO(searchParams.d) : new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  let anchor = requestedAnchor < todayStart ? new Date() : requestedAnchor;
  const onlyMine = searchParams.only === 'mine';

  // ── Performance: we used to probe `fetchSlots(thisWeek)` BEFORE the
  // main batch just to decide whether to auto-advance the anchor by a
  // week. That cost one extra round-trip every page load. Now we fetch
  // weekSlots up front (we need it anyway for the "N pickups need a
  // helper this week" subhead) and reuse it for the auto-advance
  // decision before kicking off the rest of the queries.
  const tz = ctx.household?.timezone ?? 'Asia/Jerusalem';
  const weekStartISO = format(weekStart(new Date()), 'yyyy-MM-dd');
  const weekEndISO = format(addDays(endOfSchoolWeek(new Date()), 1), 'yyyy-MM-dd');
  const weekSlots = await fetchSlots(sb, ctx.household!.id, weekStartISO, weekEndISO);

  if (!searchParams.d) {
    const nowMs = Date.now();
    const stillUpcoming = weekSlots.some((s) => {
      const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, tz);
      return slotUtc.getTime() > nowMs - 30 * 60 * 1000;
    });
    if (weekSlots.length > 0 && !stillUpcoming) {
      anchor = addDays(anchor, 7);
    }
  }

  const days = daysForView(view, anchor);
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(addDays(days[days.length - 1], 1), 'yyyy-MM-dd');

  // Helpers list, week summary, Liezel phone — admin-only extras. Skip
  // for non-admins so grandparents don't pay. The main `slots` fetch
  // dedupes with weekSlots above when the view range matches (current
  // week) — React.cache handles that automatically.
  const [slots, rank, helpers, weekSummary, liezelPhone] = await Promise.all([
    fetchSlots(sb, ctx.household!.id, startISO, endISO),
    getHelperRank(sb, ctx.household!.id, ctx.user.id),
    ctx.role === 'admin' ? fetchHelpers(sb, ctx.household!.id) : Promise.resolve([]),
    ctx.role === 'admin' ? buildFullWeekSummary(sb, ctx.household!.id) : Promise.resolve(null),
    ctx.role === 'admin' ? fetchLiezelPhone(sb, ctx.household!.id) : Promise.resolve(null),
  ]);

  // "This week" upcoming = today through Thursday, pickup_time hasn't
  // passed by more than 30 min.
  const nowMs = Date.now();
  const isUpcoming = (s: any) => {
    const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, tz);
    return slotUtc.getTime() > nowMs - 30 * 60 * 1000;
  };
  const thisWeekUpcoming = weekSlots.filter(isUpcoming);
  const myCount = thisWeekUpcoming.filter((s) => s.assignment?.assigned_to_user_id === ctx.user.id).length;
  const openCount = thisWeekUpcoming.filter((s) => s.status === 'unclaimed').length;

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
      <header className="px-1 flex items-center gap-4 sm:gap-5">
        {/* Editorial helper portrait — rectangular like the kid photos on
            the schedule chips, so the page lands with a face, not just text. */}
        <HelperAvatar
          name={ctx.profile?.full_name ?? firstName}
          photoUrl={ctx.profile?.photo_url}
          shape="rect"
          width={88}
          height={112}
          ring
        />
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight inline-flex items-baseline gap-3 flex-wrap">
            Hi, {firstName}
            <span className="self-center"><RankBadge rank={rank} /></span>
          </h1>
          <p className="text-ink-700/70 text-sm sm:text-base mt-0.5">
            {myCount === 0
              ? openCount === 0
                ? 'Nothing needs a helper this week. Quiet stretch.'
                : `${openCount} pickup${openCount === 1 ? '' : 's'} need a helper this week. Tap any to claim.`
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
        helpers={helpers}
        onlyMine={onlyMine}
      />

      {ctx.role === 'admin' && weekSummary && (
        <SendSummaryToLiezel
          liezelPhone={liezelPhone}
          summaryBody={weekSummary.body}
        />
      )}
    </div>
  );
}

async function fetchLiezelPhone(sb: any, householdId: string): Promise<string | null> {
  const { data: members } = await sb
    .from('household_members')
    .select('helper_kind, profiles:user_id(full_name, phone_number)')
    .eq('household_id', householdId);
  const liezel = (members ?? [])
    .filter((m: any) => m.helper_kind === 'nanny')
    .map((m: any) => m.profiles)
    .find((p: any) => p && (p.full_name ?? '').toLowerCase().startsWith('liezel'));
  const phone = (liezel?.phone_number ?? '').replace(/[^\d]/g, '');
  return phone || null;
}
