'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SlotView } from '@/lib/types';
import { mapsHref } from '@/lib/maps';
import { prettyTime } from '@/lib/week';

interface Props {
  slot: SlotView;
  currentUserId: string;
  density: 'compact' | 'roomy';   // Day view = roomy (always expanded); 3-day/week = compact
}

export default function SlotChip({ slot, currentUserId, density }: Props) {
  const [open, setOpen] = useState(density === 'roomy');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const claimedByMe = slot.assignment?.assigned_to_user_id === currentUserId;
  const claimedBy = slot.assignment?.profile;
  const isClaimed = slot.status === 'claimed';
  const pickup = slot.pickup_location ?? (slot.pickup_location_text ? { label: slot.pickup_location_text, street: null, city: null, lat: null, lng: null } : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null } : null);

  const ownership: 'mine' | 'taken' | 'open' =
    claimedByMe ? 'mine' : isClaimed ? 'taken' : 'open';

  const baseStyles = ownership === 'mine'
    ? 'bg-sage-500 text-cream-50 border-sage-600 shadow-card'
    : ownership === 'taken'
      ? 'bg-cream-50 border-black/5'
      : 'bg-cream-50 border-coral-400/40 hover:border-coral-400/70 hover:shadow-card';

  async function doClaim() {
    setErr(null);
    const path = claimedByMe ? `/api/slots/${slot.id}/unclaim` : `/api/slots/${slot.id}/claim`;
    const res = await fetch(path, { method: 'POST' });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Something went wrong' }));
      setErr(error);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div
      className={`group relative rounded-xl border transition cursor-pointer overflow-hidden ${baseStyles}`}
      onClick={(e) => {
        if (density === 'roomy') return;
        if ((e.target as HTMLElement).closest('button,a')) return;
        setOpen((o) => !o);
      }}
    >
      {/* Wider child color band on the left — primary identifier */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{ background: slot.child.color }}
        aria-hidden
      />

      <div className="pl-3.5 pr-3 py-3">
        {/* Header: time + child + activity title */}
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="font-display text-lg sm:text-xl tabular-nums leading-none shrink-0">
            {prettyTime(slot.pickup_time)}
          </span>
          <span
            className="text-xs font-semibold uppercase tracking-wider shrink-0 px-1.5 py-0.5 rounded"
            style={
              ownership === 'mine'
                ? { background: 'rgba(255,255,255,0.18)', color: 'inherit' }
                : { background: `${slot.child.color}22`, color: '#2a2a22' }
            }
          >
            {slot.child.name}
          </span>
          <span className={`text-sm font-medium truncate min-w-0 ${ownership === 'mine' ? 'opacity-95' : 'text-ink-900'}`}>
            {slot.title}
          </span>
        </div>

        {/* Subline — pickup location preview */}
        <div className={`mt-1.5 text-[12px] leading-tight truncate ${ownership === 'mine' ? 'opacity-90' : 'text-ink-700/75'}`}>
          {pickup ? (
            <>📍 {pickup.label}</>
          ) : (
            <span className={ownership === 'mine' ? 'text-cream-50/95 font-medium' : 'text-coral-600 font-medium'}>
              ⚠︎ Set pickup location
            </span>
          )}
        </div>

        {/* Status row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {ownership === 'mine' ? (
            <span className="text-[11px] font-semibold tracking-wide uppercase opacity-95">✓ You're on it</span>
          ) : ownership === 'taken' ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] truncate text-ink-700/75">
              <span className="h-5 w-5 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center text-[10px] font-semibold">
                {(claimedBy?.full_name ?? '?').slice(0, 1)}
              </span>
              <span className="truncate">{claimedBy?.full_name}</span>
            </span>
          ) : (
            <span className="text-[12px] font-medium text-coral-600">Needs a helper</span>
          )}
          {density === 'compact' && (
            <span className={`text-[14px] leading-none w-5 h-5 grid place-items-center rounded-full ${ownership === 'mine' ? 'bg-cream-50/15' : 'bg-black/5'}`}>
              {open ? '−' : '+'}
            </span>
          )}
        </div>

        {/* Expanded */}
        {open && (
          <div className={`mt-3 pt-3 border-t space-y-3 text-[13px] ${ownership === 'mine' ? 'border-cream-50/30' : 'border-black/[0.06]'}`}>
            {pickup && <LocBlock label="Pick up from" loc={pickup} mine={ownership === 'mine'} />}
            {dest && <LocBlock label="Drop off at" loc={dest} mine={ownership === 'mine'} />}
            {slot.notes && (
              <div className={`flex gap-2 ${ownership === 'mine' ? 'opacity-90' : 'text-ink-700/85'}`}>
                <span className="opacity-70 shrink-0">📝</span>
                <span>{slot.notes}</span>
              </div>
            )}
            {slot.end_time && (
              <div className="opacity-70 text-xs">Activity ends at {prettyTime(slot.end_time)}</div>
            )}

            {(ownership === 'mine' || ownership === 'open') && (
              <div className="pt-1 flex items-center gap-2 flex-wrap">
                <button
                  onClick={doClaim}
                  disabled={pending}
                  className={
                    'rounded-lg px-4 py-2.5 text-sm font-semibold transition ' +
                    (ownership === 'mine'
                      ? 'bg-cream-50/15 hover:bg-cream-50/25 text-cream-50'
                      : 'bg-sage-500 hover:bg-sage-600 text-cream-50 shadow-sm')
                  }
                >
                  {pending ? '…' : claimedByMe ? 'Unclaim' : 'Claim this pickup'}
                </button>
                {err && <span className="text-xs text-coral-600">{err}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LocBlock({ label, loc, mine }: { label: string; loc: any; mine: boolean }) {
  const href = mapsHref(loc);
  const addr = [loc.street, loc.city].filter(Boolean).join(', ');
  return (
    <div>
      <div className={`text-[10.5px] uppercase tracking-wider font-semibold ${mine ? 'opacity-75' : 'text-ink-700/60'}`}>
        {label}
      </div>
      <div className="font-medium leading-tight mt-0.5">{loc.label}</div>
      {addr && <div className={`text-[12.5px] mt-0.5 ${mine ? 'opacity-75' : 'text-ink-700/65'}`}>{addr}</div>}
      {href && (
        <a
          href={href} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-1 text-xs mt-1 ${mine ? 'underline opacity-90' : 'text-sage-600 hover:underline'}`}
        >
          Open in Maps →
        </a>
      )}
    </div>
  );
}
