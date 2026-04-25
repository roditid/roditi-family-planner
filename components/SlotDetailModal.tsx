'use client';

import { useEffect } from 'react';
import type { SlotView } from '@/lib/types';
import { mapsHref } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import { tellable } from '@/lib/phones';
import ChildAvatar from './ChildAvatar';

/**
 * Bottom-sheet (mobile) / centered dialog (desktop) showing the full slot
 * details: pickup + drop-off addresses, hours, door codes, ganenet
 * contacts (with tap-to-call), notes, and the Claim/Unclaim action.
 */
export default function SlotDetailModal({
  slot, currentUserId, ownership, pending, claimedBy, err, onClose, onClaim,
}: {
  slot: SlotView;
  currentUserId: string;
  ownership: 'mine' | 'taken' | 'open';
  pending: boolean;
  claimedBy: any;
  err: string | null;
  onClose: () => void;
  onClaim: () => void;
}) {
  // Lock body scroll while open + ESC to close
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pickup = slot.pickup_location ?? (slot.pickup_location_text ? { label: slot.pickup_location_text, street: null, city: null, lat: null, lng: null, notes: null } as any : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null, notes: null } as any : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pp-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative bg-cream-50 w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-cardHover border border-black/[0.04] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle (mobile bottom-sheet feel) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-10 rounded-full bg-black/15" />
        </div>

        <div className="px-5 pt-2 pb-5 sm:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <ChildAvatar child={slot.child} size={48} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.1em]" style={{ color: slot.child.color }}>{slot.child.name}</div>
              <div className="font-display text-2xl sm:text-3xl leading-tight tracking-tight">{slot.title}</div>
              <div className="text-sm text-ink-700/70 mt-0.5 tabular-nums">
                {prettyTime(slot.pickup_time)}{slot.end_time && ` – ends ${prettyTime(slot.end_time)}`}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-ink-700/50 hover:text-ink-900 active:scale-90 transition-transform h-8 w-8 grid place-items-center rounded-lg"
            >
              ✕
            </button>
          </div>

          {/* Pickup */}
          <DetailLoc label="Pick up from" loc={pickup} />

          {/* Drop-off */}
          <DetailLoc label="Drop off at" loc={dest} />

          {/* Notes (slot-level) */}
          {slot.notes && (
            <div className="rounded-xl bg-cream-200/40 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold mb-1">Note for the helper</div>
              <div className="text-ink-700/85">{tellable(slot.notes)}</div>
            </div>
          )}

          {/* Status row */}
          <div className="pt-2 border-t border-black/[0.06]">
            {ownership === 'mine' ? (
              <div className="text-sm font-semibold text-sage-700">✓ You're on this pickup.</div>
            ) : ownership === 'taken' ? (
              <div className="text-sm flex items-center gap-2">
                <span className="h-7 w-7 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center text-xs font-bold">
                  {(claimedBy?.full_name ?? '?').slice(0, 1)}
                </span>
                <span><b>{claimedBy?.full_name}</b> is on this one.</span>
              </div>
            ) : (
              <div className="text-sm font-medium text-coral-600">Needs a helper.</div>
            )}
          </div>

          {/* Action */}
          {ownership !== 'taken' && (
            <button
              onClick={onClaim}
              disabled={pending}
              className={
                'w-full rounded-2xl py-4 text-base font-semibold transition-all duration-150 active:scale-[0.98] ' +
                (ownership === 'mine'
                  ? 'bg-black/[0.06] text-ink-900 hover:bg-black/[0.09]'
                  : 'bg-sage-500 hover:bg-sage-600 text-cream-50 shadow-sm')
              }
            >
              {pending ? '…' : ownership === 'mine' ? 'Unclaim this pickup' : 'Claim this pickup'}
            </button>
          )}
          {err && <div className="text-sm text-coral-600 font-medium">{err}</div>}
        </div>
      </div>
    </div>
  );
}

function DetailLoc({ label, loc }: { label: string; loc: any }) {
  if (!loc) {
    return (
      <div className="rounded-xl border border-coral-400/30 bg-coral-400/8 p-3 text-coral-600">
        <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">{label}</div>
        <div className="font-medium">⚠︎ Location not set — ask a parent</div>
      </div>
    );
  }
  const href = mapsHref(loc);
  const addr = [loc.street, loc.city].filter(Boolean).join(', ');
  return (
    <div className="rounded-xl bg-cream-200/40 p-3.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold mb-1">{label}</div>
      <div className="font-display text-lg leading-tight">{loc.label}</div>
      {addr && <div className="text-sm text-ink-700/70 mt-0.5">{addr}</div>}
      {loc.notes && (
        <div className="text-sm text-ink-700/80 mt-1.5 leading-relaxed">{tellable(loc.notes)}</div>
      )}
      {href && (
        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-sm text-sage-600 hover:underline mt-2 font-medium">
          Open in Maps →
        </a>
      )}
    </div>
  );
}
