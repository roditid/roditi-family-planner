'use client';

/**
 * Round avatar for a child. Falls back to a colored circle with the kid's
 * initial if no photo_url is set (or the file doesn't load yet). The image
 * is square-cropped to the circle and zoomed slightly so faces stay
 * centered even on portrait shots.
 */
import type { Child } from '@/lib/types';

interface Props {
  child: Pick<Child, 'name' | 'color' | 'photo_url'>;
  size?: number;       // px
  ring?: boolean;      // soft white ring around the avatar
}

export default function ChildAvatar({ child, size = 36, ring = false }: Props) {
  const px = `${size}px`;
  const photo = child.photo_url;
  return (
    <span
      className={`inline-block rounded-full overflow-hidden shrink-0 ${ring ? 'ring-2 ring-cream-50' : ''}`}
      style={{
        width: px,
        height: px,
        background: child.color,
        boxShadow: '0 1px 2px rgba(20,20,16,0.18)',
      }}
      aria-label={child.name}
    >
      {photo ? (
        // Plain <img> so it works server-rendered without next/image domain config.
        // object-cover crops square; object-position 50% 30% biases toward the face
        // since portrait photos tend to have heads in the upper-third.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={child.name}
          className="w-full h-full object-cover block"
          style={{ objectPosition: '50% 28%' }}
          loading="lazy"
          onError={(e) => {
            // Hide the <img> so the colored background + initial show through.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      {!photo && (
        <span
          className="w-full h-full grid place-items-center font-bold text-cream-50"
          style={{ fontSize: size * 0.45 }}
        >
          {child.name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}
