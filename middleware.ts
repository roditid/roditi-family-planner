import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/my-pickups', '/home', '/pickups', '/admin'];
const DEMO_COOKIE = 'demo_user_id';

// Family password gate — shared password EVERYONE enters once before they
// see any page (login, helper portal, schedule, admin, etc.). Cookie is
// remembered 30 days per device. Set FAMILY_PASSWORD + FAMILY_AUTH_TOKEN
// env vars in Vercel; if FAMILY_PASSWORD is unset, the gate is disabled
// (useful for local dev).
const FAMILY_PWD_COOKIE = 'family_pwd';
// Paths that bypass the family password gate. Note: this is route-name
// based, NOT folder-name. Any path with a file extension (kid photos,
// favicons, manifest icons) is also treated as public so the family-
// password page itself can render its own assets without recursion.
const PUBLIC_PATHS_FOR_GATE = [
  '/family-password',
  '/_next',
  '/api/calendar/webhook', // Google's webhook POSTs (no cookie possible)
  '/api/cron',             // CRON_SECRET-gated, has its own auth
  '/auth/callback',        // OAuth callbacks (no cookie yet)
];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Forward the pathname as a request header so server components can read
  // it via next/headers (NextPickupBanner uses this to skip its CTA when
  // the user is already on /my-pickups).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', path);
  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // ── Family password gate (runs FIRST, before auth)
  const familyPassword = process.env.FAMILY_PASSWORD;
  const familyToken = process.env.FAMILY_AUTH_TOKEN;
  const gateEnabled = !!(familyPassword && familyToken);
  if (gateEnabled) {
    const matchesPublicPath = PUBLIC_PATHS_FOR_GATE.some((p) => path === p || path.startsWith(p + '/'));
    // Static-asset heuristic: any path whose last segment has a file
    // extension (foo.jpg, manifest.webmanifest, icon-256.png). Lets
    // /kids/yali.jpg and /helpers/vovo.jpg through without a cookie,
    // while /helpers (the route) still hits the gate.
    const looksLikeStaticAsset = /\.[a-z0-9]+$/i.test(path);
    const isPublic = matchesPublicPath || looksLikeStaticAsset;
    const cookieOk = req.cookies.get(FAMILY_PWD_COOKIE)?.value === familyToken;
    if (!isPublic && !cookieOk) {
      const url = req.nextUrl.clone();
      url.pathname = '/family-password';
      url.searchParams.set('next', path + (req.nextUrl.search || ''));
      return NextResponse.redirect(url);
    }
  }

  // Demo mode: gate on the demo cookie; redirect to /demo-login if absent.
  if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    if (PROTECTED.some((p) => path.startsWith(p)) && !req.cookies.get(DEMO_COOKIE)) {
      const url = req.nextUrl.clone();
      url.pathname = '/demo-login';
      return NextResponse.redirect(url);
    }
    return res;
  }

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => req.cookies.get(n)?.value,
        set: (n: string, v: string, o: CookieOptions) => { res.cookies.set({ name: n, value: v, ...o }); },
        remove: (n: string, o: CookieOptions) => { res.cookies.set({ name: n, value: '', ...o }); },
      },
    }
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/|favicon|api/cron|api/calendar/connect/callback|auth/callback).*)'],
};
