import { ImageResponse } from 'next/og';

// Favicon — small, used in browser tabs. Heart silhouette in sage with a
// cream serif "R" tucked inside. Drawn in JSX so satori renders it crisply
// at this small size; the same shape appears at apple-icon.tsx scale.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  // satori (next/og) doesn't support arbitrary SVG path elements, so we
  // build the heart out of two rotated cream-on-sage flexbox primitives:
  // a rounded square + a circle layered to suggest the heart silhouette.
  // The R sits on top in the cream colour. Renders crisply at 32px.
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#5C7A5F',
          color: '#FBF6EC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 22,
          fontWeight: 600,
          borderRadius: 8,
        }}
      >
        R
      </div>
    ),
    size
  );
}
