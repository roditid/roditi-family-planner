/**
 * Inline rank chip — sticker + title, sized to sit next to the helper's
 * name on the /my-pickups header. Mirrors the Gett "Gold / Platinum"
 * pill style: small, warm tint, never overshadows the name.
 */
import type { HelperRank } from '@/lib/ranks';

export function RankBadge({ rank, size = 'sm' }: { rank: HelperRank; size?: 'sm' | 'md' }) {
  // Editorial inline label: Cormorant italic in muted sage with a single
  // coral pin. Blends with the display headline ("Hi, Paula ♥") instead
  // of fighting it as a dark UI pill. No card frame, no caps tracking —
  // reads as a quiet subtitle that happens to mark the helper's tier.
  const text = size === 'md' ? 'text-xl' : 'text-lg';
  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle font-display italic text-sage-700/85 ${text} leading-none whitespace-nowrap`}
      title={`${rank.count} pickup${rank.count === 1 ? '' : 's'} completed`}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-coral-400 inline-block" />
      <span>{rank.current.title}</span>
      {rank.count > 0 && (
        <span className="not-italic text-sage-700/45 tabular-nums text-[0.7em] tracking-wide font-medium">
          · {rank.count}
        </span>
      )}
    </span>
  );
}

/**
 * Larger card — the centerpiece of the /my-pickups/mine tab. Shows the
 * total count, current title with sticker, and a progress bar to the
 * next tier. Designed to feel like a small reward, not a marketing pitch.
 */
export function RankCard({ rank, firstName }: { rank: HelperRank; firstName: string }) {
  const pctToNext = rank.next
    ? Math.min(100, Math.round(((rank.count - rank.current.min) / (rank.next.min - rank.current.min)) * 100))
    : 100;
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-700/55 mb-1">
            Your status
          </div>
          <div className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
            {rank.current.sticker} {rank.current.title}
          </div>
          <div className="text-sm text-ink-700/70 mt-1">
            {rank.count === 0
              ? `${firstName}, claim your first pickup to start collecting stickers.`
              : `${rank.count} pickup${rank.count === 1 ? '' : 's'} done. Nice work.`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-5xl sm:text-6xl tabular-nums leading-none text-sage-600">
            {rank.count}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-700/55 mt-1">
            completed
          </div>
        </div>
      </div>

      {rank.next ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm mb-1.5">
            <span className="text-ink-700/70">
              Next: <span className="font-medium text-ink-900">{rank.next.sticker} {rank.next.title}</span>
            </span>
            <span className="tabular-nums text-ink-700/55">
              {rank.toNext} pickup{rank.toNext === 1 ? '' : 's'} to go
            </span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.06] overflow-hidden">
            <div
              className="h-full bg-coral-400 transition-[width] duration-500"
              style={{ width: `${pctToNext}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-5 text-sm text-coral-700 font-medium">
          You've hit the top tier. The whole family thanks you.
        </div>
      )}
    </div>
  );
}
