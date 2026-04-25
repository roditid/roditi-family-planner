/**
 * Friendly personal-link route. /vovo, /dani, /liezel etc — looks up the
 * profile by slug, generates a Supabase magic-link, redirects to it. The
 * end result: zero friction sign-in for grandparents who only need to
 * remember "roditi.ch/vovo".
 *
 * File-system routing means concrete app routes (/admin, /login, /api/*)
 * win over this catch-all, so adding new pages doesn't accidentally claim
 * anyone's slug. We also explicitly bail on a hard-coded RESERVED list to
 * avoid edge cases.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode, DEMO_COOKIE } from '@/lib/demo-session';
import { findUserByToken, allUsers } from '@/lib/demo-store';
import { cookies } from 'next/headers';

const RESERVED = new Set([
  'admin', 'login', 'api', 'auth', 'i', 'my-pickups', 'pickups',
  'demo-login', 'manifest.json', 'icon', 'apple-icon', 'favicon.ico',
  'robots.txt', 'sitemap.xml', '_next',
]);

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug.toLowerCase();
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  if (RESERVED.has(slug)) {
    return NextResponse.redirect(new URL('/', base));
  }

  if (demoMode()) {
    // Match by slug-ified first name in demo store.
    const u = allUsers().find((x: any) => slugify(x.full_name) === slug || x.magic_token === slug);
    if (!u) return NextResponse.redirect(new URL(`/?invalid_slug=${slug}`, base));
    cookies().set(DEMO_COOKIE, u.id, {
      path: '/', maxAge: 60 * 60 * 24 * 90, sameSite: 'lax', httpOnly: true,
    });
    return NextResponse.redirect(new URL('/my-pickups', base));
  }

  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, magic_token')
    .eq('magic_slug', slug)
    .maybeSingle();

  if (!profile?.email) {
    return NextResponse.redirect(new URL('/?invalid_slug=' + encodeURIComponent(slug), base));
  }

  const { data: link, error } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
    options: { redirectTo: `${base}/auth/callback?next=/my-pickups` },
  });
  if (error || !link?.properties?.action_link) {
    return NextResponse.redirect(new URL('/?invalid_slug=' + encodeURIComponent(slug), base));
  }
  return NextResponse.redirect(link.properties.action_link);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
}
