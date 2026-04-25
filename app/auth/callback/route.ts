import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Magic-link / OAuth callback. Exchanges the code for a session and ensures
 * the session cookies land on the redirect response that goes back to the
 * browser. The naive pattern of using `cookies()` from next/headers breaks
 * here because mutations to that jar aren't propagated onto the redirect we
 * return — so we attach cookies to the response object directly.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/my-pickups';
  const errParam = url.searchParams.get('error_description') || url.searchParams.get('error');

  // Bail early on OAuth errors (user denied, provider rejected, etc.)
  if (errParam && !code) {
    const target = new URL('/login', url.origin);
    target.searchParams.set('err', errParam);
    return NextResponse.redirect(target);
  }

  const res = NextResponse.redirect(new URL(next, url.origin));

  if (code) {
    const sb = createServerClient(
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
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      const target = new URL('/login', url.origin);
      target.searchParams.set('err', error.message);
      return NextResponse.redirect(target);
    }
  }

  return res;
}
