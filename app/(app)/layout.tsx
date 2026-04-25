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
          <Link href={isAdmin ? '/admin' : '/my-pickups'} className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-sage-500 grid place-items-center text-cream-50 font-display">P</div>
            <span className="font-display text-base">Pickup Planner</span>
          </Link>
          <nav className="flex items-center gap-0.5 text-sm">
            {isAdmin && <NavLink href="/admin">Dashboard</NavLink>}
            <NavLink href="/my-pickups">{isAdmin ? 'My pickups' : 'Pickups'}</NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-3 sm:px-5 py-4 md:py-8">{children}</main>
      <footer className="border-t border-black/5 py-6 text-center text-xs text-ink-700/50">
        {ctx.household.name} · signed in as {ctx.profile?.full_name}{' '}
        {isAdmin && <span className="chip bg-sage-500/10 text-sage-700 ml-1">Admin</span>}
        {' · '}
        <form action="/api/auth/signout" method="post" className="inline">
          <button className="underline underline-offset-2">Sign out</button>
        </form>
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
