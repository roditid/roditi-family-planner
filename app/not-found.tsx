/**
 * Branded 404 — replaces Next's stark default. Most likely ways to land
 * here: a mistyped helper slug (roditi.ch/tatia instead of /tataia) or
 * a stale link. Offer the way home.
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center px-5">
      <div className="card w-full max-w-md p-7 sm:p-8 text-center">
        <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden className="mx-auto mb-4 opacity-70">
          <path
            d="M50 90 C 4 62, 4 20, 28 20 C 40 20, 48 28, 50 36 C 52 28, 60 20, 72 20 C 96 20, 96 62, 50 90 Z"
            fill="#5C7A5F"
          />
          <text x="50" y="68" textAnchor="middle"
            style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic' }}
            fontSize="46" fontWeight="500" fill="#FBF6EC">R</text>
        </svg>
        <h1 className="font-display text-2xl mb-2">This page doesn't exist</h1>
        <p className="text-sm text-ink-700/65 mb-6 leading-relaxed">
          Check the link for typos — helper links look like{' '}
          <code className="bg-black/5 px-1.5 py-0.5 rounded text-xs">roditi.ch/nonna</code>.
          Or head back to the start.
        </p>
        <Link href="/" className="btn-primary w-full py-3 inline-flex">
          Back to the home page
        </Link>
      </div>
    </main>
  );
}
