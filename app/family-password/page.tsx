/**
 * Family password gate — the FIRST page anyone hits when visiting
 * roditi.ch (helper portal, login, schedule, admin all redirect here
 * until the cookie is set).
 *
 * One shared password for the whole household. Paula tells the family
 * group chat the password; everyone enters it once per device. Cookie
 * persists 30 days, then they enter it again.
 *
 * This is a thin curtain, not a vault — its job is to keep the URL out
 * of casual reach (search engines, accidental shares, screen-overs). The
 * real auth layers (per-helper magic tokens + admin password login) sit
 * inside.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const COOKIE = 'family_pwd';

async function checkPassword(formData: FormData) {
  'use server';
  const submitted = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/home');
  const expected = process.env.FAMILY_PASSWORD;
  const token = process.env.FAMILY_AUTH_TOKEN;
  if (!expected || !token) {
    redirect(next || '/home');
  }
  if (submitted !== expected) {
    redirect(`/family-password?err=1&next=${encodeURIComponent(next)}`);
  }
  cookies().set({
    name: COOKIE,
    value: token!,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  redirect(next || '/home');
}

export default function FamilyPasswordPage({
  searchParams,
}: {
  searchParams: { err?: string; next?: string };
}) {
  const failed = searchParams.err === '1';
  const next = searchParams.next ?? '/home';
  return (
    <main className="min-h-screen grid place-items-center px-5 bg-cream-100">
      <div className="card w-full max-w-md p-7 sm:p-8 text-center">
        {/* Heart-with-R lockup */}
        <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden className="mx-auto mb-4">
          <path
            d="M50 90 C 4 62, 4 20, 28 20 C 40 20, 48 28, 50 36 C 52 28, 60 20, 72 20 C 96 20, 96 62, 50 90 Z"
            fill="#5C7A5F"
          />
          <text x="50" y="68" textAnchor="middle"
            style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic' }}
            fontSize="46" fontWeight="500" fill="#FBF6EC">R</text>
        </svg>
        <h1 className="font-display text-2xl mb-1">Roditi Family Planner</h1>
        <p className="text-sm text-ink-700/65 mb-6">
          Please enter the family password to continue.
        </p>
        <form action={checkPassword} className="space-y-3 text-left">
          <input type="hidden" name="next" value={next} />
          <input
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="off"
            placeholder="Family password"
            className="input text-base text-center tracking-wide"
          />
          {failed && (
            <div className="text-sm text-coral-600 text-center">That doesn't match. Try again.</div>
          )}
          <button type="submit" className="btn-primary w-full py-3">
            Continue
          </button>
        </form>
        <p className="text-xs text-ink-700/45 mt-6 leading-relaxed">
          Paula or Dani can share the password with you. Once you enter it on this device, you'll stay in for 30 days.
        </p>
      </div>
    </main>
  );
}
