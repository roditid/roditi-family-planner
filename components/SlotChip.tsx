'use client';
import { useOptimistic, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SlotView } from '@/lib/types';
import { mapsHref } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import { tellable } from '@/lib/phones';

interface Props {
  slot: SlotView;
  currentUserId: string;
  density?: 'compact' | 'roomy';
}

type ClaimState = 'mine' | 'taken' | 'open';

/**
 * The hero element of the app. Vertical hierarchy on every viewport:
 *   TIME  →  CHILD • ACTIVITY  →  pickup → drop-off  →  status / claim
 *
 * Optimistic UI: tapping Claim/Unclaim flips local state instantly. The
 * server call follows in the background; if it fails we revert and surface
 * a toast. No more 500ms spinner staring contests.
 */
export default function SlotChip({ slot, currentUserId, density = 'roomy' }: Props) {
  const initialState: ClaimState =
    slot.assignment?.assigned_to_user_id === currentUserId ? 'mine'
      : slot.status === 'claimed' ? 'taken'
      : 'open';

  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(initialState, (_prev, next: ClaimState) => next);

  const ownership = optimistic;
  const claimedBy = ownership === 'mine' ? null : slot.assignment?.profile;
  const pickup = slot.pickup_location ?? (slot.pickup_location_text ? { label: slot.pickup_location_text, street: null, city: null, lat: null, lng: null } : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null } : null);

  // Visual treatment per ownership state
  const surface =
    ownership === 'mine'
      ? 'bg-sage-500 text-cream-50 border-sage-600 shadow-card'
      : ownership === 'taken'
        ? 'bg-cream-50 border-black/[0.06] text-ink-900'
        : 'bg-cream-50 border-coral-400/40 text-ink-900 hover:border-coral-400/70 hover:shadow-card';

  async function doClaim() {
    setErr(null);
    const next: ClaimState = ownership === 'mine' ? 'open' : 'mine';
    const path = ownership === 'mine' ? `/api/slots/${slot.id}/unclaim` : `/api/slots/${slot.id}/claim`;
    start(async () => {
      setOptimistic(next);  // immediate visual update
      const res = await fetch(path, { method: 'POST' });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Something went wrong' }));
        setErr(error || 'Could not update pickup');
        // revert by triggering a refresh — server is source of truth
        router.refresh();
        return;
      }
      // success — refresh to pick up any side-effects (assignment id, log entry)
      router.refresh();
    });
  }

  // Press feedback
  const interactive = ownership !== 'taken';

  // ─── COMPACT (column views): minimal info, expand-on-tap not implemented;
  // the schedule/day view is the "click in for full details" path.
  if (density === 'compact') {
    return (
      <div className={`relative rounded-xl border transition-all duration-150 active:scale-[0.985] ${surface} ${pending ? 'opacity-90' : ''}`}>
        <span
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
          style={{ background: slot.child.color }}
          aria-hidden
        />
        <div className="pl-2.5 pr-2 py-2 space-y-1">
          <div className="font-display text-base tabular-nums leading-tight">{prettyTime(slot.pickup_time)}</div>
          <div
            className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded inline-block"
            style={
              ownership === 'mine'
                ? { background: 'rgba(255,255,255,0.18)', color: 'inherit' }
                : { background: slot.child.color, color: '#fff' }
            }
          >
            {slot.child.name}
          </div>
          <div className={`text-[13px] font-medium leading-tight truncate ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
            {slot.title}
          </div>
          <div className="pt-0.5">
            {ownership === 'mine' ? (
              <span className="text-[10px] font-bold tracking-wide uppercase opacity-95">✓ on it</span>
            ) : ownership === 'taken' ? (
              <span className="text-[11px] truncate block">{claimedBy?.full_name?.split(' ')[0] ?? '—'}</span>
            ) : interactive ? (
              <button
                onClick={doClaim}
                disabled={pending}
                className="text-[11px] font-semibold rounded-md bg-sage-500 text-cream-50 px-2 py-1 active:scale-95 transition-transform w-full"
              >
                {pending ? '…' : 'Claim'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ─── ROOMY (schedule + day views): full info, vertical hierarchy.
  return (
    <div
      className={`relative rounded-2xl border transition-all duration-150 active:scale-[0.985] ${surface} ${pending ? 'opacity-90' : ''}`}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl"
        style={{ background: slot.child.color }}
        aria-hidden
      />

      <div className="pl-4 pr-4 py-4 space-y-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl sm:text-4xl tabular-nums leading-none">
            {prettyTime(slot.pickup_time)}
          </span>
          {slot.end_time && (
            <span className={`text-xs tabular-nums ${ownership === 'mine' ? 'opacity-75' : 'text-ink-700/55'}`}>
              ends {prettyTime(slot.end_time)}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span
            className="text-xs font-bold uppercase tracking-[0.1em] px-2 py-1 rounded-md"
            style={
              ownership === 'mine'
                ? { background: 'rgba(255,255,255,0.18)', color: 'inherit' }
                : { background: slot.child.color, color: '#fff', boxShadow: '0 1px 2px rgba(20,20,16,0.12)' }
            }
          >
            {slot.child.name}
          </span>
          <span className={`font-display text-2xl sm:text-[26px] leading-tight tracking-tight ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
            {slot.title}
          </span>
        </div>

        <div className={`text-sm space-y-1.5 ${ownership === 'mine' ? 'opacity-95' : ''}`}>
          {pickup ? (
            <LocLine label="from" loc={pickup} mine={ownership === 'mine'} />
          ) : (
            <div className={`flex items-center gap-1.5 ${ownership === 'mine' ? 'text-cream-50/95' : 'text-coral-600'}`}>
              <span>⚠︎</span>
              <span className="font-medium">Pickup location not set</span>
            </div>
          )}
          {dest && <LocLine label="to" loc={dest} mine={ownership === 'mine'} />}
        </div>

        {slot.notes && (
          <div className={`text-sm flex gap-2 ${ownership === 'mine' ? 'opacity-95' : 'text-ink-700/85'}`}>
            <span className="opacity-70 shrink-0">📝</span>
            <span>{tellable(slot.notes)}</span>
          </div>
        )}

        <div className="pt-1.5 flex items-center justify-between gap-3 flex-wrap">
          {ownership === 'mine' ? (
            <span className="text-xs font-bold tracking-[0.08em] uppercase opacity-95">✓ You're on it</span>
          ) : ownership === 'taken' ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-6 w-6 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center text-[11px] font-bold">
                {(claimedBy?.full_name ?? '?').slice(0, 1)}
              </span>
              <span className="font-medium">{claimedBy?.full_name}</span>
            </span>
          ) : (
            <span className="text-sm font-semibold text-coral-600">Needs a helper</span>
          )}

          {interactive && (
            <button
              onClick={doClaim}
              disabled={pending}
              className={
                'rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 active:scale-95 ' +
                (ownership === 'mine'
                  ? 'bg-cream-50/15 hover:bg-cream-50/25 text-cream-50 px-4 py-2.5'
                  : 'bg-sage-500 hover:bg-sage-600 text-cream-50 px-5 py-3 shadow-sm')
              }
            >
              {pending ? '…' : ownership === 'mine' ? 'Unclaim' : 'Claim this pickup'}
            </button>
          )}
        </div>

        {err && <div className="text-xs text-coral-600 mt-1 font-medium">{err}</div>}
      </div>
    </div>
  );
}

function LocLine({ label, loc, mine }: { label: string; loc: any; mine: boolean }) {
  const href = mapsHref(loc);
  const addr = [loc.street, loc.city].filter(Boolean).join(', ');
  return (
    <div className="leading-snug">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[11px] uppercase tracking-wider font-semibold shrink-0 mt-0.5 ${mine ? 'opacity-65' : 'text-ink-700/50'}`}>
          {label}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-medium">{loc.label}</span>
          {addr && <span className={`ml-1.5 ${mine ? 'opacity-75' : 'text-ink-700/60'}`}>· {addr}</span>}
          {href && (
            <a
              href={href} target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`ml-2 text-xs ${mine ? 'underline opacity-90' : 'text-sage-600 hover:underline'}`}
            >
              map
            </a>
          )}
        </span>
      </div>
      {loc.notes && (
        <div className={`text-[12.5px] mt-0.5 ml-[44px] ${mine ? 'opacity-80' : 'text-ink-700/65'}`}>
          {tellable(loc.notes)}
        </div>
      )}
    </div>
  );
}
