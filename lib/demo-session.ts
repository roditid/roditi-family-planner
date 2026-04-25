import { cookies } from 'next/headers';
import { getUser } from './demo-store';

export const DEMO_COOKIE = 'demo_user_id';

export function demoMode() {
  return process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

export function demoCurrentUser() {
  const id = cookies().get(DEMO_COOKIE)?.value;
  if (!id) return null;
  return getUser(id);
}
