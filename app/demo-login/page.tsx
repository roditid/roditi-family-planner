import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { allUsers } from '@/lib/demo-store';
import { DEMO_COOKIE, demoMode } from '@/lib/demo-session';

export const dynamic = 'force-dynamic';

async function pickUser(formData: FormData) {
  'use server';
  const id = String(formData.get('user_id') ?? '');
  if (!id) return;
  cookies().set(DEMO_COOKIE, id, { path: '/', maxAge: 60 * 60 * 24 * 30 });
  redirect('/my-pickups');
}

async function signOut() {
  'use server';
  cookies().delete(DEMO_COOKIE);
  redirect('/');
}

export default function DemoLogin() {
  if (!demoMode()) redirect('/login');
  const users = allUsers() as any[];
  const admins = users.filter((u) => u.role === 'admin');
  const helpers = users.filter((u) => u.role === 'helper');

  return (
    <main className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-sage-500 grid place-items-center text-cream-50 font-display text-xl">P</div>
          <div>
            <div className="font-display text-xl leading-none">Pickup Planner</div>
            <div className="text-xs text-ink-700/60 mt-0.5">Demo — sign in as anyone in the family</div>
          </div>
        </div>

        <div className="card p-6 mb-4">
          <div className="label mb-3">Admins (parents)</div>
          <UserGrid users={admins} action={pickUser} />
        </div>

        <div className="card p-6">
          <div className="label mb-3">Helpers — pick to sign in, or copy their personal link</div>
          <p className="text-sm text-ink-700/60 mb-4">
            In production, each helper just clicks their personal link from a Saturday email. Below is the same flow — try it via the <b>↗ link</b>.
          </p>
          <UserGrid users={helpers} action={pickUser} />
          <div className="mt-5 pt-4 border-t border-black/5 space-y-1.5 text-xs text-ink-700/60">
            {helpers.map((h) => (
              <div key={h.id} className="flex items-center gap-2">
                <span className="font-medium text-ink-700/80 min-w-[120px]">{h.full_name}</span>
                <Link href={`/i/${h.magic_token}`} className="text-sage-600 hover:underline truncate">
                  /i/{h.magic_token}
                </Link>
              </div>
            ))}
          </div>
        </div>

        <form action={signOut} className="mt-4 text-center">
          <button className="text-sm text-ink-700/50 underline underline-offset-2">Clear demo session</button>
        </form>

        <p className="text-xs text-ink-700/50 text-center mt-6">
          This is a local demo running on in-memory data. State resets when the dev server restarts.
        </p>
      </div>
    </main>
  );
}

function UserGrid({ users, action }: { users: any[]; action: (fd: FormData) => void }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {users.map((u) => (
        <form key={u.id} action={action}>
          <input type="hidden" name="user_id" value={u.id} />
          <button
            type="submit"
            className="w-full text-left rounded-xl border border-black/10 px-4 py-3 hover:bg-sage-500/5 hover:border-sage-500/30 transition flex items-center gap-3"
          >
            <div className="h-9 w-9 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-medium">
              {(u.full_name || 'U').slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{u.full_name}</div>
              <div className="text-xs text-ink-700/60 truncate">{labelFor(u)}</div>
            </div>
          </button>
        </form>
      ))}
    </div>
  );
}

function labelFor(u: any) {
  if (u.role === 'admin') return 'Admin';
  if (u.helper_kind === 'nanny') return 'Nanny';
  return 'Grandparent';
}
