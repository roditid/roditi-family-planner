'use client';
import { useOptimistic, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SlotView } from '@/lib/types';
import { mapsHref } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import { tellable } from '@/lib/phones';
import ChildAvatar from './ChildAvatar';
import SlotDetailModal from './SlotDetailModal';

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
  const [open, setOpen] = useState(false);
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

  // Modal — used by both compact and roomy modes for "see full details + claim"
  const detailModal = open && (
    <SlotDetailModal
      slot={slot} currentUserId={currentUserId} ownership={ownership} pending={pending}
      claimedBy={claimedBy} err={err}
      onClose={() => setOpen(false)}
      onClaim={() => { doClaim(); setOpen(false); }}
    />
  );

  // ─── COMPACT (column views): minimal info; tap chip body to open detail modal
  if (density === 'compact') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`relative w-full text-left rounded-xl border transition-all duration-150 active:scale-[0.985] ${surface} ${pending ? 'opacity-90' : ''}`}
        >
          <span
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
            style={{ background: slot.child.color }}
            aria-hidden
          />
          <div className="pl-2.5 pr-2 py-2 space-y-1">
            <div className="font-display text-base tabular-nums leading-tight">{prettyTime(slot.pickup_time)}</div>
            <div className="flex items-center gap-1.5">
              <ChildAvatar child={slot.child} size={22} />
              <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${ownership === 'mine' ? 'opacity-90' : 'text-ink-700/70'}`}>{slot.child.name}</span>
            </div>
            <div className={`text-[13px] font-medium leading-tight truncate ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
              {slot.title}
            </div>
            <div className="pt-0.5 text-[10px] font-bold uppercase tracking-wide">
              {ownership === 'mine' ? '✓ on it'
                : ownership === 'taken' ? (claimedBy?.full_name?.split(' ')[0] ?? '—')
                : <span className="text-coral-600">tap to claim</span>}
            </div>
          </div>
        </button>
        {detailModal}
      </>
    );
  }

  // ─── ROOMY (schedule + day views): full info, photo-led hero layout.
  // The kid's face is the dominant graphic element on the left; everything
  // else stacks on the right. Body tap opens detail modal; Claim button
  // keeps its own click.
  return (
    <>
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button,a')) return;
        setOpen(true);
      }}
      className={`relative rounded-2xl border transition-all duration-150 active:scale-[0.99] cursor-pointer overflow-hidden ${surface} ${pending ? 'opacity-90' : ''}`}
    >
      <div className="p-3 sm:p-4 flex gap-3 sm:gap-4 items-stretch">
        {/* PHOTO COLUMN — hero element. Rectangle stretches to card height. */}
        <div className="shrink-0 relative w-[38%] max-w-[180px] min-w-[120px] self-stretch min-h-[170px]">
          <ChildAvatar
            child={slot.child}
            shape="rect"
            rounded="rounded-xl"
            ring={ownership === 'mine'}
          />
          {ownership === 'mine' && (
            <span className="absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-sm font-bold shadow-sm border border-sage-600/20">
              ✓
            </span>
          )}
        </div>

        {/* CONTENT COLUMN */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Time headline + duration */}
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="font-display text-3xl sm:text-4xl tabular-nums leading-none tracking-tight">
              {prettyTime(slot.pickup_time)}
            </span>
            {slot.end_time && (
              <span className={`text-[11px] tabular-nums uppercase tracking-[0.08em] font-semibold ${ownership === 'mine' ? 'opacity-70' : 'text-ink-700/50'}`}>
                → {prettyTime(slot.end_time)}
              </span>
            )}
          </div>

          {/* Kid name (small caps) + activity */}
          <div className="space-y-0.5">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: ownership === 'mine' ? 'rgba(253,250,243,0.85)' : slot.child.color }}
            >
              {slot.child.name}
            </div>
            <div className={`font-display text-xl sm:text-2xl leading-[1.15] tracking-tight ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
              {slot.title}
            </div>
          </div>

          {/* Locations */}
          <div className={`text-sm space-y-1 pt-0.5 ${ownership === 'mine' ? 'opacity-95' : ''}`}>
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
            <div className={`text-[13px] flex gap-1.5 leading-snug ${ownership === 'mine' ? 'opacity-90' : 'text-ink-700/80'}`}>
              <span className="opacity-60 shrink-0">·</span>
              <span>{tellable(slot.notes)}</span>
            </div>
          )}

          {/* Status + action */}
          <div className="pt-2 flex items-center justify-between gap-3 flex-wrap">
            {ownership === 'mine' ? (
              <span className="text-[11px] font-bold tracking-[0.1em] uppercase opacity-95">You're on it</span>
            ) : ownership === 'taken' ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span className="h-6 w-6 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center text-[11px] font-bold">
                  {(claimedBy?.full_name ?? '?').slice(0, 1)}
                </span>
                <span className="font-medium">{claimedBy?.full_name}</span>
              </span>
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-coral-600">Needs a helper</span>
            )}

            {interactive && (
              <button
                onClick={doClaim}
                disabled={pending}
                className={
                  'rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 active:scale-95 ' +
                  (ownership === 'mine'
                    ? 'bg-cream-50/15 hover:bg-cream-50/25 text-cream-50 px-3.5 py-2'
                    : 'bg-sage-500 hover:bg-sage-600 text-cream-50 px-4 py-2.5 shadow-sm')
                }
              >
                {pending ? '…' : ownership === 'mine' ? 'Unclaim' : 'Claim'}
              </button>
            )}
          </div>

          {err && <div className="text-xs text-coral-600 mt-1 font-medium">{err}</div>}
        </div>
      </div>
    </div>
    {detailModal}
    </>
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
