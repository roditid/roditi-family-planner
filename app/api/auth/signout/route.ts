import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode, DEMO_COOKIE } from '@/lib/demo-session';

export async function POST() {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
  if (demoMode()) {
    cookies().delete(DEMO_COOKIE);
    return NextResponse.redirect(new URL('/', base), { status: 303 });
  }
  const sb = supabaseServer();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL('/', base), { status: 303 });
}
