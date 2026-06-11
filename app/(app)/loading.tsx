/**
 * Instant loading skeleton for every authenticated page. Renders the
 * moment navigation starts, while the server components fetch slots /
 * profile / helpers. Mirrors the /home layout shape (header portrait +
 * greeting, toolbar, day sections with chips) so the real content
 * replaces it without a jarring reflow.
 *
 * This is the single biggest perceived-speed win: pages used to show
 * nothing until every Supabase round-trip finished.
 */
export default function AppLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {/* Header: portrait + greeting */}
      <div className="px-1 flex items-center gap-4 sm:gap-5">
        <div className="skeleton w-[88px] h-[112px] rounded-2xl shrink-0" />
        <div className="space-y-2.5 flex-1">
          <div className="skeleton h-9 w-48 max-w-full" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
      </div>

      {/* Toolbar strip */}
      <div className="flex items-center justify-between gap-3 py-2">
        <div className="skeleton h-10 w-44 rounded-xl" />
        <div className="skeleton h-9 w-40 rounded-lg" />
      </div>

      {/* Two day sections with slot chips */}
      {[0, 1].map((day) => (
        <section key={day} className="space-y-2">
          <div className="flex items-baseline gap-3 px-1 pt-2">
            <div className="skeleton h-7 w-40" />
            <div className="skeleton h-5 w-16 rounded-full" />
          </div>
          {[0, 1].map((chip) => (
            <div key={chip} className="card p-3 flex gap-3 items-stretch">
              <div className="skeleton w-[88px] min-h-[120px] rounded-xl shrink-0" />
              <div className="flex-1 space-y-2.5 py-1">
                <div className="skeleton h-7 w-24" />
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-6 w-36" />
                <div className="skeleton h-4 w-full max-w-[260px]" />
                <div className="skeleton h-4 w-full max-w-[220px]" />
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
