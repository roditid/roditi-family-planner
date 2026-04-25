import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/permissions';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/calendar', label: 'Calendar' },
  { href: '/admin/children', label: 'Children' },
  { href: '/admin/locations', label: 'Locations' },
  { href: '/admin/helpers', label: 'Helpers' },
  { href: '/admin/reminders', label: 'Reminders' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (ctx?.role !== 'admin') redirect('/my-pickups');
  return (
    <div>
      <div className="mb-6 border-b border-black/5 overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="px-3 py-2 text-sm rounded-lg hover:bg-black/5">
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
