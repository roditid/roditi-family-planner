'use client';

/**
 * Portrait of a helper. The face is the identifier — Levanah's hand with
 * the kids reads way faster than "Vovo (Levanah)" in 11px text.
 *
 * Two shapes:
 *   • `shape="circle"` (default) — round, sized by `size` px. Used inline
 *     in pills, status rows, dropdown rows.
 *   • `shape="rect"` — rounded rectangle (3:4 portrait by default), sized
 *     by `width`/`height`. Used as the editorial hero next to the
 *     greeting headline ("Hi, Paula") so the helper feels seen on landing.
 *
 * Marked 'use client' because we attach an onError handler to the <img> so
 * a missing photo file gracefully falls back to the initial-letter tile.
 */

interface Props {
  name: string;
  photoUrl?: string | null;
  /** Used when shape='circle'. */
  size?: number;
  /** Used when shape='rect'. */
  width?: number;
  height?: number;
  ring?: boolean;
  shape?: 'circle' | 'rect';
}

export default function HelperAvatar({
  name,
  photoUrl,
  size = 28,
  width,
  height,
  ring = false,
  shape = 'circle',
}: Props) {
  const isRect = shape === 'rect';
  const w = isRect ? (width ?? 96) : size;
  const h = isRect ? (height ?? Math.round((width ?? 96) * 4 / 3)) : size;
  const radiusClass = isRect ? 'rounded-2xl' : 'rounded-full';

  return (
    <span
      className={`inline-block ${radiusClass} overflow-hidden shrink-0 align-middle ${ring ? 'ring-2 ring-cream-50' : ''}`}
      style={{
        width: `${w}px`,
        height: `${h}px`,
        background: '#7FA87D',
        boxShadow: isRect
          ? '0 1px 3px rgba(20,20,16,0.18)'
          : '0 1px 2px rgba(20,20,16,0.2)',
      }}
      aria-label={name}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover block"
          style={{ objectPosition: '50% 30%' }}
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span
          className="w-full h-full grid place-items-center text-cream-50 font-bold font-display"
          style={{ fontSize: Math.min(w, h) * (isRect ? 0.5 : 0.45) }}
        >
          {(name ?? '?').slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
