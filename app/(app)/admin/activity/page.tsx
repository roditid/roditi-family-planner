/**
 * /admin/activity — chronological feed of every household event:
 *   • Slot events: claims, unclaims, reassigns, slot edits.
 *   • Notification events: emails sent (cron + claim flows), Google
 *     Calendar invites, calendar-title prefix updates, WhatsApp link
 *     builds.
 *
 * Two source tables (slot_events + notification_events) merged by
 * created_at. Newest first. Last 100 events; older history stays in
 * the DB but isn't surfaced to keep the UI snappy.
 */
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { formatDistanceToNow, format } from 'date-fns';

export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string;
  created_at: string;
  source: 'slot' | 'notify';
  kind: string;
  actor: string | null;
  subject: string | null;
  recipient: string | null;
  slotLabel: string | null;
  status: string | null;
  error: string | null;
}

export default async function AdminActivity() {
  const ctx = await requireAdmin();
  const sb = supabaseServer();

  const [slotEvents, notifyEvents] = await Promise.all([
    sb.from('slot_events')
      .select('id, kind, created_at, actor:actor_user_id(full_name), subject:subject_user_id(full_name), slot:pickup_slot_id(title, pickup_time, date, child:children(name))')
      .eq('household_id', ctx.household!.id)
      .order('created_at', { ascending: false })
      .limit(80),
    sb.from('notification_events')
      .select('id, kind, channel, recipient, subject, status, error, created_at, actor:actor_user_id(full_name), slot:slot_id(title, pickup_time, date, child:children(name))')
      .eq('household_id', ctx.household!.id)
      .order('created_at', { ascending: false })
      .limit(80),
  ]);

  const merged: FeedRow[] = [];
  for (const e of slotEvents.data ?? []) {
    const e_: any = e;
    const slot = e_.slot;
    merged.push({
      id: `s-${e_.id}`,
      created_at: e_.created_at,
      source: 'slot',
      kind: e_.kind,
      actor: e_.actor?.full_name ?? null,
      subject: e_.subject?.full_name ?? null,
      recipient: null,
      slotLabel: slot ? `${slot.child?.name ?? '?'} · ${slot.title} · ${slot.date} ${(slot.pickup_time ?? '').slice(0, 5)}` : null,
      status: null,
      error: null,
    });
  }
  for (const e of notifyEvents.data ?? []) {
    const e_: any = e;
    const slot = e_.slot;
    merged.push({
      id: `n-${e_.id}`,
      created_at: e_.created_at,
      source: 'notify',
      kind: e_.kind,
      actor: e_.actor?.full_name ?? null,
      subject: e_.subject ?? null,
      recipient: e_.recipient ?? null,
      slotLabel: slot ? `${slot.child?.name ?? '?'} · ${slot.title} · ${slot.date} ${(slot.pickup_time ?? '').slice(0, 5)}` : null,
      status: e_.status ?? null,
      error: e_.error ?? null,
    });
  }
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const top = merged.slice(0, 100);

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Recent activity</h1>
        <p className="text-ink-700/70 mt-1 text-sm">
          Every claim, unclaim, reassign, email, and calendar update — newest first. Use this to debug a missing notification or trace who did what.
        </p>
      </header>

      {top.length === 0 ? (
        <div className="card p-6 text-sm text-ink-700/55 text-center">
          No activity yet. Once helpers start claiming and the crons fire, this fills up.
        </div>
      ) : (
        <ul className="card divide-y divide-black/5">
          {top.map((e) => (
            <li key={e.id} className="p-3.5 flex items-baseline gap-3 text-sm flex-wrap sm:flex-nowrap">
              <KindChip kind={e.kind} status={e.status} />
              <div className="flex-1 min-w-0">
                <div className="text-ink-900 truncate">
                  {e.actor && <b>{e.actor}</b>}
                  {e.subject && e.subject !== e.actor && <> → <b>{e.subject}</b></>}
                  {e.recipient && <span className="text-ink-700/65"> · {e.recipient}</span>}
                  {e.subject == null && e.actor == null && <span className="italic text-ink-700/55">system</span>}
                </div>
                {e.slotLabel && <div className="text-xs text-ink-700/55 truncate">{e.slotLabel}</div>}
                {(e.subject && e.source === 'notify') && (
                  <div className="text-xs text-ink-700/45 truncate italic">"{e.subject}"</div>
                )}
                {e.error && (
                  <div className="text-xs text-coral-600 truncate">⚠︎ {e.error}</div>
                )}
              </div>
              <div className="text-[11px] text-ink-700/50 shrink-0 tabular-nums" title={format(new Date(e.created_at), 'PPpp')}>
                {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindChip({ kind, status }: { kind: string; status: string | null }) {
  const isFail = status === 'failed' || kind.endsWith('_failed');
  const tones: Record<string, string> = {
    claimed:                'bg-sage-500/15 text-sage-700',
    released:               'bg-coral-400/15 text-coral-700',
    reassigned:             'bg-cream-200 text-ink-800',
    email_sent:             'bg-black/[0.06] text-ink-700',
    calendar_invite:        'bg-sage-500/10 text-sage-700',
    calendar_title_updated: 'bg-sage-500/10 text-sage-700',
    calendar_event_deleted: 'bg-coral-400/15 text-coral-700',
    document_uploaded:      'bg-[#C5A462]/20 text-[#8a6f35]',
    document_deleted:       'bg-coral-400/15 text-coral-700',
    wa_link_built:          'bg-[#25D366]/15 text-[#1a8c44]',
    wa_link_tapped:         'bg-[#25D366]/25 text-[#1a8c44]',
  };
  const cls = isFail
    ? 'bg-coral-400/15 text-coral-700'
    : (tones[kind] ?? 'bg-black/[0.05] text-ink-700/70');
  return (
    <span className={`text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded-full whitespace-nowrap min-w-[78px] text-center leading-none shrink-0 self-center ${cls}`}>
      {kind.replace(/_/g, ' ')}
    </span>
  );
}
