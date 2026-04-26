'use client';
import type { SlotView } from '@/lib/types';
import { mapsHref, formatAddress } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import ClaimButton from './ClaimButton';

interface Props {
  slot: SlotView;
  currentUserId: string;
  canClaim: boolean;     // true for helpers; false once past cutoff
  isAdmin: boolean;
  onChange?: () => void;
}

export default function SlotCard({ slot, currentUserId, canClaim, isAdmin, onChange }: Props) {
  const pickup = slot.pickup_location ?? (slot.pickup_location_text ? { label: slot.pickup_location_text, street: null, city: null, lat: null, lng: null } : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null } : null);
  const claimedByMe = slot.assignment?.assigned_to_user_id === currentUserId;
  const claimedBy = slot.assignment?.profile;
  const hasLocation = !!pickup;

  return (
    <div className="card p-5 md:p-6 relative">
      {/* child stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl"
        style={{ background: slot.child.color }}
      />
      <div className="pl-3">
        {/* Header row: time + child */}
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl md:text-4xl tabular-nums leading-none">
              {prettyTime(slot.pickup_time)}
            </span>
            <span
              className="chip text-sm"
              style={{ background: `${slot.child.color}22`, color: '#2a2a22' }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: slot.child.color }} />
              {slot.child.name}
            </span>
          </div>
          {slot.end_time && (
            <span className="text-sm text-ink-700/60">ends {prettyTime(slot.end_time)}</span>
          )}
        </div>

        <div className="text-lg font-medium mb-4">{slot.title}</div>

        {/* Locations */}
        <div className="space-y-2 text-[15px]">
          <LocRow label="Pick up from" loc={pickup} warn={!hasLocation} />
          {dest && <LocRow label="Drop off at" loc={dest} />}
          {slot.notes && (
            <div className="flex gap-2 text-ink-700/80 pt-1">
              <span className="mt-0.5">📝</span>
              <span>{slot.notes}</span>
            </div>
          )}
        </div>

        {/* Status / action row */}
        <div className="mt-5 flex items-center justify-between gap-3">
          {slot.status === 'claimed' && claimedBy ? (
            <div className="text-sm">
              {claimedByMe ? (
                <span className="chip bg-sage-500 text-cream-50">✓ You're on it</span>
              ) : (
                <span className="chip bg-black/5 text-ink-800">
                  <span className="h-2 w-2 rounded-full bg-sage-500" />
                  {claimedBy.full_name}
                </span>
              )}
            </div>
          ) : (
            <span className="chip bg-coral-400/20 text-coral-600">Needs a helper</span>
          )}

          {canClaim && (
            <ClaimButton
              slotId={slot.id}
              claimed={slot.status === 'claimed'}
              claimedByMe={claimedByMe}
              onChange={onChange}
            />
          )}
          {isAdmin && !canClaim && slot.status === 'claimed' && (
            <span className="text-xs text-ink-700/50">past cutoff</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LocRow({ label, loc, warn }: { label: string; loc: any; warn?: boolean }) {
  if (!loc) {
    return (
      <div className="flex gap-2 items-start text-coral-600">
        <span className="mt-0.5">⚠︎</span>
        <span>
          <span className="text-ink-700/60 text-xs uppercase tracking-wider block">{label}</span>
          <span className="text-[15px]">Location missing — ask a parent</span>
        </span>
      </div>
    );
  }
  const href = mapsHref(loc);
  const addr = (formatAddress(loc) ?? '');
  return (
    <div className="flex gap-2 items-start">
      <span className="mt-0.5">📍</span>
      <div className="flex-1 min-w-0">
        <div className="text-ink-700/60 text-xs uppercase tracking-wider">{label}</div>
        <div className="font-medium text-ink-900">{loc.label}</div>
        {addr && <div className="text-sm text-ink-700/70">{addr}</div>}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="text-sm text-sage-600 hover:underline">
            Open in Maps →
          </a>
        )}
      </div>
    </div>
  );
}
