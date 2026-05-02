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

  // Auto-advance: when the user didn't pin a specific week (?d= absent)
  // and this week's pickups are all in the past, jump the anchor to
  // next week. Avoids the empty / all-grayed-out landing state once
  // the parents have completed the week's schedule.
  if (!searchParams.d) {
    const tzCheck = ctx.household?.timezone ?? 'Asia/Jerusalem';
    const thisWeekDays = daysForView(view, anchor);
    const thisWeekStart = format(thisWeekDays[0], 'yyyy-MM-dd');
    const thisWeekEnd = format(addDays(thisWeekDays[thisWeekDays.length - 1], 1), 'yyyy-MM-dd');
    const probeSlots = await fetchSlots(sb, ctx.household!.id, thisWeekStart, thisWeekEnd);
    const nowMs = Date.now();
    const stillUpcoming = probeSlots.some((s) => {
      const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, tzCheck);
      return slotUtc.getTime() > nowMs - 30 * 60 * 1000;
    });
    if (probeSlots.length > 0 && !stillUpcoming) {
      anchor = addDays(anchor, 7);
    }
  }

  const days = daysForView(view, anchor);
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(addDays(days[days.length - 1], 1), 'yyyy-MM-dd');

  // Two queries fetched in parallel:
  //   1. The view's date range — what the calendar actually renders.
  //   2. THIS week's range (Sun → Thu) — used by the "8 pickups need a
  //      helper this week" subhead so the count never depends on which
  //      view is open. fetchSlots is cached per range, so navigating back
  //      to a previously-rendered range pays no extra cost.
  const tz = ctx.household?.timezone ?? 'Asia/Jerusalem';
  const weekStartISO = format(weekStart(new Date()), 'yyyy-MM-dd');
  const weekEndISO = format(addDays(endOfSchoolWeek(new Date()), 1), 'yyyy-MM-dd');

  // Helpers list is only needed when the viewer is an admin (the modal
  // renders the reassign dropdown gated on isAdmin). Skip the fetch
  // otherwise so non-admins don't pay for it.
  // Admin extras: helper list (drives the inline reassign dropdown) +
  // pre-built week summary (drives the "Send to Liezel" WhatsApp button
  // at the bottom of the page) + Liezel's phone number for the wa.me
  // link. Skipped for non-admin viewers so grandparents don't pay.
  const [slots, weekSlots, rank, helpers, weekSummary, liezelPhone] = await Promise.all([
    fetchSlots(sb, ctx.household!.id, startISO, endISO),
    fetchSlots(sb, ctx.household!.id, weekStartISO, weekEndISO),
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
