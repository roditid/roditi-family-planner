import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { allUsers } from '@/lib/demo-store';
import CopyLink from '@/components/CopyLink';
import { sendInvitesNowAction } from '@/app/_actions/invites';

export const dynamic = 'force-dynamic';

export default async function InvitesAdmin() {
  const ctx = await requireAdmin();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

  type Row = { id: string; full_name: string; email: string | null; helper_kind: string | null; magic_token: string | null; last_invite_sent_at: string | null };
  let helpers: Row[] = [];
  if (demoMode()) {
    helpers = allUsers()
      .filter((u) => u.role === 'helper')
      .map((u: any) => ({
        id: u.id, full_name: u.full_name, email: u.email, helper_kind: u.helper_kind,
        magic_token: u.magic_token, last_invite_sent_at: null,
      }));
  } else {
    const sb = supabaseServer();
    const { data } = await sb
      .from('household_members')
      .select('helper_kind, profiles:user_id(id, full_name, email, magic_token, last_invite_sent_at)')
      .eq('household_id', ctx.household!.id)
      .eq('role', 'helper');
    helpers = (data ?? []).map((m: any) => ({ ...m.profiles, helper_kind: m.helper_kind })) as Row[];
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Personal links</h1>
        <p className="text-ink-700/70 mt-1">
          Each helper has their own bookmark-able URL. We email them a fresh
          link every Saturday morning so they remember to plan the week.
        </p>
      </header>

      <div className="card p-5 flex items-center gap-3 justify-between flex-wrap">
        <div>
          <div className="font-medium">Send everyone their weekly link now</div>
          <div className="text-sm text-ink-700/60">Grandparents only. Useful for ad-hoc resends.</div>
        </div>
        <form action={sendInvitesNowAction}>
          <button className="btn-soft text-sm">Send invites</button>
        </form>
      </div>


      <div className="card divide-y divide-black/5">
        {helpers.map((h) => {
          const url = h.magic_token ? `${baseUrl}/i/${h.magic_token}` : null;
          return (
            <div key={h.id} className="p-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
              <div className="h-10 w-10 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-medium">
                {(h.full_name || 'U').slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{h.full_name}</span>
                  <span className="chip bg-black/5 text-ink-800 text-xs">
                    {h.helper_kind === 'nanny' ? 'Nanny' : 'Grandparent'}
                  </span>
                </div>
                <div className="text-sm text-ink-700/60 truncate">{h.email}</div>
                {url ? (
                  <code className="text-xs text-ink-700/50 truncate block max-w-md mt-1">{url}</code>
                ) : (
                  <span className="text-xs text-coral-600">No token yet</span>
                )}
              </div>
              <div className="flex gap-2">
                {url && <CopyLink url={url} />}
                {url && <a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-3 py-1.5">Open ↗</a>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-ink-700/50">
        Tokens are reusable — share these once and helpers can bookmark or "Add to Home Screen". The Saturday email just nudges them to plan.
      </p>
      <Link href="/admin" className="text-sm text-sage-600 hover:underline">← Back to overview</Link>
    </div>
  );
}
