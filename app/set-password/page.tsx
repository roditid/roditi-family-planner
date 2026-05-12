'use client';
/**
 * Set / reset password page.
 *
 * Reached via the password-reset flow on /login: user clicks "email me
 * a reset link" → Supabase emails a magic-link → /auth/callback exchanges
 * the code for a session → redirects here. The user is already signed in
 * by the time this page loads; we just collect a new password and call
 * supabase.auth.updateUser({ password }).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw1.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw1 !== pw2) { setError('Passwords don\'t match.'); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => router.push('/home'), 1500);
  }

  return (
    <main className="min-h-screen grid place-items-center px-5">
      <div className="card w-full max-w-md p-7 sm:p-8">
        <h1 className="font-display text-3xl mb-2">Set a password</h1>
        <p className="text-ink-700/70 mb-6">
          From now on you can sign in with your email + this password instead of waiting for a magic link.
        </p>

        {done ? (
          <div className="rounded-xl bg-sage-500/10 px-4 py-4 text-sage-700">
            <div className="font-medium mb-1">All set ✓</div>
            <div className="text-sm">Redirecting you home…</div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="label mb-1.5 block flex items-center justify-between">
                <span>New password</span>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-700/55 hover:text-ink-900"
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                placeholder={showPassword ? 'Pick a strong one' : 'At least 8 characters'}
                className="input text-base"
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Confirm password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder={showPassword ? 'Type it again' : '••••••••'}
                className="input text-base"
              />
            </label>
            <button type="submit" disabled={busy} className="btn-primary w-full py-3.5">
              {busy ? 'Saving…' : 'Save password'}
            </button>
            {error && <div className="text-sm text-coral-600">{error}</div>}
          </form>
        )}
      </div>
    </main>
  );
}
