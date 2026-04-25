import { ImageResponse } from 'next/og';

// Favicon — small, used in browser tabs.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
          fontFamily: 'serif',
          fontSize: 24,
          fontWeight: 400,
          borderRadius: 6,
        }}
      >
        R
      </div>
    ),
    size
  );
}
