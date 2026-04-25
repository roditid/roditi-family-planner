import { redirect } from 'next/navigation';

// /pickups consolidated into /my-pickups (with a "Just mine" filter toggle).
// Keep this redirect so old bookmarks still work.
export default function PickupsRedirect() {
  redirect('/my-pickups');
}
