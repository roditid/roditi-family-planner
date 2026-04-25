import { ImageResponse } from 'next/og';

// iOS Add-to-Home-Screen icon — 180×180 is Apple's preferred touch icon size.
// Uses the cream/sage palette so the family pickup planner has its own
// recognisable square on the home screen.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#FBF6EC',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            background: '#5C7A5F',
            color: '#FBF6EC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Georgia, serif',
            fontSize: 92,
            fontWeight: 400,
            borderRadius: 28,
            boxShadow: '0 8px 16px rgba(20,20,16,0.18)',
          }}
        >
          P
        </div>
      </div>
    ),
    size
  );
}
