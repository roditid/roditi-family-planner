/**
 * Round portrait of a helper. The face is the identifier — Levanah's hand
 * with the kids reads way faster than "Vovo (Levanah)" in 11px text.
 *
 * Falls back gracefully:
 *   • photo_url present → real photo
 *   • photo missing → initial letter on a sage circle
 *
 * Sized in pixels. Always renders as a circle and crops to face center.
 */

interface Props {
  name: string;
  photoUrl?: string | null;
  size?: number;
  ring?: boolean;
}

export default function HelperAvatar({ name, photoUrl, size = 28, ring = false }: Props) {
  const px = `${size}px`;
  return (
    <span
      className={`inline-block rounded-full overflow-hidden shrink-0 align-middle ${ring ? 'ring-2 ring-cream-50' : ''}`}
      style={{
        width: px,
        height: px,
        background: '#7FA87D',
        boxShadow: '0 1px 2px rgba(20,20,16,0.2)',
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
          className="w-full h-full grid place-items-center text-cream-50 font-bold"
          style={{ fontSize: size * 0.45 }}
        >
          {(name ?? '?').slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
