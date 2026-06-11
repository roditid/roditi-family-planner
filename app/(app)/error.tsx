'use client';
/**
 * Error boundary for the authenticated (app) group.
 *
 * Two personalities:
 *   • Auth errors (requireAuth/requireAdmin threw UNAUTHORIZED or
 *     FORBIDDEN — usually an expired session) → "session expired" card
 *     with a sign-in button. Before this existed, an expired session
 *     showed Next's raw "Application error: a server-side exception
 *     has occurred" screen, which terrified the grandparents.
 *   • Everything else → friendly retry card with the error digest for
 *     debugging.
 */
import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error boundary:', error);
  }, [error]);

  const isAuthError = /UNAUTHORIZED|FORBIDDEN/i.test(error.message ?? '');

  if (isAuthError) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-5">
        <div className="card w-full max-w-md p-7 text-center">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="font-display text-2xl mb-2">Your session expired</h1>
          <p className="text-sm text-ink-700/65 mb-6 leading-relaxed">
            It's been a while — please sign in again. Helpers can tap their
            name on the home page; parents sign in with their password.
          </p>
          <a href="/" className="btn-primary w-full py-3 inline-flex">
            Back to the home page
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] grid place-items-center px-5">
      <div className="card w-full max-w-md p-7 text-center">
        <div className="text-4xl mb-3">🌧️</div>
        <h1 className="font-display text-2xl mb-2">Something went wrong</h1>
        <p className="text-sm text-ink-700/65 mb-6 leading-relaxed">
          Not your fault — a hiccup on our side. Try again; if it keeps
          happening, tell Dani.
        </p>
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="btn-primary px-6 py-3">
            Try again
          </button>
          <a href="/home" className="btn-ghost px-6 py-3">
            Go home
          </a>
        </div>
        {error.digest && (
          <p className="text-[10px] text-ink-700/35 mt-5 tabular-nums">
            Error code: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
