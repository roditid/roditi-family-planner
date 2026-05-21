/**
 * /my-pickups/mine — flat schedule of EVERY future pickup the current
 * user has claimed. Looks like the Schedule view but spans 6 weeks in one
 * scroll (no week paging) so the helper sees the full commitment.
 *
 * Each chip shows a visible "Unclaim this pickup" button so they don't
 * have to dig into the detail modal to drop a slot.
 */
import { addDays, format } from 'date-fns';
import Link from 'next/link';
import { requireAuth } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchSlots } from '@/lib/slots';
import { isoDay, isToday, prettyDay } from '@/lib/week';
import HelperAvatar from '@/components/HelperAvatar';
import SlotChip from '@/components/SlotChip';
import { RankCard } from '@/components/RankBadge';
import { getHelperRank } from '@/lib/ranks';
import { fetchHelpers } from '@/lib/helpers';

export const dynamic = 'force-dynamic';

export default async function MyMinePage() {
  const ctx = await requireAuth();
  const sb = supabaseServer();

  const today = new Date();
  const startISO = format(today, 'yyyy-MM-dd');
  const endISO = format(addDays(today, 42), 'yyyy-MM-dd');  // 6 weeks
  const [all, rank, helpers, allKidsRes] = await Promise.all([
    fetchSlots(sb, ctx.household!.id, startISO, endISO),
    getHelperRank(sb, ctx.household!.id, ctx.user.id),
    ctx.role === 'admin' ? fetchHelpers(sb, ctx.household!.id) : Promise.resolve([]),
    ctx.role === 'admin'
      ? sb.from('children').select('id, name').eq('household_id', ctx.household!.id).order('name')
      : Promise.resolve({ data: [] }),
  ]);
  const allKids = ((allKidsRes as any).data ?? []) as { id: string; name: string }[];

  // Mine = every slot whose active assignment is to me, today or later.
  const mine = all
    .filter((s) => s.assignment?.assigned_to_user_id === ctx.user.id)
    .sort((a, b) => (a.date + a.pickup_time).localeCompare(b.date + b.pickup_time));

  const firstName = (ctx.profile?.full_name ?? '').split(' ')[0] || 'there';

  // Group by day — a single flat scroll, but each day section gets a header
  // so it reads like the schedule view.
  const byDay = new Map<string, typeof mine>();
  for (const s of mine) {
    if (!byDay.has(s.date)) byDay.set(s.date, [] as any);
    byDay.get(s.date)!.push(s);
  }
  const populatedDays = Array.from(byDay.keys()).sort();

  return (
    <div className="space-y-3">
      <header className="px-1 flex items-center gap-4 sm:gap-5">
        <HelperAvatar
          name={ctx.profile?.full_name ?? firstName}
          photoUrl={ctx.profile?.photo_url}
          shape="rect"
          width={88}
          height={112}
          ring
        />
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight">My pickups</h1>
          <p className="text-ink-700/70 text-sm sm:text-base mt-0.5">
            {mine.length === 0
              ? "You're not on any pickups in the next 6 weeks."
              : `${mine.length} pickup${mine.length === 1 ? '' : 's'} on your plate. Tap to share or unclaim.`}
          </p>
        </div>
      </header>

      {/* Rank card — sits between the header and the schedule. Doubles as
          a reason to come back: every claim nudges the bar forward. */}
      <RankCard rank={rank} firstName={firstName} />

      {mine.length === 0 ? (
        <div className="card p-8 text-center mt-4">
          <div className="text-3xl mb-2">🌿</div>
          <p className="font-medium">Nothing on your plate.</p>
          <p className="text-sm text-ink-700/65 mt-1">
            <Link href="/my-pickups" className="underline">See what's open →</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-6 pp-stagger">
          {populatedDays.map((date) => {
            const d = new Date(date + 'T00:00:00');
            const todays = byDay.get(date)!;
            const today = isToday(d);
            return (
              <section key={date}>
                <div className="px-1 mb-2 flex items-baseline gap-3 flex-wrap">
                  <h2 className={`font-display text-xl sm:text-2xl tracking-tight ${today ? 'text-coral-600' : ''}`}>
                    {prettyDay(d)}
                  </h2>
                  {today && <span className="text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded-full bg-coral-400/15 text-coral-600 leading-none">today</span>}
                  <span className="text-xs text-ink-700/45 ml-auto tabular-nums">
                    {todays.length} pickup{todays.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-2">
                  {todays.map((s) => (
                    <SlotChip
                      key={s.id}
                      slot={s}
                      currentUserId={ctx.user.id}
                      currentUserPhone={ctx.profile?.phone_number ?? null}
                      currentUserName={ctx.profile?.full_name ?? null}
                      isAdmin={ctx.role === 'admin'}
                      helpers={helpers}
                      householdKids={allKids}
                      density="roomy"
                      showUnclaim
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
