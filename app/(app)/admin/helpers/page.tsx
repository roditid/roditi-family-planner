import Link from 'next/link';
import { format } from 'date-fns';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { allUsers } from '@/lib/demo-store';
import CopyLink from '@/components/CopyLink';
import { updateHelperAction, sendOneInviteAction, regenerateTokenAction } from '@/app/_actions/members';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  full_name: string;
  email: string | null;
  helper_kind: string | null;
  magic_token: string | null;
  last_invite_sent_at: string | null;
  email_enabled: boolean;
  role: 'admin' | 'helper';
};

export default async function HelpersAdmin() {
  const ctx = await requireAdmin();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

  let members: Row[] = [];
  if (demoMode()) {
    members = allUsers().map((u: any) => ({
      id: u.id, full_name: u.full_name, email: u.email,
      helper_kind: u.helper_kind, magic_token: u.magic_token,
      last_invite_sent_at: null, email_enabled: u.email_enabled, role: u.role,
    }));
  } else {
    const sb = supabaseServer();
    const { data } = await sb
      .from('household_members')
      .select('helper_kind, role, profiles:user_id(id, full_name, email, magic_token, last_invite_sent_at, email_enabled)')
      .eq('household_id', ctx.household!.id);
    members = (data ?? []).map((m: any) => ({ ...m.profiles, helper_kind: m.helper_kind, role: m.role }));
  }

  const ROLE_ORDER: Record<string, number> = { admin: 0, grandparent: 1, nanny: 2, other: 3 };
  members.sort((a, b) => {
    const ka = a.role === 'admin' ? 0 : ROLE_ORDER[a.helper_kind ?? 'other'] ?? 3;
    const kb = b.role === 'admin' ? 0 : ROLE_ORDER[b.helper_kind ?? 'other'] ?? 3;
    return ka - kb || a.full_name.localeCompare(b.full_name);
  });

  const admins = members.filter((m) => m.role === 'admin');
  const helpers = members.filter((m) => m.role === 'helper');

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Household members</h1>
        <p className="text-ink-700/70 mt-1">
          Edit names + emails, share each helper's personal sign-in link, or regenerate a token if it's been overshared.
        </p>
      </header>

      {/* Admins */}
      <section>
        <h2 className="font-display text-xl">Parents (admins)</h2>
        <p className="text-sm text-ink-700/60 mb-3">Full access. Sign in via Google or email magic-link.</p>
        <div className="card divide-y divide-black/5">
          {admins.map((m) => <AdminRow key={m.id} m={m} />)}
        </div>
      </section>

      {/* Helpers */}
      <section>
        <h2 className="font-display text-xl">Helpers</h2>
        <p className="text-sm text-ink-700/60 mb-3">
          Each gets a personal link — they tap once and they're in (no password). Share via WhatsApp/SMS or click "Email link" once their email is real.
        </p>
        <div className="space-y-3">
          {helpers.map((h) => <HelperCard key={h.id} h={h} baseUrl={baseUrl} />)}
        </div>
      </section>

      <div className="text-xs text-ink-700/50">
        <Link href="/admin/invites" className="text-sage-600 hover:underline">Send everyone the weekly link →</Link>
      </div>
    </div>
  );
}

function AdminRow({ m }: { m: Row }) {
  return (
    <div className="p-4 flex items-center gap-4">
      <div className="h-10 w-10 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-medium">
        {(m.full_name || 'U').slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{m.full_name}</div>
        <div className="text-sm text-ink-700/60 truncate">{m.email}</div>
      </div>
      <span className="chip bg-sage-500/10 text-sage-700 text-xs">Admin</span>
    </div>
  );
}

function HelperCard({ h, baseUrl }: { h: Row; baseUrl: string }) {
  const url = h.magic_token ? `${baseUrl}/i/${h.magic_token}` : null;
  const placeholderEmail = h.email?.endsWith('@example.com') || h.email?.endsWith('@roditi.family');

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-medium text-lg shrink-0">
          {(h.full_name || 'U').slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-lg">{h.full_name}</span>
            <span className="chip bg-black/5 text-ink-800 text-xs">
              {h.helper_kind === 'nanny' ? 'Nanny' : 'Grandparent'}
            </span>
            {placeholderEmail && (
              <span className="chip bg-coral-400/15 text-coral-600 text-xs">placeholder email</span>
            )}
          </div>
          {h.last_invite_sent_at && (
            <div className="text-xs text-ink-700/50 mt-0.5">
              Last invite sent {format(new Date(h.last_invite_sent_at), 'MMM d, HH:mm')}
            </div>
          )}
        </div>
      </div>

      {/* Edit form */}
      <form action={updateHelperAction} className="grid sm:grid-cols-2 gap-3">
        <input type="hidden" name="user_id" value={h.id} />
        <label className="block">
          <span className="label mb-1.5 block">Name</span>
          <input name="full_name" defaultValue={h.full_name} className="input text-sm" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <input name="email" type="email" defaultValue={h.email ?? ''} placeholder="real@email.com" className="input text-sm" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Role</span>
          <select name="helper_kind" defaultValue={h.helper_kind ?? 'grandparent'} className="input text-sm">
            <option value="grandparent">Grandparent</option>
            <option value="nanny">Nanny</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="flex items-end justify-end">
          <button className="btn-soft text-sm">Save changes</button>
        </div>
      </form>

      {/* Personal link */}
      {url && (
        <div className="rounded-xl bg-cream-200/40 border border-black/[0.04] p-3">
          <div className="text-xs text-ink-700/60 uppercase tracking-wider mb-1">Personal sign-in link</div>
          <code className="text-xs text-ink-700/80 truncate block max-w-full mb-2">{url}</code>
          <div className="flex flex-wrap gap-2">
            <CopyLink url={url} label="Copy link" />
            <a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-xs px-3 py-1.5">Open ↗</a>
            <form action={sendOneInviteAction} className="inline-flex">
              <input type="hidden" name="user_id" value={h.id} />
              <button disabled={!!placeholderEmail} className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed" title={placeholderEmail ? 'Set a real email first' : 'Send the magic link to this email'}>
                ✉ Email link
              </button>
            </form>
            <form action={regenerateTokenAction} className="inline-flex ml-auto">
              <input type="hidden" name="user_id" value={h.id} />
              <button className="text-xs px-3 py-1.5 text-ink-700/50 hover:text-coral-600" title="Invalidate this URL and generate a fresh one">
                ⟳ Regenerate
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
