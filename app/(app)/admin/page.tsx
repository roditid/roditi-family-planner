import { addDays, format, parseISO, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { allUsers, recentEvents, getUser, slotById, children as demoChildren } from '@/lib/demo-store';
import { fetchSlots } from '@/lib/slots';
import { prettyDay, prettyTime, daysForView, isToday } from '@/lib/week';
import AssignmentPicker from '@/components/AssignmentPicker';
import AdminWeekNav from '@/components/AdminWeekNav';

export const dynamic = 'force-dynamic';

export default async function AdminOverview({ searchParams }: { searchParams: { d?: string } }) {
  const ctx = await requireAdmin();
  const sb = supabaseServer();
  const anchor = searchParams.d ? parseISO(searchParams.d) : new Date();

  // Anchored at the user-requested week (or this week by default). Past
  // anchors are clamped to today so yesterday never appears in the view.
  // Future weeks step in 7-day increments via the AdminWeekNav buttons.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const effectiveAnchor = anchor < todayStart ? new Date() : anchor;
  const days = daysForView('week', effectiveAnchor);
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(addDays(days[days.length - 1], 1), 'yyyy-MM-dd');
  const isThisWeek = effectiveAnchor < addDays(todayStart, 7) && effectiveAnchor >= todayStart;
  const rangeLabel = `${format(days[0], 'MMM d')} – ${format(days[days.length - 1], 'MMM d')}`;

  const allSlots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);
  // Drop slots whose pickup_time is more than 30 min ago. Same 30-min
  // grace window as the helper schedule view.
  const nowMs = Date.now();
  const tz = ctx.household?.timezone ?? 'Asia/Jerusalem';
  const slots = allSlots.filter((s) => {
    const { fromZonedTime } = require('date-fns-tz') as typeof import('date-fns-tz');
    const slotUtc = fromZonedTime(`${s.date}T${s.pickup_time}`, tz);
    return slotUtc.getTime() > nowMs - 30 * 60 * 1000;
  });

  // Calendar connection state — shape onboarding hint
  let calendarConnected = false;
  let calendarSyncedAt: string | null = null;
  if (!demoMode()) {
    const { data: conn } = await sb
      .from('connected_calendars')
      .select('access_token, refresh_token, last_sync_at')
      .eq('household_id', ctx.household!.id)
      .maybeSingle();
    calendarConnected = !!(conn?.access_token && conn?.refresh_token);
    calendarSyncedAt = conn?.last_sync_at ?? null;
  } else calendarConnected = true;

  // Assignable members — admins AND helpers
  let helpers: any[] = [];
  if (demoMode()) {
    helpers = allUsers().map((u) => ({
      id: u.id, full_name: u.full_name, helper_kind: u.helper_kind, role: u.role,
    }));
  } else {
    const { data } = await sb
      .from('household_members')
      .select('helper_kind, role, profiles:user_id(id, full_name)')
      .eq('household_id', ctx.household!.id);
    helpers = (data ?? []).map((m: any) => ({
      id: m.profiles.id, full_name: m.profiles.full_name, helper_kind: m.helper_kind, role: m.role,
    }));
  }
  const ROLE_ORDER: Record<string, number> = { admin: 0, grandparent: 1, nanny: 2, other: 3 };
  helpers.sort((a, b) => {
    const ka = a.role === 'admin' ? 0 : ROLE_ORDER[a.helper_kind ?? 'other'] ?? 3;
    const kb = b.role === 'admin' ? 0 : ROLE_ORDER[b.helper_kind ?? 'other'] ?? 3;
    return ka - kb || a.full_name.localeCompare(b.full_name);
  });

  // Recent activity feed
  let activity: { kind: string; created_at: string; actor: string; subject: string | null; slotLabel: string }[] = [];
  if (demoMode()) {
    activity = recentEvents(8).map((e) => {
      const slot = slotById(e.slot_id);
      const child = slot ? demoChildren().find((c) => c.id === slot.child_id) : null;
      return {
        kind: e.kind,
        created_at: e.created_at,
        actor: getUser(e.actor_user_id ?? '')?.full_name ?? 'Someone',
        subject: e.subject_user_id ? getUser(e.subject_user_id)?.full_name ?? null : null,
        slotLabel: slot ? `${child?.name ?? '?'} · ${slot.title} · ${slot.pickup_time.slice(0,5)}` : '(slot deleted)',
      };
    });
  } else {
    const { data } = await sb
      .from('slot_events')
      .select('kind, created_at, actor:actor_user_id(full_name), subject:subject_user_id(full_name), slot:pickup_slot_id(title, pickup_time, child:children(name))')
      .eq('household_id', ctx.household!.id)
      .order('created_at', { ascending: false })
      .limit(8);
    activity = (data ?? []).map((e: any) => ({
      kind: e.kind,
      created_at: e.created_at,
      actor: e.actor?.full_name ?? 'Someone',
      subject: e.subject?.full_name ?? null,
      slotLabel: e.slot ? `${e.slot.child?.name ?? '?'} · ${e.slot.title} · ${(e.slot.pickup_time ?? '').slice(0,5)}` : '(slot deleted)',
    }));
  }

  const unclaimed = slots.filter((s) => s.status === 'unclaimed');
  const missingLoc = slots.filter((s) => !s.pickup_location_id && !s.pickup_location_text);

  const firstName = (ctx.profile?.full_name ?? '').split(' ')[0] || 'there';

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">Hi, {firstName}</h1>
          <p className="text-ink-700/70 mt-1">
            {ctx.household!.name} ·{' '}
            {slots.length === 0
              ? `no pickups ${isThisWeek ? 'this week' : 'this week of ' + rangeLabel}`
              : `${slots.length} pickup${slots.length > 1 ? 's' : ''} ${isThisWeek ? 'this week' : rangeLabel}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {unclaimed.length > 0 && (
            <Link href="/admin/unassigned" className="btn-soft text-sm bg-coral-400/15 text-coral-600 hover:bg-coral-400/25 border-coral-400/30">
              {unclaimed.length} unassigned
            </Link>
          )}
          <Link href="/admin/slots/new" className="btn-soft text-sm">+ New pickup</Link>
          <form action="/api/calendar/sync" method="post">
            <button className="btn-primary text-sm">↻ Sync calendar</button>
          </form>
        </div>
      </div>

      {/* Week step nav — Prev disabled on the current week so we never
          surface yesterday's pickups, Next steps forward in 7-day units. */}
      <div className="flex justify-center">
        <AdminWeekNav anchor={effectiveAnchor} rangeLabel={rangeLabel} />
      </div>

      {/* Onboarding hint when no calendar connected */}
      {!calendarConnected && (
        <div className="rounded-2xl bg-gradient-to-br from-sage-500/10 to-coral-400/10 border border-sage-500/20 p-5">
          <div className="font-display text-lg mb-1">Welcome — let's get the schedule in.</div>
          <p className="text-sm text-ink-700/80 mb-4">
            Connect Paula's Google Calendar so events like <code className="bg-black/5 px-1 rounded">Soccer - Liam</code> become pickups in here automatically. Takes 1 minute.
          </p>
          <Link href="/admin/calendar" className="btn-primary text-sm">Connect Google Calendar →</Link>
        </div>
      )}

      {/* Warnings */}
      {(unclaimed.length > 0 || missingLoc.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {unclaimed.length > 0 && (
            <Warn tone="coral" icon="⚠︎" title={`${unclaimed.length} pickup${unclaimed.length > 1 ? 's' : ''} unassigned`}>
              Use the dropdown on each row below, or wait for a helper to claim.
            </Warn>
          )}
          {missingLoc.length > 0 && (
            <Warn tone="sage" icon="📍" title={`${missingLoc.length} pickup${missingLoc.length > 1 ? 's' : ''} need a location`}>
              Set a default per activity in{' '}
              <Link href="/admin/children" className="underline font-medium">Children & activities</Link>{' '}— it'll auto-fill on every future sync.
            </Warn>
          )}
        </div>
      )}

      {/* Empty state when calendar connected but 0 slots */}
      {calendarConnected && slots.length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">🌿</div>
          <p className="font-medium text-lg mb-1">Quiet week.</p>
          <p className="text-sm text-ink-700/70">No pickups in the next 7 days. Last calendar sync was{' '}
            {calendarSyncedAt ? formatDistanceToNow(new Date(calendarSyncedAt), { addSuffix: true }) : 'never'}.{' '}
            <Link href="/admin/calendar" className="underline text-sage-600">Sync again →</Link>
          </p>
        </div>
      )}

      {/* Day-by-day schedule */}
      {slots.length > 0 && (
        <div className="space-y-5">
          {days.map((d) => {
            const iso = format(d, 'yyyy-MM-dd');
            const dSlots = slots.filter((s) => s.date === iso);
            if (dSlots.length === 0) return null;
            const today = isToday(d);
            return (
              <section key={iso}>
                <h2 className={`font-display text-lg sm:text-xl mb-2 flex items-baseline gap-2 ${today ? 'text-coral-600' : ''}`}>
                  {prettyDay(d)}
                  {today && <span className="text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded-full bg-coral-400/15 text-coral-600 leading-none">today</span>}
                </h2>
                <div className="card divide-y divide-black/5">
                  {dSlots.map((s) => {
                    // Show every kid on the slot (primary + tag-along siblings).
                    // Without this the dashboard hid Adam on Yali's 1st Grade
                    // Prep row, since the dismissal-order rule made Yali the
                    // slot's primary.
                    const allKids = [s.child, ...(s.additional_children ?? [])];
                    return (
                      <div key={s.id} className="p-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                        <div className="w-14 text-right font-display text-xl tabular-nums shrink-0">{prettyTime(s.pickup_time)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {allKids.map((kid: any) => (
                              <span
                                key={kid.id}
                                className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: `${kid.color}22`, color: '#2a2a22' }}
                              >
                                {kid.name}
                              </span>
                            ))}
                            <span className="font-medium">{s.title}</span>
                          </div>
                          <div className="text-sm text-ink-700/70 truncate mt-0.5">
                            {s.pickup_location?.label ?? s.pickup_location_text ?? <span className="text-coral-600">no pickup location</span>}
                            {s.destination_location?.label && <span className="text-ink-700/50"> → {s.destination_location.label}</span>}
                          </div>
                        </div>
                        <AssignmentPicker
                          slotId={s.id}
                          currentUserId={s.assignment?.assigned_to_user_id ?? null}
                          helpers={helpers}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Recent activity — intentionally muted. The schedule above is the
          actionable part; this is just a "what changed lately" log. We
          drop the card frame, shrink the type, and bleed the actor names
          into the same opacity as everything else so it reads as a quiet
          ledger, not another action list. */}
      {activity.length > 0 && (
        <section className="pt-4 border-t border-black/5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-700/55">Recent activity</h2>
            <span className="text-[10px] text-ink-700/40">last {activity.length}</span>
          </div>
          <ul className="space-y-1 text-xs text-ink-700/55">
            {activity.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 truncate">
                <span className="uppercase tracking-[0.1em] text-[10px] text-ink-700/40 min-w-[66px] shrink-0">
                  {e.kind}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  <span className="text-ink-700/70">{e.actor}</span>
                  {e.subject && e.subject !== e.actor && <> → <span className="text-ink-700/70">{e.subject}</span></>}
                  {' · '}
                  <span>{e.slotLabel}</span>
                </span>
                <span className="text-[10px] text-ink-700/40 shrink-0 tabular-nums">
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Settings shortcuts */}
      <div className="pt-4 border-t border-black/5 text-sm flex gap-4 flex-wrap">
        <Link href="/admin/calendar"  className="text-sage-600 hover:underline">Calendar settings</Link>
        <Link href="/admin/children"  className="text-sage-600 hover:underline">Children & activities</Link>
        <Link href="/admin/locations" className="text-sage-600 hover:underline">Locations</Link>
        <Link href="/admin/helpers"   className="text-sage-600 hover:underline">Helpers</Link>
        <Link href="/admin/invites"   className="text-sage-600 hover:underline">Invites</Link>
        <Link href="/admin/reminders" className="text-sage-600 hover:underline">Reminders</Link>
      </div>
    </div>
  );
}

function Warn({ tone, icon, title, children }: { tone: 'coral' | 'sage'; icon: string; title: string; children: React.ReactNode }) {
  const cls = tone === 'coral' ? 'bg-coral-400/15 border-coral-400/30' : 'bg-sage-500/10 border-sage-500/20';
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="font-medium flex items-center gap-2"><span>{icon}</span>{title}</div>
      <div className="text-sm text-ink-700/70 mt-0.5">{children}</div>
    </div>
  );
}
