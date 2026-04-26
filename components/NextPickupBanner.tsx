/**
 * NextPickupBanner — sticky-ish strip rendered under the app header on every
 * authenticated page. Tells the helper, at a glance, what's next on their
 * plate.
 *
 *   • Helper with a claimed pickup coming up: shows time + kid + activity.
 *   • Helper with nothing claimed: gentle "no pickups assigned this week"
 *     CTA that links to /my-pickups so they can claim one.
 *   • Admin: shows the next FAMILY pickup (any kid, any helper) so Paula
 *     and Dani always know what's about to happen at home.
 *
 * Renders nothing if the household has no upcoming pickups at all (so it
 * doesn't show as an empty bar in seed/empty-state environments).
 */
import Link from 'next/link';
import { addDays, format } from 'date-fns';
import { fetchSlots } from '@/lib/slots';
import { supabaseServer } from '@/lib/supabase/server';
import type { SlotView } from '@/lib/types';
import { relativeTimeUntil } from '@/lib/relative-time';

export default async function NextPickupBanner({
  householdId,
  userId,
  isAdmin,
}: {
  householdId: string;
  userId: string;
  isAdmin: boolean;
}) {
  const sb = supabaseServer();
  const today = new Date();
  const startISO = format(today, 'yyyy-MM-dd');
  const endISO = format(addDays(today, 14), 'yyyy-MM-dd');

  const all = await fetchSlots(sb, householdId, startISO, endISO);
  if (all.length === 0) return null;

  // Filter to "future-or-current" slots. A slot is "still relevant" if it
  // hasn't passed its pickup time by more than 2 hours (helper might still
  // be running it).
  const now = new Date();
  const stillRelevant = (s: SlotView) => {
    const [h, m] = s.pickup_time.split(':').map(Number);
    const t = new Date(s.date + 'T00:00:00');
    t.setHours(h, m, 0, 0);
    return t.getTime() > now.getTime() - 2 * 60 * 60 * 1000;
  };

  const sorted = all
    .filter(stillRelevant)
    .sort((a, b) => (a.date + a.pickup_time).localeCompare(b.date + b.pickup_time));

  // Try first to find one assigned to the current user.
  const mine = sorted.find((s) => s.assignment?.assigned_to_user_id === userId);
  // Fallback for admins: next family pickup (any helper / unclaimed).
  const family = sorted[0];
  const slot = mine ?? (isAdmin ? family : null);

  if (!slot) {
    // Helper with nothing assigned — gentle nudge.
    if (sorted.length === 0) return null;
    return (
      <Banner tone="open">
        <span className="font-medium">Nothing assigned to you yet.</span>{' '}
        <Link href="/my-pickups" className="underline underline-offset-2 font-semibold">
          See what's open →
        </Link>
      </Banner>
    );
  }

  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' + ');
  const time = slot.pickup_time.slice(0, 5);
  const dateLabel = (() => {
    const d = new Date(slot.date + 'T00:00:00');
    const days = Math.floor((d.getTime() - new Date(now.toDateString()).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  })();
  const soon = relativeTimeUntil(slot.date, slot.pickup_time);
  const isMine = slot.assignment?.assigned_to_user_id === userId;
  const tone = soon?.urgent ? 'urgent' : isMine ? 'mine' : 'family';
  const label = isMine ? "You're on" : isAdmin ? 'Next family pickup' : 'Next pickup';

  // Build a compact route summary "Gan Yali → Drahi → Home" for the banner
  // body, plus the first stop's address so the helper sees where they need
  // to actually be standing.
  const stops: { label: string; addr: string | null }[] = [];
  if (slot.pickup_location) {
    stops.push({
      label: slot.pickup_location.label,
      addr: [slot.pickup_location.street, slot.pickup_location.city].filter(Boolean).join(', ') || null,
    });
  } else if (slot.pickup_location_text) {
    stops.push({ label: slot.pickup_location_text, addr: null });
  }
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    if (sl) stops.push({ label: sl.label, addr: [sl.street, sl.city].filter(Boolean).join(', ') || null });
  }
  if (slot.via_location) {
    stops.push({
      label: slot.via_location.label,
      addr: [slot.via_location.street, slot.via_location.city].filter(Boolean).join(', ') || null,
    });
  }
  if (slot.destination_location) {
    stops.push({
      label: slot.destination_location.label,
      addr: [slot.destination_location.street, slot.destination_location.city].filter(Boolean).join(', ') || null,
    });
  }
  const routeLabels = stops.map((s) => s.label).join('  →  ');
  const firstAddr = stops[0]?.addr ?? null;
  const lastAddr = stops[stops.length - 1]?.addr ?? null;

  return (
    <Banner tone={tone}>
      <Link href="/my-pickups" className="flex items-stretch gap-4 sm:gap-5 w-full group">
        {/* Photo cluster — slightly bigger now, still side-by-side for combined */}
        <div className="flex -space-x-2 shrink-0 self-center">
          {allKids.slice(0, 3).map((k, i) => (
            <span
              key={k.id}
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-full overflow-hidden ring-2 ring-cream-50/80"
              style={{ background: k.color, zIndex: 10 - i }}
            >
              {k.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={k.photo_url} alt={k.name} className="w-full h-full object-cover" style={{ objectPosition: '50% 28%' }} />
              ) : (
                <span className="grid place-items-center w-full h-full text-cream-50 font-bold">
                  {k.name.slice(0, 1)}
                </span>
              )}
            </span>
          ))}
        </div>

        {/* Two-line text block: top = label + kids/title + date/time + urgency,
            bottom = full route + first/last address. */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 py-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70 shrink-0">
              {label}
            </span>
            <span className="font-display text-base sm:text-lg leading-tight truncate">
              {kidNames} <span className="opacity-50">·</span> {slot.title}
            </span>
            <span className="font-display tabular-nums text-base sm:text-lg leading-tight ml-auto shrink-0">
              {dateLabel} <span className="opacity-50">·</span> {time}
            </span>
            {soon && (
              <span
                className={
                  'shrink-0 text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded-full ' +
                  (soon.urgent
                    ? 'bg-cream-50 text-coral-600'
                    : 'bg-cream-50/25 text-cream-50')
                }
              >
                {soon.label}
              </span>
            )}
          </div>
          {routeLabels && (
            <div className="flex items-baseline gap-2 flex-wrap text-[12.5px] sm:text-[13px] opacity-85">
              <span className="font-medium tracking-tight">{routeLabels}</span>
              {firstAddr && (
                <span className="opacity-60 tabular-nums truncate">
                  {firstAddr}{lastAddr && lastAddr !== firstAddr ? `  →  ${lastAddr}` : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'mine' | 'family' | 'urgent' | 'open';
  children: React.ReactNode;
}) {
  // Tone palettes — all stay within the cream/sage/coral system. Editorial,
  // never neon. Solid tints, no gradients. Not sticky (the toolbar inside
  // /my-pickups already takes the sticky-top slot below the header), so
  // the banner reads as a prominent landing strip rather than competing.
  const cls = {
    mine: 'bg-sage-500 text-cream-50',
    family: 'bg-ink-900 text-cream-50',
    urgent: 'bg-coral-400 text-cream-50',
    open: 'bg-cream-200/60 text-ink-800 border-b border-black/5',
  }[tone];
  return (
    <div className={cls}>
      <div className="mx-auto max-w-7xl px-3 sm:px-5 py-3.5 sm:py-4 flex items-center text-sm">
        {children}
      </div>
    </div>
  );
}
