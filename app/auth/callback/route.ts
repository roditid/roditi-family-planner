import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Magic-link / OAuth callback. Exchanges the code for a session and routes
 * the user to their role-appropriate landing page.
 *
 * Cookies set during exchangeCodeForSession need to land on the redirect
 * RESPONSE object, not Next's internal cookie jar — naive use of
 * `cookies()` from next/headers would silently drop them.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const explicitNext = url.searchParams.get('next');
  const errParam = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (errParam && !code) {
    const target = new URL('/login', url.origin);
    target.searchParams.set('err', errParam);
    return NextResponse.redirect(target);
  }

  // We rebuild the redirect URL after we know the user's role; for now,
  // attach cookies to a placeholder that we'll redirect from.
  const res = NextResponse.next();

  if (!code) {
    return NextResponse.redirect(new URL(explicitNext ?? '/my-pickups', url.origin));
  }

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

  const { data: session, error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    const target = new URL('/login', url.origin);
    target.searchParams.set('err', error.message);
    return NextResponse.redirect(target);
  }

  // Pick landing page by role unless caller specified `next`.
  let next = explicitNext;
  if (!next && session?.user?.id) {
    const { data: m } = await sb.from('household_members').select('role').eq('user_id', session.user.id).maybeSingle();
    next = m?.role === 'admin' ? '/admin' : '/my-pickups';
  }
  next ??= '/my-pickups';

  // Build the final redirect, copying the session cookies we just set.
  const final = NextResponse.redirect(new URL(next, url.origin));
  res.cookies.getAll().forEach((c) => final.cookies.set(c));
  return final;
}
