'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// Set NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true after configuring Google in
// Supabase Auth → Providers AND adding the supabase callback to your Google
// Cloud OAuth client. Until then we hide the button — clicking it returns 400.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

export default function LoginPage() {
  // useSearchParams forces this page out of static prerender; Suspense
  // boundary keeps Next happy at build time.
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const sb = supabaseBrowser();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [sentReset, setSentReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signInGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/home` },
    });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Hard-redirect so the server picks up the new cookies and lands the
    // user on their role-appropriate page (admins → /admin).
    window.location.href = '/home';
  }

  async function sendResetEmail() {
    if (!email) { setError('Enter your email above first.'); return; }
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
    });
    if (error) setError(error.message);
    else setSentReset(true);
    setBusy(false);
  }

  return (
    <main className="min-h-screen grid place-items-center px-5">
      <div className="card w-full max-w-md p-7 sm:p-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink-700/60 mb-6">← Back</Link>
        <h1 className="font-display text-3xl mb-2">Welcome back</h1>
        <p className="text-ink-700/70 mb-6">Sign in to see this week's pickups.</p>

        {sentReset ? (
          <div className="rounded-xl bg-sage-500/10 px-4 py-4 text-sage-700">
            <div className="font-medium mb-1">Reset email sent 📬</div>
            <div className="text-sm">
              Tap the link in the email sent to <b>{email}</b>. It'll bring you to a page where you can set a password.
            </div>
          </div>
        ) : (
          <form onSubmit={signInWithPassword} className="space-y-3">
            <label className="block">
              <span className="label mb-1.5 block">Your email</span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input text-base"
              />
            </label>

            <label className="block">
              <span className="label mb-1.5 block">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input text-base"
              />
            </label>

            <button type="submit" disabled={busy || !email || !password} className="btn-primary w-full py-3.5">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {error && <div className="text-sm text-coral-600">{error}</div>}

            <div className="pt-1">
              <button
                type="button"
                onClick={sendResetEmail}
                disabled={busy}
                className="text-sm text-ink-700/60 hover:text-ink-900 underline underline-offset-2"
              >
                Forgot password? Email me a reset link.
              </button>
            </div>

            {GOOGLE_ENABLED && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-black/10" />
                  <span className="text-xs uppercase tracking-wider text-ink-700/50">or</span>
                  <div className="flex-1 h-px bg-black/10" />
                </div>
                <button type="button" onClick={signInGoogle} disabled={busy} className="btn-soft w-full py-3">
                  <GoogleLogo /> Continue with Google
                </button>
              </>
            )}
          </form>
        )}

        <p className="text-xs text-ink-700/50 mt-7 leading-relaxed">
          First time? Tap <b>Forgot password</b> above — you'll get an email link to set one. Once you sign in on this device, you'll stay signed in. On iPhone, tap <b>Share</b> in Safari → <b>Add to Home Screen</b> for a one-tap icon.
        </p>
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden className="inline-block mr-1.5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 16.3 4 9.6 8.4 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5 0 9.5-1.9 12.9-5.1l-6-4.9c-2 1.4-4.3 2.3-6.9 2.3-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.5 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6 4.9C40.9 35.9 44 30.4 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
