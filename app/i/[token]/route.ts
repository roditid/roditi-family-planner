/**
 * Magic-link entry. Each caretaker has their own personal token.
 * Hitting /i/<token>:
 *   1. Looks up the profile by token
 *   2. Sets a session cookie
 *   3. Redirects to /my-pickups
 *
 * The token is reusable (it's their personal sign-in link, not a one-time
 * password). They can bookmark the URL. Saturday's email is just a
 * reminder containing this same link.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { demoMode, DEMO_COOKIE } from '@/lib/demo-session';
import { findUserByToken } from '@/lib/demo-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Single-use magic-link must be regenerated every visit (no caching).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  if (demoMode()) {
    const u = findUserByToken(token);
    if (!u) return NextResponse.redirect(new URL('/?invalid_token=1', base));
    cookies().set(DEMO_COOKIE, u.id, {
      path: '/', maxAge: 60 * 60 * 24 * 90, sameSite: 'lax', httpOnly: true,
    });
    return NextResponse.redirect(new URL('/my-pickups', base));
  }

  // Real mode: look up the profile, then issue a Supabase session via the
  // magic-link admin API. Because Supabase auth requires its own session,
  // we use the admin generateLink('magiclink') flow under the hood.
  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from('profiles')
    .select('id, email')
    .eq('magic_token', token)
    .maybeSingle();
  if (!profile?.email) return NextResponse.redirect(new URL('/?invalid_token=1', base));

  const { data: link, error } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
    options: { redirectTo: `${base}/auth/callback?next=/my-pickups` },
  });
  if (error || !link?.properties?.action_link) {
    return NextResponse.redirect(new URL('/?invalid_token=1', base));
  }
  // Hop straight to Supabase's hosted exchange — no email needed since the
  // user already proved possession of the token by clicking our short link.
  return NextResponse.redirect(link.properties.action_link);
}
