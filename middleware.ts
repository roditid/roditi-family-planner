import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/my-pickups', '/pickups', '/admin'];
const DEMO_COOKIE = 'demo_user_id';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

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
        get: (n) => req.cookies.get(n)?.value,
        set: (n, v, o: CookieOptions) => { res.cookies.set({ name: n, value: v, ...o }); },
        remove: (n, o: CookieOptions) => { res.cookies.set({ name: n, value: '', ...o }); },
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
  matcher: ['/((?!_next/|favicon|api/cron|api/calendar/connect/callback).*)'],
};
