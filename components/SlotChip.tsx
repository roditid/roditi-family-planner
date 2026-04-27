'use client';
import { useOptimistic, useTransition, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { SlotView } from '@/lib/types';
import { mapsHref, formatAddress } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import { tellable } from '@/lib/phones';
import ChildAvatar from './ChildAvatar';
import HelperAvatar from './HelperAvatar';
import SlotDetailModal from './SlotDetailModal';
import { relativeTimeUntil } from '@/lib/relative-time';

interface Props {
  slot: SlotView;
  currentUserId: string;
  /** Helper's own phone, used for the post-claim "send to my WhatsApp" deep link. */
  currentUserPhone?: string | null;
  currentUserName?: string | null;
  /** Surfaces the inline note editor on the detail modal when true. */
  isAdmin?: boolean;
  density?: 'compact' | 'roomy';
  /** When true (e.g. on /my-pickups/mine), the chip shows a visible
   *  "Unclaim this pickup" button next to the "You're on it" pill. */
  showUnclaim?: boolean;
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
export default function SlotChip({ slot, currentUserId, currentUserPhone, currentUserName, isAdmin, density = 'roomy', showUnclaim = false }: Props) {
  // Derive ownership from the active assignment as the source of truth,
  // not slot.status. The two can drift if a status update is denied
  // (RLS or transient failure) — the assignment row is what actually
  // determines who has the pickup. Falling back to slot.status ensures
  // we still get the right answer if the assignment join is missing for
  // any reason.
  const initialState: ClaimState =
    slot.assignment?.assigned_to_user_id === currentUserId ? 'mine'
      : slot.assignment ? 'taken'
      : slot.status === 'claimed' ? 'taken'
      : 'open';

  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useOptimistic(initialState, (_prev, next: ClaimState) => next);

  // Mutual exclusion across the whole page: only ONE slot detail modal can
  // be open at a time. When this chip opens, broadcast its id; every other
  // chip listens and closes itself if it sees a different id. Without this
  // a fast double-tap would leave two modals stacked and visually broken.
  const slotId = slot.id;
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('pp:modal-open', { detail: slotId }));
  }, [open, slotId]);
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent).detail;
      if (id !== slotId) setOpen(false);
    }
    window.addEventListener('pp:modal-open', onOpen);
    return () => window.removeEventListener('pp:modal-open', onOpen);
  }, [slotId]);

  const ownership = optimistic;
  const claimedBy = ownership === 'mine' ? null : slot.assignment?.profile;
  const pickup = slot.pickup_location ?? (slot.pickup_location_text ? { label: slot.pickup_location_text, street: null, city: null, lat: null, lng: null } : null);
  const via = slot.via_location ?? (slot.via_location_text ? { label: slot.via_location_text, street: null, city: null, lat: null, lng: null } : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null } : null);
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const isCombined = allKids.length > 1;
  // Show "in 4 hours" / "in 25 min" / "starting now" when the pickup is
  // imminent (< 6 hours away). Coral + bold for urgent (< 30 min).
  const soon = relativeTimeUntil(slot.date, slot.pickup_time);
  // Past = pickup_time more than 30 min ago in IL local time. Used by the
  // compact (week) chip to gray out + show a "done" pill instead of
  // "tap to claim" / time chip.
  const isPast = (() => {
    const [h, m] = slot.pickup_time.split(':').map(Number);
    const slotMs = new Date(slot.date + 'T00:00:00').setHours(h, m, 0, 0);
    return slotMs < Date.now() - 30 * 60 * 1000;
  })();

  // Visual treatment per ownership state. Three distinct visual languages:
  //  • 'mine'  → full sage fill, cream text — your active commitment.
  //  • 'taken' → muted greyish surface, no shadow — visibly "settled,
  //              someone else has it"; you don't need to act on this.
  //  • 'open'  → cream surface with a coral-tinted border + hover lift
  //              — calls for action.
  const surface =
    ownership === 'mine'
      ? 'bg-sage-500 text-cream-50 border-sage-600 shadow-card'
      : ownership === 'taken'
        ? 'bg-ink-900/[0.04] border-black/[0.06] text-ink-700/85'
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

  // Modal — used by both compact and roomy modes for "see full details + claim".
  // After a successful claim, we keep the modal open so the helper sees the
  // confirmed-state view (with the "Send to my WhatsApp" share button) — they
  // dismiss themselves when they've screenshotted or shared.
  const detailModal = open && (
    <SlotDetailModal
      slot={slot}
      currentUserId={currentUserId}
      currentUserPhone={currentUserPhone}
      currentUserName={currentUserName}
      isAdmin={isAdmin}
      ownership={ownership} pending={pending}
      claimedBy={claimedBy} err={err}
      onClose={() => setOpen(false)}
      onClaim={() => { doClaim(); /* stay open — let helper share/screenshot */ }}
    />
  );

  // ─── COMPACT (week column view): redesigned as a tight, calendar-style
  // event card. No big photo strip — the kids' identity is conveyed by a
  // small avatar cluster paired with the time at the top, then the title
  // and a left-side color stripe on the leading edge. Mostly text; reads
  // like a Google Calendar event with a family touch.
  if (density === 'compact') {
    const stripeColor = slot.child.color;
    const claimedFirst = firstNameOf(claimedBy?.full_name);
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            `group relative w-full text-left rounded-lg overflow-hidden flex
             border transition-all duration-150 active:scale-[0.985]
             ${ownership === 'mine'
               ? 'bg-sage-500 text-cream-50 border-sage-600 shadow-card'
               : ownership === 'taken'
                 ? 'bg-cream-50 border-black/[0.06] text-ink-900'
                 : 'bg-cream-50 border-black/[0.06] text-ink-900 hover:border-coral-400/60 hover:shadow-card'}
             ${pending ? 'opacity-90' : ''}
             ${isPast ? 'opacity-60 grayscale-[0.4]' : ''}`
          }
        >
          {/* Color stripe on the leading edge — kid identity at a glance,
              like a calendar event. Width is ~3px; pulls from the primary
              kid's color for combined trips. */}
          <span
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ background: stripeColor }}
            aria-hidden
          />

          <div className="flex-1 min-w-0 px-2.5 pl-3 py-2 flex flex-col gap-1.5">
            {/* Top row: time on the left, mini avatar cluster on the right. */}
            <div className="flex items-center gap-2">
              <span className={`font-display tabular-nums text-[18px] leading-none ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
                {prettyTime(slot.pickup_time)}
              </span>
              <div className="ml-auto flex -space-x-1.5 shrink-0">
                {allKids.map((kid, i) => (
                  <span
                    key={kid.id}
                    className={`h-7 w-7 rounded-full overflow-hidden ring-2 ${ownership === 'mine' ? 'ring-sage-500' : 'ring-cream-50'}`}
                    style={{ background: kid.color, zIndex: allKids.length - i }}
                  >
                    {kid.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={kid.photo_url} alt={kid.name} className="w-full h-full object-cover" style={{ objectPosition: '50% 28%' }} />
                    ) : (
                      <span className="grid place-items-center w-full h-full text-cream-50 text-[10px] font-bold">{kid.name.slice(0, 1)}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Title (kid names + activity). Combined → "Yali, Liam · Home" */}
            <div className={`font-display text-[14px] leading-[1.2] tracking-tight ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
              <span className="opacity-70 mr-1">
                {allKids.map((k) => k.name).join(', ')} ·
              </span>
              {slot.title}
            </div>

            {/* Route — single condensed line: "Gan Yali → Gan Liam → Home" */}
            <div className={`text-[11px] leading-snug truncate ${ownership === 'mine' ? 'opacity-85' : 'text-ink-700/65'}`}>
              {(() => {
                const labels: string[] = [];
                if (pickup?.label) labels.push(pickup.label);
                for (const k of slot.additional_children ?? []) {
                  const sl = (k as any).school_location;
                  if (sl?.label) labels.push(sl.label);
                }
                if (via?.label) labels.push(via.label);
                if (dest?.label) labels.push(dest.label);
                return labels.join('  →  ');
              })()}
            </div>

            {/* Status row */}
            <div className="mt-auto pt-1 flex items-center gap-1.5 flex-wrap">
              {ownership === 'mine' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cream-50/20 text-cream-50 text-[10px] font-bold uppercase tracking-[0.08em]">
                  <span className="text-cream-50">✓</span> You're on it
                </span>
              )}
              {ownership === 'taken' && (
                <span className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-sage-500/12 text-sage-700 text-[10px] font-bold uppercase tracking-[0.08em]">
                  <HelperAvatar name={claimedBy?.full_name ?? '?'} photoUrl={claimedBy?.photo_url} size={16} ring />
                  {claimedFirst}
                </span>
              )}
              {ownership === 'open' && !isPast && (
                // Claim/status info is sage-green family-wide. Time-relative
                // chips use coral. The two never collide visually.
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sage-500/15 text-sage-700 text-[10px] font-bold uppercase tracking-[0.08em]">
                  Tap to claim
                </span>
              )}
              {isPast && ownership !== 'mine' && ownership !== 'taken' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-ink-900/8 text-ink-700/60 text-[10px] font-bold uppercase tracking-[0.08em]">
                  ✓ Done
                </span>
              )}
              {!isPast && soon && (
                <span
                  className={
                    'shrink-0 text-[10px] uppercase tracking-[0.08em] font-bold px-1.5 py-0.5 rounded-md leading-none ' +
                    (soon.urgent
                      ? (ownership === 'mine' ? 'bg-coral-400 text-cream-50' : 'bg-coral-400 text-cream-50')
                      : (ownership === 'mine' ? 'bg-cream-50/15 text-cream-50' : 'bg-coral-400/15 text-coral-600'))
                  }
                >
                  {soon.label}
                </span>
              )}
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
      <div className="p-2 sm:p-3 flex gap-2.5 sm:gap-3 items-stretch">
        {/* PHOTO COLUMN — hero element. Tighter on mobile so the chip
            reads more like the compact week-view tile. Combined sibling
            trips scale slightly wider per kid for legibility. */}
        <div
          className={`shrink-0 relative self-stretch min-h-[108px] sm:min-h-[160px] flex gap-1`}
          style={{
            width: isCombined ? `${Math.min(22 + (allKids.length - 1) * 8, 42)}%` : '22%',
            maxWidth: isCombined ? `${Math.min(140 + (allKids.length - 1) * 48, 240)}px` : '140px',
            minWidth: isCombined ? `${68 + (allKids.length - 1) * 36}px` : '68px',
          }}
        >
          {allKids.map((kid, i) => (
            <div key={kid.id} className="flex-1 relative min-w-0">
              <ChildAvatar
                child={kid}
                shape="rect"
                rounded="rounded-xl"
                ring={ownership === 'mine' && i === 0}
              />
            </div>
          ))}
          {/* The "You're on it" pill in the action row already carries a ✓,
              so we don't duplicate it as a photo-corner overlay. */}
        </div>

        {/* CONTENT COLUMN */}
        <div className="flex-1 min-w-0 space-y-1.5 sm:space-y-2">
          {/* Time headline + relative-when. Activity hours render as a SECOND
              line below so the helper sees two distinct things:
                • when they pick the kid up (the big number — Gan dismissal)
                • when the activity itself runs (smaller, e.g. "Soccer 17:00 – 18:30") */}
          <div className="flex items-baseline gap-2 sm:gap-2.5 flex-wrap">
            <span className="font-display text-2xl sm:text-4xl tabular-nums leading-none tracking-tight">
              {prettyTime(slot.pickup_time)}
            </span>
            <span className={`text-[10px] uppercase tracking-[0.1em] font-bold ${ownership === 'mine' ? 'opacity-70' : 'text-ink-700/45'}`}>
              {slot.requires_full_presence ? 'arrive' : 'pick up'}
            </span>
            {soon && (
              <span
                className={
                  'text-[11px] uppercase tracking-[0.08em] font-bold px-2 py-0.5 rounded-full ' +
                  (soon.urgent
                    ? (ownership === 'mine' ? 'bg-coral-400/40 text-cream-50' : 'bg-coral-400 text-cream-50')
                    : (ownership === 'mine' ? 'bg-cream-50/15 text-cream-50' : 'bg-coral-400/15 text-coral-600'))
                }
              >
                {soon.label}
              </span>
            )}
          </div>
          {slot.requires_full_presence && (
            <div className={`text-[11px] uppercase tracking-[0.1em] font-bold ${ownership === 'mine' ? 'text-cream-50/95' : 'text-coral-600'}`}>
              ★ Stay the whole time
            </div>
          )}
          {/* Activity hours used to live up here as a second time-line, but
              they read better as a tail annotation on the "via" stop (the
              activity location). See the LocLine call below. */}

          {/* Kid name(s) (small caps) + activity */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] flex flex-wrap gap-x-1.5 gap-y-0.5">
              {allKids.map((kid, i) => (
                <span
                  key={kid.id}
                  style={{ color: ownership === 'mine' ? 'rgba(253,250,243,0.85)' : kid.color }}
                >
                  {kid.name}
                  {i < allKids.length - 1 && (
                    <span className={ownership === 'mine' ? 'opacity-50' : 'text-ink-700/40'}> →</span>
                  )}
                </span>
              ))}
            </div>
            <div className={`font-display text-xl sm:text-2xl leading-[1.15] tracking-tight ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
              {slot.title}
            </div>
          </div>

          {/* Locations — full route. The headline time at the top already
              shows the FIRST stop's pickup time, so we suppress the "by
              HH:MM" prefix on the very first stop. Subsequent Gan stops
              for combined siblings carry "· by HH:MM" at the END of the
              line (after the address) so the eye reads location-then-time. */}
          <div className={`text-sm space-y-1 pt-0.5 ${ownership === 'mine' ? 'opacity-95' : ''}`}>
            {(() => {
              type Stop = {
                label: string;
                loc: any;
                byTime: string | null;
                endTime?: string | null;
                activityLabel?: string | null;
              };
              const stops: Stop[] = [];
              if (pickup) {
                stops.push({ label: 'from', loc: pickup, byTime: null });
              }
              for (const k of slot.additional_children ?? []) {
                const sl = (k as any).school_location;
                if (sl) stops.push({
                  label: 'then',
                  loc: sl,
                  byTime: (k as any).gan_dismissal_time ?? null,
                });
              }
              if (via) {
                // Activity hours go on the via stop ("Drahi · Judo 16:30 – 17:15")
                // when the calendar event has them.
                const aStart = slot.activity_start_time;
                const aEnd = slot.end_time;
                stops.push({
                  label: 'via',
                  loc: via,
                  byTime: aStart && aStart !== slot.pickup_time ? aStart : null,
                  endTime: aEnd && aEnd !== slot.pickup_time ? aEnd : null,
                  activityLabel: aStart && aStart !== slot.pickup_time ? slot.title : null,
                });
              }
              if (dest) stops.push({ label: 'to', loc: dest, byTime: null });
              if (!pickup) {
                return (
                  <div className={`flex items-center gap-1.5 ${ownership === 'mine' ? 'text-cream-50/95' : 'text-coral-600'}`}>
                    <span>⚠︎</span>
                    <span className="font-medium">Pickup location not set</span>
                  </div>
                );
              }
              return stops.map((s, i) => (
                <LocLine
                  key={i}
                  label={s.label}
                  loc={s.loc}
                  byTime={s.byTime}
                  endTime={s.endTime}
                  activityLabel={s.activityLabel}
                  mine={ownership === 'mine'}
                />
              ));
            })()}
          </div>

          {slot.notes && (
            <div className={`text-[13px] flex gap-1.5 leading-snug ${ownership === 'mine' ? 'opacity-90' : 'text-ink-700/80'}`}>
              <span className="opacity-60 shrink-0">·</span>
              <span>{tellable(slot.notes)}</span>
            </div>
          )}

          {/* Status + action — when claimed (by anyone), the "X's on it" pill
              IS the action area. Unclaiming happens through the modal so the
              chip doesn't carry a destructive button inline. */}
          <div className="pt-3 flex items-center justify-between gap-3 flex-wrap">
            {ownership === 'mine' ? (
              <>
                <span className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-cream-50/20 text-cream-50 text-base font-semibold">
                  <span className="h-6 w-6 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-sm font-bold">✓</span>
                  You're on it
                </span>
                {showUnclaim && (
                  <button
                    onClick={(e) => { e.stopPropagation(); doClaim(); }}
                    disabled={pending}
                    className="ml-auto rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 active:scale-95 bg-cream-50/15 hover:bg-cream-50/25 text-cream-50 px-4 py-2.5 focus:outline-none focus:ring-4 focus:ring-cream-50/20"
                    aria-label="Unclaim this pickup"
                  >
                    {pending ? '…' : 'Unclaim'}
                  </button>
                )}
              </>
            ) : ownership === 'taken' ? (
              <span className="inline-flex items-center gap-2.5 pl-1 pr-4 py-1 rounded-full bg-sage-500/15 text-sage-700 text-base font-semibold">
                <HelperAvatar name={claimedBy?.full_name ?? '?'} photoUrl={claimedBy?.photo_url} size={32} ring />
                {firstNameOf(claimedBy?.full_name)}'s on it
              </span>
            ) : (
              <>
                {/* "Needs a helper" status pill switches from coral to
                    sage so it lines up with the rest of the claim/status
                    visual language family-wide. */}
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-sage-700 shrink-0">Needs a helper</span>
                <button
                  onClick={(e) => { e.stopPropagation(); doClaim(); }}
                  disabled={pending}
                  className="ml-auto rounded-2xl text-base font-bold tracking-wide transition-all duration-150 active:scale-95 bg-sage-500 hover:bg-sage-600 text-cream-50 px-6 py-3.5 shadow-card hover:shadow-cardHover focus:outline-none focus:ring-4 focus:ring-sage-500/30"
                >
                  {pending ? 'Claiming…' : 'Claim this pickup'}
                </button>
              </>
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

/** First name from a "First Last" or "First (Nickname)" full name. */
function firstNameOf(name: string | null | undefined): string {
  if (!name) return 'Someone';
  return name.split(/[\s(]/)[0] || name;
}

function LocLine({ label, loc, mine, byTime, endTime, activityLabel }: {
  label: string;
  loc: any;
  mine: boolean;
  byTime?: string | null;
  endTime?: string | null;
  /** When set, the time tail reads "Judo 16:30 – 17:15" instead of "by 16:30". */
  activityLabel?: string | null;
}) {
  const href = mapsHref(loc);
  const addr = (formatAddress(loc) ?? '');
  // Build the time tail: either a sibling Gan max-arrival ("by 16:30") or
  // an activity window ("Judo 16:30 – 17:15") appended to the via stop.
  let timeTail: string | null = null;
  if (byTime) {
    timeTail = activityLabel
      ? `${activityLabel} ${prettyTime(byTime)}${endTime ? ` – ${prettyTime(endTime)}` : ''}`
      : `by ${prettyTime(byTime)}`;
  }
  return (
    <div className="leading-snug">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[11px] uppercase tracking-wider font-semibold shrink-0 mt-0.5 ${mine ? 'opacity-65' : 'text-ink-700/50'}`}>
          {label}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-medium">{loc.label}</span>
          {addr && <span className={`ml-1.5 ${mine ? 'opacity-75' : 'text-ink-700/60'}`}>· {addr}</span>}
          {timeTail && (
            <span className={`ml-1.5 tabular-nums font-bold ${mine ? 'opacity-95' : 'text-ink-900'}`}>
              · {timeTail}
            </span>
          )}
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
      {/* Note: location.notes (door codes, ganenet phone, teacher contact) are
          intentionally NOT shown on the chip — they appear only after the
          helper taps into the detail modal. Keeps the schedule scan-clean. */}
    </div>
  );
}
