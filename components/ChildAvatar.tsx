'use client';

/**
 * Per-child framing tweaks. Yali's source photo crops tighter on her face
 * than Adam's and Liam's, so she looks oversized in the same container.
 * We dial her down with a small scale + repositioned origin so all three
 * kids feel like they're shot at the same distance.
 */
function photoStyle(name: string): React.CSSProperties {
  const n = (name ?? '').toLowerCase();
  if (n === 'yali') {
    return {
      objectPosition: '50% 22%',
      transform: 'scale(0.78)',
      transformOrigin: '50% 32%',
    };
  }
  return { objectPosition: '50% 28%' };
}

/**
 * Avatar for a child. Two shapes:
 *
 *   shape="circle" (default) — round, sized by `size` (px). Fallback is the
 *     kid's initial on their color.
 *
 *   shape="rect" — rounded rectangle that FILLS its parent (width/height 100%).
 *     Use this when you want the kid's face as a hero element: wrap in a sized
 *     container and the photo will stretch to fill it. Aspect ratio comes
 *     from the container, not the avatar.
 *
 * Photos are object-cover with a face-biased object-position so portrait
 * shots stay centered on the face.
 */
import type { Child } from '@/lib/types';

interface Props {
  child: Pick<Child, 'name' | 'color' | 'photo_url'>;
  size?: number;       // px — only used when shape='circle'
  ring?: boolean;      // soft cream ring around the avatar
  shape?: 'circle' | 'rect';
  rounded?: string;    // tailwind radius class for shape='rect' (default rounded-xl)
}

export default function ChildAvatar({ child, size = 36, ring = false, shape = 'circle', rounded = 'rounded-xl' }: Props) {
  const photo = child.photo_url;

  if (shape === 'rect') {
    return (
      <span
        className={`block w-full h-full overflow-hidden ${rounded} ${ring ? 'ring-2 ring-cream-50' : ''}`}
        style={{
          background: child.color,
          boxShadow: '0 1px 3px rgba(20,20,16,0.18)',
        }}
        aria-label={child.name}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={child.name}
            className="w-full h-full object-cover block"
            style={photoStyle(child.name)}
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span
            className="w-full h-full grid place-items-center font-bold text-cream-50 font-display"
            style={{ fontSize: 'clamp(28px, 8vw, 56px)' }}
          >
            {child.name.slice(0, 1)}
          </span>
        )}
      </span>
    );
  }

  // ── shape = 'circle'
  const px = `${size}px`;
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={child.name}
          className="w-full h-full object-cover block"
          style={{ objectPosition: '50% 28%' }}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
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
