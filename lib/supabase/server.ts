import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseServer() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => jar.get(n)?.value,
        set: (n: string, v: string, o: CookieOptions) => {
          try { jar.set({ name: n, value: v, ...o }); } catch { /* server component read-only */ }
        },
        remove: (n: string, o: CookieOptions) => {
          try { jar.set({ name: n, value: '', ...o }); } catch {}
        },
      },
    }
  );
}
