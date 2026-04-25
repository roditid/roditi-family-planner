/**
 * Friendly personal-link route. /vovo, /dani, /liezel etc.
 *
 * Sets up a fully-authenticated Supabase session SERVER-SIDE in one
 * round-trip — no email click, no hash-fragment dance. Walking through:
 *
 *   1. Look up the profile by slug (admin client, bypasses RLS)
 *   2. admin.generateLink({type:'magiclink'}) → returns `hashed_token`
 *   3. Pass that token to ssr-client.verifyOtp({token_hash, type:'magiclink'})
 *      which returns a session + WRITES cookies onto our response object
 *   4. Redirect to /my-pickups (or /admin for parents) with the session live
 *
 * The user clicks /vovo → server does everything → user lands on the
 * calendar already signed in. Zero friction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode, DEMO_COOKIE } from '@/lib/demo-session';
import { allUsers } from '@/lib/demo-store';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RESERVED = new Set([
  'admin', 'login', 'api', 'auth', 'i', 'my-pickups', 'pickups',
  'demo-login', 'manifest.json', 'manifest.webmanifest', 'icon', 'apple-icon',
  'favicon.ico', 'robots.txt', 'sitemap.xml', '_next',
]);

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug.toLowerCase();
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  if (RESERVED.has(slug)) {
    return NextResponse.redirect(new URL('/', base));
  }

  // Demo mode: cookie-based session, no Supabase round-trip.
  if (demoMode()) {
    const u = allUsers().find((x: any) => slugify(x.full_name) === slug || x.magic_token === slug);
    if (!u) return NextResponse.redirect(new URL(`/?invalid_slug=${slug}`, base));
    cookies().set(DEMO_COOKIE, u.id, {
      path: '/', maxAge: 60 * 60 * 24 * 90, sameSite: 'lax', httpOnly: true,
    });
    return NextResponse.redirect(new URL('/my-pickups', base));
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, magic_token, role')
    .eq('magic_slug', slug)
    .maybeSingle();

  if (!profile?.email) {
    return NextResponse.redirect(new URL('/?invalid_slug=' + encodeURIComponent(slug), base));
  }

  // Generate a magic-link to get its hashed_token, then immediately verify
  // it server-side — that gives us a real session whose cookies we attach
  // to the redirect response.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.redirect(new URL('/?invalid_slug=' + encodeURIComponent(slug), base));
  }

  // Determine landing page by role.
  let next = '/my-pickups';
  if (profile.role === 'admin') next = '/admin';

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
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyErr) {
    return NextResponse.redirect(new URL('/?invalid_slug=' + encodeURIComponent(slug) + '&v=' + encodeURIComponent(verifyErr.message), base));
  }

  return res;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
}
