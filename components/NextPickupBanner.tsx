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

  return (
    <Banner tone={tone}>
      <Link href="/my-pickups" className="flex items-center gap-3 sm:gap-4 w-full group">
        {/* Photo cluster — small avatars, side-by-side for combined trips */}
        <div className="flex -space-x-1.5 shrink-0">
          {allKids.slice(0, 3).map((k, i) => (
            <span
              key={k.id}
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-full overflow-hidden ring-2 ring-cream-50"
              style={{ background: k.color, zIndex: 10 - i }}
            >
              {k.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={k.photo_url} alt={k.name} className="w-full h-full object-cover" style={{ objectPosition: '50% 28%' }} />
              ) : (
                <span className="grid place-items-center w-full h-full text-cream-50 font-bold text-sm">
                  {k.name.slice(0, 1)}
                </span>
              )}
            </span>
          ))}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70 shrink-0">
            {label}
          </span>
          <span className="font-display text-base sm:text-lg leading-none truncate">
            {kidNames} <span className="opacity-60">·</span> {slot.title}
          </span>
          <span className="font-display tabular-nums text-base sm:text-lg leading-none ml-auto shrink-0">
            {dateLabel} <span className="opacity-60">·</span> {time}
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
      <div className="mx-auto max-w-7xl px-3 sm:px-5 py-2.5 flex items-center text-sm">
        {children}
      </div>
    </div>
  );
}
