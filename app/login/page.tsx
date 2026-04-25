'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function LoginPage({ searchParams }: { searchParams: { mode?: string } }) {
  const sb = supabaseBrowser();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signInGoogle() {
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/my-pickups` },
    });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/my-pickups` },
    });
    if (error) setError(error.message);
    else setSent(true);
    setBusy(false);
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-md p-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink-700/60 mb-8">← Back</Link>
        <h1 className="font-display text-3xl mb-2">Welcome back</h1>
        <p className="text-ink-700/70 mb-8">Sign in to see this week's pickups.</p>

        <button onClick={signInGoogle} disabled={busy} className="btn-primary w-full py-4 text-base mb-3">
          <GoogleLogo /> Continue with Google
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-black/10" />
          <span className="text-xs uppercase tracking-wider text-ink-700/50">or email</span>
          <div className="flex-1 h-px bg-black/10" />
        </div>

        {sent ? (
          <div className="rounded-xl bg-sage-500/10 px-4 py-3 text-sage-700">
            Check your email for a sign-in link.
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
            />
            <button type="submit" disabled={busy || !email} className="btn-soft w-full py-3">
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {error && <div className="text-sm text-coral-600">{error}</div>}
          </form>
        )}
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 16.3 4 9.6 8.4 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5 0 9.5-1.9 12.9-5.1l-6-4.9c-2 1.4-4.3 2.3-6.9 2.3-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.5 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6 4.9C40.9 35.9 44 30.4 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
