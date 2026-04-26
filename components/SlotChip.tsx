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
export default function SlotChip({ slot, currentUserId, currentUserPhone, currentUserName, isAdmin, density = 'roomy' }: Props) {
  const initialState: ClaimState =
    slot.assignment?.assigned_to_user_id === currentUserId ? 'mine'
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

  // ─── COMPACT (column views: 3-day / week): photo-led, taller card, more
  // detail. The photo runs taller (3:4) so the kid's face dominates; below
  // it we show time, kid label(s), activity, pickup → drop-off, end time,
  // and a status pill. Tap body opens the modal for full detail + claim.
  if (density === 'compact') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`group relative w-full text-left rounded-xl border transition-all duration-150 active:scale-[0.985] overflow-hidden flex flex-col ${surface} ${pending ? 'opacity-90' : ''}`}
        >
          {/* Photo block — square aspect (1:1) so each chip leaves more room
              for the route + status text below. Combined sibling trips show
              kids side-by-side at equal widths. */}
          <div className="relative w-full flex gap-0.5" style={{ aspectRatio: '1 / 1' }}>
            {allKids.map((kid) => (
              <div key={kid.id} className="flex-1 relative min-w-0">
                <ChildAvatar child={kid} shape="rect" rounded="rounded-none" />
              </div>
            ))}
            {/* Time chip overlaid bottom-left + relative-when below it when imminent */}
            <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded-md bg-cream-50/95 text-ink-900 font-display text-[15px] tabular-nums leading-none shadow-sm">
              {prettyTime(slot.pickup_time)}
            </span>
            {soon && (
              <span
                className={
                  'absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm leading-none ' +
                  (soon.urgent ? 'bg-coral-400 text-cream-50' : 'bg-cream-50/95 text-coral-600')
                }
              >
                {soon.label}
              </span>
            )}
            {ownership === 'mine' && (
              <span className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-[11px] font-bold shadow-sm">✓</span>
            )}
            {ownership === 'open' && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-coral-400 ring-2 ring-cream-50" aria-hidden />
            )}
          </div>

          {/* Text block — flex-1 so it stretches and fills any remaining
              vertical space in the column. Generous spacing between rows. */}
          <div className="px-2.5 py-2.5 flex-1 flex flex-col gap-1.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] leading-none flex flex-wrap gap-x-1 gap-y-0.5">
              {allKids.map((kid, i) => (
                <span key={kid.id} style={{ color: ownership === 'mine' ? 'rgba(253,250,243,0.85)' : kid.color }}>
                  {kid.name}
                  {i < allKids.length - 1 && <span className={ownership === 'mine' ? 'opacity-50' : 'text-ink-700/40'}> →</span>}
                </span>
              ))}
            </div>
            <div className={`font-display text-[15px] leading-[1.15] tracking-tight line-clamp-2 ${ownership === 'mine' ? 'text-cream-50' : 'text-ink-900'}`}>
              {slot.title}
            </div>

            {/* Route summary — every stop on its own line. Includes the
                additional siblings' Ganim as 'via' stops on combined trips,
                so a Yali → Liam → Home shows from / via / to instead of just
                from / to. */}
            <div className={`text-[11px] leading-snug space-y-0.5 ${ownership === 'mine' ? 'opacity-85' : 'text-ink-700/65'}`}>
              {(() => {
                type Row = { label: string; text: string };
                const rows: Row[] = [];
                if (pickup?.label) rows.push({ label: 'from', text: pickup.label });
                for (const k of slot.additional_children ?? []) {
                  const sl = (k as any).school_location;
                  if (sl?.label) rows.push({ label: 'via', text: sl.label });
                }
                if (via?.label) rows.push({ label: 'via', text: via.label });
                if (dest?.label) rows.push({ label: 'to', text: dest.label });
                return rows.map((r, i) => (
                  <div key={i} className="flex gap-1">
                    <span className="opacity-60 shrink-0">{r.label}</span>
                    <span className="truncate">{r.text}</span>
                  </div>
                ));
              })()}
            </div>

            {slot.end_time && (
              <div className={`text-[10px] tabular-nums uppercase tracking-wider font-semibold ${ownership === 'mine' ? 'opacity-70' : 'text-ink-700/50'}`}>
                ends {prettyTime(slot.end_time)}
              </div>
            )}

            {/* Status pill — bottom-aligned via mt-auto so all chips line up */}
            <div className="mt-auto pt-1.5">
              {ownership === 'mine' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-cream-50/15 text-cream-50 text-[10px] font-bold uppercase tracking-[0.1em]">
                  <span className="h-3.5 w-3.5 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-[9px]">✓</span>
                  You're on it
                </span>
              ) : ownership === 'taken' ? (
                <span className="inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-full bg-sage-500/12 text-sage-700 text-[10px] font-bold uppercase tracking-[0.08em]">
                  <HelperAvatar name={claimedBy?.full_name ?? '?'} photoUrl={claimedBy?.photo_url} size={20} ring />
                  {firstNameOf(claimedBy?.full_name)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-coral-400/15 text-coral-600 text-[10px] font-bold uppercase tracking-[0.1em]">
                  Tap to claim
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
      <div className="p-3 sm:p-4 flex gap-3 sm:gap-4 items-stretch">
        {/* PHOTO COLUMN — hero element. Solo trips use one tall portrait;
            combined sibling trips show kids side-by-side at the same height
            so you see ALL their faces at a glance. The combined column gets
            wider to keep individual faces readable. */}
        <div
          className={`shrink-0 relative self-stretch min-h-[170px] flex gap-1`}
          style={{
            width: isCombined ? `${Math.min(38 + (allKids.length - 1) * 14, 56)}%` : '38%',
            maxWidth: isCombined ? `${Math.min(180 + (allKids.length - 1) * 60, 320)}px` : '180px',
            minWidth: isCombined ? `${120 + (allKids.length - 1) * 56}px` : '120px',
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
          {ownership === 'mine' && (
            <span className="absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-sm font-bold shadow-sm border border-sage-600/20 z-10">
              ✓
            </span>
          )}
        </div>

        {/* CONTENT COLUMN */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Time headline + relative-when. Activity hours render as a SECOND
              line below so the helper sees two distinct things:
                • when they pick the kid up (the big number — Gan dismissal)
                • when the activity itself runs (smaller, e.g. "Soccer 17:00 – 18:30") */}
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="font-display text-3xl sm:text-4xl tabular-nums leading-none tracking-tight">
              {prettyTime(slot.pickup_time)}
            </span>
            <span className={`text-[10px] uppercase tracking-[0.1em] font-bold ${ownership === 'mine' ? 'opacity-70' : 'text-ink-700/45'}`}>
              pick up
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
              <span className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-cream-50/20 text-cream-50 text-base font-semibold">
                <span className="h-6 w-6 rounded-full bg-cream-50 text-sage-700 grid place-items-center text-sm font-bold">✓</span>
                You're on it
              </span>
            ) : ownership === 'taken' ? (
              <span className="inline-flex items-center gap-2.5 pl-1 pr-4 py-1 rounded-full bg-sage-500/15 text-sage-700 text-base font-semibold">
                <HelperAvatar name={claimedBy?.full_name ?? '?'} photoUrl={claimedBy?.photo_url} size={32} ring />
                {firstNameOf(claimedBy?.full_name)}'s on it
              </span>
            ) : (
              <>
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-coral-600 shrink-0">Needs a helper</span>
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
