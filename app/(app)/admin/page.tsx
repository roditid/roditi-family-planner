import { parseISO, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { allUsers, recentEvents, getUser, slotById, children as demoChildren } from '@/lib/demo-store';
import { fetchSlots } from '@/lib/slots';
import { weekRange, prettyDay, daysOfWeek, prettyTime } from '@/lib/week';
import WeekNav from '@/components/WeekNav';
import AssignmentPicker from '@/components/AssignmentPicker';

export const dynamic = 'force-dynamic';

export default async function AdminOverview({ searchParams }: { searchParams: { w?: string } }) {
  const ctx = await requireAdmin();
  const sb = supabaseServer();
  const anchor = searchParams.w ? parseISO(searchParams.w) : new Date();
  const { start, startISO, endISO } = weekRange(anchor);
  const slots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);

  // Assignable members — admins AND helpers. Anyone in the household can do
  // a pickup. Sorted: admins first (parents typically know who's free), then
  // helpers grouped by kind.
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
  // Stable order: admins first, then grandparents, then nanny.
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
  const days = daysOfWeek(start);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-4xl">Admin overview</h1>
          <p className="text-ink-700/70 mt-1">{ctx.household!.name} · {slots.length} pickups this week</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/slots/new" className="btn-primary text-sm">+ New pickup</Link>
          <form action="/api/calendar/sync" method="post">
            <button className="btn-soft text-sm">↻ Sync calendar</button>
          </form>
        </div>
      </div>

      <WeekNav anchor={start} />

      {(unclaimed.length > 0 || missingLoc.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {unclaimed.length > 0 && (
            <Warn tone="coral" icon="⚠︎" title={`${unclaimed.length} unclaimed pickup${unclaimed.length > 1 ? 's' : ''}`}>
              Use the dropdown on each row to assign a helper, or wait for someone to claim.
            </Warn>
          )}
          {missingLoc.length > 0 && (
            <Warn tone="sage" icon="📍" title={`${missingLoc.length} pickup${missingLoc.length > 1 ? 's' : ''} with no location`}>
              Set a default on the activity in <Link href="/admin/children" className="underline">Children</Link>, or add a location to the slot.
            </Warn>
          )}
        </div>
      )}

      {activity.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display text-xl">Recent activity</h2>
            <span className="text-xs text-ink-700/50">last {activity.length}</span>
          </div>
          <div className="card divide-y divide-black/5">
            {activity.map((e, i) => (
              <div key={i} className="p-3 flex items-center gap-3 text-sm">
                <span className="chip bg-black/5 text-ink-800 text-xs uppercase tracking-wider min-w-[78px] justify-center">
                  {e.kind}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  <b>{e.actor}</b>
                  {e.subject && e.subject !== e.actor && <> → <b>{e.subject}</b></>}
                  {' · '}
                  <span className="text-ink-700/70">{e.slotLabel}</span>
                </span>
                <span className="text-xs text-ink-700/50 shrink-0">
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-6">
        {days.map((d) => {
          const iso = d.toISOString().slice(0, 10);
          const dSlots = slots.filter((s) => s.date === iso);
          if (dSlots.length === 0) return null;
          return (
            <section key={iso}>
              <h2 className="font-display text-xl mb-2">{prettyDay(d)}</h2>
              <div className="card divide-y divide-black/5">
                {dSlots.map((s) => (
                  <div key={s.id} className="p-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    <div className="w-14 text-right font-display text-xl tabular-nums">{prettyTime(s.pickup_time)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.child.color }} />
                        <span className="font-medium">{s.child.name}</span>
                        <span className="text-ink-700/60">· {s.title}</span>
                      </div>
                      <div className="text-sm text-ink-700/70 truncate">
                        {s.pickup_location?.label ?? s.pickup_location_text ?? <span className="text-coral-600">no location</span>}
                        {s.destination_location?.label && <> → {s.destination_location.label}</>}
                      </div>
                    </div>
                    <AssignmentPicker
                      slotId={s.id}
                      currentUserId={s.assignment?.assigned_to_user_id ?? null}
                      helpers={helpers}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="pt-4 border-t border-black/5 text-sm flex gap-4 flex-wrap">
        <Link href="/admin/calendar"  className="text-sage-600 hover:underline">Calendar settings</Link>
        <Link href="/admin/children"  className="text-sage-600 hover:underline">Children & activities</Link>
        <Link href="/admin/locations" className="text-sage-600 hover:underline">Locations</Link>
        <Link href="/admin/helpers"   className="text-sage-600 hover:underline">Helpers</Link>
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
