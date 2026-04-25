/**
 * Token-based personal-link entry. Same approach as /[slug]/route.ts:
 * server-side generateLink + verifyOtp pair sets the session cookies in
 * one round-trip. The user lands on the calendar already signed in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { demoMode, DEMO_COOKIE } from '@/lib/demo-session';
import { findUserByToken } from '@/lib/demo-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

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

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('magic_token', token)
    .maybeSingle();
  if (!profile?.email) return NextResponse.redirect(new URL('/?invalid_token=1', base));

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return NextResponse.redirect(new URL('/?invalid_token=1', base));
  }

  const next = profile.role === 'admin' ? '/admin' : '/my-pickups';
  const res = NextResponse.redirect(new URL(next, base));
  const ssr = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => req.cookies.get(n)?.value,
        set: (n: string, v: string, o: CookieOptions) => res.cookies.set({ name: n, value: v, ...o }),
        remove: (n: string, o: CookieOptions) => res.cookies.set({ name: n, value: '', ...o }),
      },
    }
  );
  const { error: verifyErr } = await ssr.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) return NextResponse.redirect(new URL('/?invalid_token=1', base));
  return res;
}
