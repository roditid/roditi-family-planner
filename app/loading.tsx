/**
 * Root loading state — covers the landing page and any route outside
 * the authenticated (app) group. A centered brand mark with a gentle
 * pulse; deliberately minimal since these routes resolve fast.
 */
export default function RootLoading() {
  return (
    <main className="min-h-screen grid place-items-center" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col items-center gap-3 animate-pulse">
        <svg viewBox="0 0 100 100" width="64" height="64" aria-hidden>
          <path
            d="M50 90 C 4 62, 4 20, 28 20 C 40 20, 48 28, 50 36 C 52 28, 60 20, 72 20 C 96 20, 96 62, 50 90 Z"
            fill="#5C7A5F"
            opacity="0.55"
          />
          <text x="50" y="68" textAnchor="middle"
            style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic' }}
            fontSize="46" fontWeight="500" fill="#FBF6EC">R</text>
        </svg>
        <div className="text-xs uppercase tracking-[0.2em] text-ink-700/45 font-semibold">Loading…</div>
      </div>
    </main>
  );
}
