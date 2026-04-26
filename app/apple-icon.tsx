import { ImageResponse } from 'next/og';

// iOS Add-to-Home-Screen icon — 180×180 is Apple's preferred touch icon size.
// A sage heart with a cream italic "R" inside. Lives on a cream square so
// it sits cleanly on any iOS wallpaper.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  // Heart-suggestion lockup using satori-friendly flexbox primitives — two
  // rounded sage shapes layered with an italic R on top. The actual heart
  // SVG lives at /public/r-heart.svg and is used in the in-app header.
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#FBF6EC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            background: '#5C7A5F',
            color: '#FBF6EC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            fontSize: 100,
            fontWeight: 600,
            borderRadius: 36,
            boxShadow: '0 8px 16px rgba(20,20,16,0.18)',
          }}
        >
          R
        </div>
      </div>
    ),
    size
  );
}
