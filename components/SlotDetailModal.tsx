'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SlotView } from '@/lib/types';
import { mapsHref } from '@/lib/maps';
import { prettyTime } from '@/lib/week';
import { tellable } from '@/lib/phones';
import ChildAvatar from './ChildAvatar';
import HelperAvatar from './HelperAvatar';
import { updateSlotNotesAction } from '@/app/_actions/admin';

/**
 * Bottom-sheet (mobile) / centered dialog (desktop) showing the full slot
 * details: pickup + drop-off addresses, hours, door codes, ganenet
 * contacts (with tap-to-call), notes, and the Claim/Unclaim action.
 *
 * Admins get an inline notes editor (small "edit" affordance on the note
 * card) so Paula can drop a one-off reminder onto any pickup at any time.
 */
export default function SlotDetailModal({
  slot, currentUserId, currentUserPhone, currentUserName, isAdmin, ownership, pending, claimedBy, err, onClose, onClaim,
}: {
  slot: SlotView;
  currentUserId: string;
  currentUserPhone?: string | null;
  currentUserName?: string | null;
  isAdmin?: boolean;
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
  const via = slot.via_location ?? (slot.via_location_text ? { label: slot.via_location_text, street: null, city: null, lat: null, lng: null, notes: null } as any : null);
  const dest = slot.destination_location ?? (slot.destination_text ? { label: slot.destination_text, street: null, city: null, lat: null, lng: null, notes: null } as any : null);
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const yaliInTrip = allKids.some((k) => k.name.toLowerCase() === 'yali');

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
          {/* Confirmed banner — shown when this is now your pickup */}
          {ownership === 'mine' && (
            <div className="rounded-xl bg-sage-500/10 border border-sage-500/30 px-3.5 py-2.5 flex items-center gap-2.5">
              <span className="h-7 w-7 rounded-full bg-sage-500 text-cream-50 grid place-items-center text-sm font-bold shadow-sm">✓</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sage-700 leading-tight">You're on this pickup</div>
                <div className="text-xs text-ink-700/65 mt-0.5">Screenshot below or share to your phone.</div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex -space-x-2 shrink-0">
              {allKids.map((kid, i) => (
                <span key={kid.id} style={{ zIndex: allKids.length - i }} className="ring-2 ring-cream-50 rounded-full">
                  <ChildAvatar child={kid} size={48} />
                </span>
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.1em] flex flex-wrap gap-x-1.5 gap-y-0.5">
                {allKids.map((kid, i) => (
                  <span key={kid.id} style={{ color: kid.color }}>
                    {kid.name}
                    {i < allKids.length - 1 && <span className="text-ink-700/40"> →</span>}
                  </span>
                ))}
              </div>
              <div className="font-display text-2xl sm:text-3xl leading-tight tracking-tight">{slot.title}</div>
              {/* Header time = pickup time only. Activity hours live as a
                  badge on the "Then go to" stop card below, so the helper
                  doesn't see two competing time lines at the top. */}
              <div className="text-sm text-ink-700/70 mt-0.5 tabular-nums">
                <span className="font-semibold text-ink-900">Pick up {prettyTime(slot.pickup_time)}</span>
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

          {/* Stops: pickup → (additional siblings' Ganim) → via → drop-off.
              Sibling stops carry a "by HH:MM" badge in the corner of the
              card so the helper can pace the walk. The first stop's time
              is already shown in the modal header (the big "Pick up 16:00"
              line) so we don't repeat it here. */}
          <DetailLoc label="Pick up from" loc={pickup} />
          {(slot.additional_children ?? []).map((kid: any) => kid.school_location && (
            <DetailLoc
              key={kid.id}
              label={`Then pick up ${kid.name}`}
              loc={kid.school_location}
              byTime={kid.gan_dismissal_time ?? null}
            />
          ))}
          {via && (
            <DetailLoc
              label="Then go to"
              loc={via}
              byTime={slot.activity_start_time ?? null}
              endTime={slot.end_time ?? null}
              activityTitle={slot.title}
            />
          )}
          <DetailLoc label={via || (slot.additional_children ?? []).length > 0 ? 'Then drop off at' : 'Drop off at'} loc={dest} />

          {/* Full-presence indicator — special at-Gan activities (Shavuot,
              Lag Baomer, parents day) require the helper to stay for the
              whole event, not just do pickup. */}
          {slot.requires_full_presence && (
            <div className="rounded-xl bg-coral-400/12 border border-coral-400/30 p-3.5 text-sm">
              <div className="text-[10px] uppercase tracking-[0.1em] text-coral-600 font-bold mb-1">★ Stay the whole time</div>
              <div className="text-ink-900 leading-relaxed">
                This is a Gan event for parents/family — please be there from start to end, not just pickup.
              </div>
            </div>
          )}

          {/* Stroller note — only when Yali is in the trip */}
          {yaliInTrip && <StrollerNote />}

          {/* Notes (slot-level) — visible to everyone, editable by admins */}
          <SlotNoteCard slot={slot} canEdit={!!isAdmin} />

          {/* Status row — only show for 'taken' or 'open' ('mine' has the banner above) */}
          {ownership !== 'mine' && (
            <div className="pt-2 border-t border-black/[0.06]">
              {ownership === 'taken' ? (
                <div className="text-sm flex items-center gap-2.5">
                  <HelperAvatar name={claimedBy?.full_name ?? '?'} photoUrl={claimedBy?.photo_url} size={36} ring />
                  <span><b>{claimedBy?.full_name}</b> is on this one.</span>
                </div>
              ) : (
                <div className="text-sm font-medium text-coral-600">Needs a helper.</div>
              )}
            </div>
          )}

          {/* Action */}
          {ownership !== 'taken' && (
            <div className="space-y-2">
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
              {ownership === 'mine' && (
                <ShareButtons
                  slot={slot}
                  currentUserPhone={currentUserPhone}
                  currentUserName={currentUserName}
                />
              )}
            </div>
          )}
          {err && <div className="text-sm text-coral-600 font-medium">{err}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Slot-level note card. Read-only for helpers, editable for admins.
 * The edit affordance is a small pencil that swaps the card for a textarea
 * + Save / Cancel. Notes show up immediately for everyone after save.
 */
function SlotNoteCard({ slot, canEdit }: { slot: SlotView; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.notes ?? '');
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!editing) {
    if (!slot.notes && !canEdit) return null;
    return (
      <div className="rounded-xl bg-cream-200/40 p-3.5 text-sm relative">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold">
            {slot.notes ? 'Note for the helper' : 'No note yet'}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="text-xs text-sage-700 font-semibold hover:underline"
            >
              {slot.notes ? 'Edit' : '+ Add note'}
            </button>
          )}
        </div>
        {slot.notes && <div className="text-ink-700/85 leading-relaxed">{tellable(slot.notes)}</div>}
      </div>
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const fd = new FormData();
    fd.set('slot_id', slot.id);
    fd.set('notes', draft);
    start(async () => {
      await updateSlotNotesAction(fd);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="rounded-xl bg-cream-200/40 p-3.5 text-sm space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold">Note for the helper</div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="e.g. Yali needs sun hat today. Levanah will return the keys after."
        className="w-full rounded-lg border border-black/10 bg-cream-50 p-2.5 text-sm leading-relaxed focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setEditing(false); setDraft(slot.notes ?? ''); }}
          className="px-3 py-1.5 text-xs font-semibold text-ink-700/65 hover:text-ink-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-3.5 py-1.5 rounded-lg bg-sage-500 hover:bg-sage-600 text-cream-50 text-xs font-semibold disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </form>
  );
}

/**
 * Build a screenshot/share-friendly multi-line summary of the pickup. Includes
 * everything the helper needs in their pocket: kids, time, every stop with
 * its address + door code + ganenet phone, plus the stroller reminder if
 * Yali is in the trip. Plain text — works in WhatsApp, SMS, email body.
 */
function buildSummary(slot: SlotView): string {
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' → ');
  const time = slot.pickup_time.slice(0, 5);
  const endTime = slot.end_time?.slice(0, 5);
  const dateLabel = (() => {
    const d = new Date(slot.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  const lines: string[] = [];
  // Header: kids → title (e.g. "Liam, Adam, Yali — Home" or "Liam — Soccer").
  // For combined Gan→Home trips this is the only place the kid names appear
  // in the body, so keep them. For activity trips it's the same one-liner.
  lines.push(`${kidNames} — ${slot.title}`);
  lines.push(`${dateLabel} · ${time}${endTime ? ` – ends ${endTime}` : ''}`);
  lines.push('');

  // Stops: every Gan in the route + via + destination.
  // Just NAME + ADDRESS per stop — no door codes, no ganenet phones, no
  // hours. Helpers see those in the app when they tap into the activity;
  // the share message stays uncluttered.
  const stops: { label: string; loc: any }[] = [];
  if (slot.pickup_location) stops.push({ label: 'PICK UP FROM', loc: slot.pickup_location });
  else if (slot.pickup_location_text) stops.push({ label: 'PICK UP FROM', loc: { label: slot.pickup_location_text } });
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    if (sl) stops.push({ label: `THEN PICK UP ${k.name.toUpperCase()}`, loc: sl });
  }
  if (slot.via_location) stops.push({ label: 'THEN GO TO', loc: slot.via_location });
  if (slot.destination_location) stops.push({
    label: stops.length > 1 ? 'THEN DROP OFF AT' : 'DROP OFF AT',
    loc: slot.destination_location,
  });

  for (const s of stops) {
    lines.push(s.label);
    lines.push(s.loc.label);
    const addr = [s.loc.street, s.loc.city].filter(Boolean).join(', ');
    if (addr) lines.push(addr);
    lines.push('');
  }

  const yaliInTrip = allKids.some((k) => k.name.toLowerCase() === 'yali');
  if (yaliInTrip) {
    lines.push('STROLLER');
    lines.push('Yali needs a stroller. Check with Dani whether the stroller is at the Gan.');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Action row shown on a claimed pickup — deep links the summary into
 * WhatsApp (to the helper's own number, so it lands in their chat with
 * themselves) and into the share sheet (mobile native).
 */
function ShareButtons({ slot, currentUserPhone, currentUserName }: {
  slot: SlotView;
  currentUserPhone?: string | null;
  currentUserName?: string | null;
}) {
  const summary = buildSummary(slot);
  const phone = (currentUserPhone ?? '').replace(/[^\d]/g, '');
  // Without a phone on file, wa.me/?text= opens the share-to-someone picker.
  const waHref = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(summary)}`
    : `https://wa.me/?text=${encodeURIComponent(summary)}`;

  function nativeShare(e: React.MouseEvent) {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      e.preventDefault();
      (navigator as any).share({ title: 'Pickup details', text: summary }).catch(() => {});
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={waHref}
        target="_blank" rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center gap-1.5 rounded-2xl bg-[#25D366] hover:bg-[#1ebe57] text-white py-3 text-sm font-semibold active:scale-[0.97] transition"
      >
        Send to my WhatsApp
      </a>
      <button
        type="button"
        onClick={nativeShare}
        className="rounded-2xl bg-cream-200/60 hover:bg-cream-200 text-ink-900 py-3 text-sm font-semibold active:scale-[0.97] transition"
      >
        Share / save
      </button>
    </div>
  );
}

/**
 * Stroller note + a tap-to-WhatsApp link to Dani so the helper can confirm
 * whether the stroller is at the Gan or needs to be picked up from home first.
 * Reads Dani's phone from NEXT_PUBLIC_DANI_PHONE; if unset, falls back to a
 * WhatsApp share link (no recipient — user picks).
 */
function StrollerNote() {
  const daniPhone = (process.env.NEXT_PUBLIC_DANI_PHONE ?? '').replace(/[^\d]/g, '');
  const message = "Hi Dani, I'm picking up Yali today — is the stroller already at the Gan?";
  const href = daniPhone
    ? `https://wa.me/${daniPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  return (
    <div className="rounded-xl bg-coral-400/10 border border-coral-400/30 p-3.5 text-sm leading-relaxed">
      <div className="text-[10px] uppercase tracking-[0.1em] text-coral-600 font-bold mb-1">Stroller</div>
      <div className="text-ink-900">
        Yali needs a stroller. Please check with Dani whether the stroller is at the Gan.
      </div>
      <a
        href={href}
        target="_blank" rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-sage-700 hover:underline"
      >
        Message Dani on WhatsApp →
      </a>
    </div>
  );
}

function DetailLoc({ label, loc, byTime, endTime, activityTitle }: {
  label: string;
  loc: any;
  byTime?: string | null;
  endTime?: string | null;
  activityTitle?: string;
}) {
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
  // Split notes on sentence breaks so each fact (hours, door code, ganenet,
  // etc.) renders on its own line — easier to scan, easier to screenshot.
  const noteLines: string[] = (loc.notes ?? '')
    .split(/\n+|(?<=[\.\!])\s+/)
    .map((s: string) => s.trim())
    .filter(Boolean);
  // Build a small time-badge string for the corner (e.g. "by 16:30" for a
  // sibling Gan, or "Soccer 17:00 – 18:30" for an activity stop).
  let badge: string | null = null;
  if (byTime) {
    badge = activityTitle
      ? `${activityTitle} ${prettyTime(byTime)}${endTime ? ` – ${prettyTime(endTime)}` : ''}`
      : `by ${prettyTime(byTime)}`;
  }
  return (
    <div className="rounded-xl bg-cream-200/40 p-3.5">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold">{label}</div>
        {badge && (
          <div className="text-[11px] tabular-nums font-bold text-ink-900 bg-cream-50 rounded-full px-2 py-0.5 leading-none shrink-0">
            {badge}
          </div>
        )}
      </div>
      <div className="font-display text-lg leading-tight">{loc.label}</div>
      {addr && <div className="text-sm text-ink-700/70 mt-0.5">{addr}</div>}
      {noteLines.length > 0 && (
        <ul className="text-sm text-ink-700/80 mt-1.5 leading-relaxed space-y-0.5">
          {noteLines.map((line, i) => (
            <li key={i}>{tellable(line)}</li>
          ))}
        </ul>
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
