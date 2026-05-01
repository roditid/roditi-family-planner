import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/permissions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) redirect('/login');
  if (!ctx.household) redirect('/login?err=no-household');
  const isAdmin = ctx.role === 'admin';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-black/5 bg-cream-50/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-3 sm:px-5 h-14 flex items-center gap-2 justify-between">
          <Link href={isAdmin ? '/admin' : '/home'} className="flex items-center gap-2.5">
            {/* Heart-with-R lockup — a small sage heart cradling a cream serif R. */}
            <svg viewBox="0 0 100 100" width="32" height="32" aria-hidden className="shrink-0">
              <path
                d="M50 90 C 4 62, 4 20, 28 20 C 40 20, 48 28, 50 36 C 52 28, 60 20, 72 20 C 96 20, 96 62, 50 90 Z"
                fill="#5C7A5F"
              />
              <text x="50" y="68" textAnchor="middle"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic' }}
                fontSize="46" fontWeight="500" fill="#FBF6EC">R</text>
            </svg>
            <div className="leading-tight">
              <div className="font-display text-base sm:text-[17px] tracking-tight leading-none">Roditi</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-ink-700/55 font-semibold leading-none mt-0.5">Family Planner</div>
            </div>
          </Link>
          <nav className="flex items-center gap-0.5 text-sm">
            <NavLink href="/home">Home</NavLink>
            {isAdmin && <NavLink href="/admin/calendar">Settings</NavLink>}
            <NavLink href="/my-pickups/mine">My pickups</NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-3 sm:px-5 py-4 md:py-8">{children}</main>
      <footer className="border-t border-black/5 py-5 mt-8">
        <div className="mx-auto max-w-7xl px-3 sm:px-5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="text-ink-700/50">
            <span className="font-medium text-ink-700/65">{ctx.household.name}</span>
            <span className="opacity-60"> · {ctx.profile?.full_name}</span>
            {isAdmin && <span className="ml-2 chip bg-sage-500/10 text-sage-700 text-[10px] px-2 py-0.5">Admin</span>}
          </div>
          <form action="/api/auth/signout" method="post">
            <button className="text-ink-700/50 hover:text-ink-900 underline underline-offset-2">Sign out</button>
          </form>
        </div>
      </footer>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-lg hover:bg-black/5 text-ink-800"
    >
      {children}
    </Link>
  );
}

