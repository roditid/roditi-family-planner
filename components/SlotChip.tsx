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

  // Visual state: who owns the chip
  const ownership: 'mine' | 'taken' | 'open' =
    claimedByMe ? 'mine' : isClaimed ? 'taken' : 'open';

  const baseStyles = ownership === 'mine'
    ? 'bg-sage-500 text-cream-50 border-sage-600 shadow-card'
    : ownership === 'taken'
      ? 'bg-cream-50 border-black/5 text-ink-700/80'
      : 'bg-cream-50 border-coral-400/40 text-ink-900 hover:border-coral-400/70';

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
      className={`group relative rounded-xl border transition cursor-pointer ${baseStyles}`}
      onClick={(e) => {
        if (density === 'roomy') return;            // always-expanded
        if ((e.target as HTMLElement).closest('button,a')) return; // don't toggle when clicking a button
        setOpen((o) => !o);
      }}
    >
      {/* child color stripe */}
      <span
        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-l"
        style={{ background: slot.child.color }}
        aria-hidden
      />

      <div className="pl-3 pr-2.5 py-2.5">
        {/* Header line — always visible */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-base tabular-nums leading-none shrink-0">
            {prettyTime(slot.pickup_time)}
          </span>
          <span
            className={`text-xs font-medium shrink-0 ${ownership === 'mine' ? 'opacity-90' : ''}`}
            style={ownership === 'mine' ? undefined : { color: slot.child.color }}
          >
            {slot.child.name}
          </span>
          <span className="text-xs truncate min-w-0 opacity-80">{slot.title}</span>
        </div>

        {/* Subline — primary location, always visible */}
        <div className="mt-1 text-[11.5px] leading-tight opacity-75 truncate">
          {pickup ? (
            <>📍 {pickup.label}</>
          ) : (
            <span className="text-coral-600">⚠︎ no location set</span>
          )}
        </div>

        {/* Status pill */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {ownership === 'mine' ? (
            <span className="text-[11px] font-medium opacity-90">✓ You're on it</span>
          ) : ownership === 'taken' ? (
            <span className="text-[11px] truncate">{claimedBy?.full_name}</span>
          ) : (
            <span className="text-[11px] font-medium text-coral-600">Needs a helper</span>
          )}
          {density === 'compact' && (
            <span className="text-[11px] opacity-60">{open ? '−' : '+'}</span>
          )}
        </div>

        {/* Expanded details */}
        {open && (
          <div className={`mt-3 pt-3 border-t space-y-2.5 text-[13px] ${ownership === 'mine' ? 'border-cream-50/30' : 'border-black/5'}`}>
            {pickup && (
              <LocBlock label="Pick up from" loc={pickup} mine={ownership === 'mine'} />
            )}
            {dest && (
              <LocBlock label="Drop off at" loc={dest} mine={ownership === 'mine'} />
            )}
            {slot.notes && (
              <div className={ownership === 'mine' ? 'opacity-90' : 'text-ink-700/80'}>
                <span className="opacity-70">📝 </span>{slot.notes}
              </div>
            )}
            {slot.end_time && (
              <div className="opacity-70 text-xs">Ends at {prettyTime(slot.end_time)}</div>
            )}

            {/* Action */}
            {(ownership === 'mine' || ownership === 'open') && (
              <div className="pt-1 flex items-center gap-2 flex-wrap">
                <button
                  onClick={doClaim}
                  disabled={pending}
                  className={
                    'rounded-lg px-3 py-2 text-sm font-medium transition ' +
                    (ownership === 'mine'
                      ? 'bg-cream-50/15 hover:bg-cream-50/25 text-cream-50'
                      : 'bg-sage-500 hover:bg-sage-600 text-cream-50')
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
      <div className={`text-[10.5px] uppercase tracking-wider font-medium ${mine ? 'opacity-70' : 'text-ink-700/60'}`}>
        {label}
      </div>
      <div className="font-medium leading-tight">{loc.label}</div>
      {addr && <div className={mine ? 'text-[12px] opacity-75' : 'text-[12px] text-ink-700/65'}>{addr}</div>}
      {href && (
        <a
          href={href} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`inline-block text-xs mt-0.5 ${mine ? 'underline opacity-90' : 'text-sage-600 hover:underline'}`}
        >
          Open in Maps →
        </a>
      )}
    </div>
  );
}
