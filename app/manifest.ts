import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Tells iOS/Android the app's identity when added to the
 * home screen, so it launches in standalone mode (no Safari chrome) and
 * shows our cream/sage colours.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Roditi Family Planner',
    short_name: 'Roditi',
    description: 'The Roditi family planner — pickups, schedules, reminders, and the small things that make a week run.',
    start_url: '/my-pickups',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FBF6EC',
    theme_color: '#FBF6EC',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
