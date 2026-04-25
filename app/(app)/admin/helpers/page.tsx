import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { allUsers } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';

export default async function HelpersAdmin() {
  const ctx = await requireAdmin();
  let members: any[] = [];
  if (demoMode()) {
    members = allUsers().map((p) => ({ role: p.role, helper_kind: p.helper_kind, profiles: p }));
  } else {
    const sb = supabaseServer();
    const { data } = await sb
      .from('household_members')
      .select('role, helper_kind, profiles:user_id(*)')
      .eq('household_id', ctx.household!.id);
    members = data ?? [];
  }

  const admins = members.filter((m: any) => m.role === 'admin');
  const helpers = members.filter((m: any) => m.role === 'helper');

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Household members</h1>
        <p className="text-ink-700/70 mt-1">Paula and Daniel are both admins. Grandparents and the nanny are helpers.</p>
      </header>

      <Section title="Admins" subtitle="Full access to everything.">
        {admins.map((m: any) => <Row key={m.profiles.id} m={m} badge="Admin" />)}
      </Section>

      <Section title="Helpers" subtitle="Can see the week and claim pickups.">
        {helpers.map((m: any) => <Row key={m.profiles.id} m={m} badge={m.helper_kind === 'nanny' ? 'Nanny' : 'Grandparent'} />)}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl">{title}</h2>
      <p className="text-sm text-ink-700/60 mb-3">{subtitle}</p>
      <div className="card divide-y divide-black/5">{children}</div>
    </section>
  );
}

function Row({ m, badge }: { m: any; badge: string }) {
  const p = m.profiles;
  return (
    <div className="p-4 flex items-center gap-4">
      <div className="h-10 w-10 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-medium">
        {(p.full_name || 'U').slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{p.full_name}</div>
        <div className="text-sm text-ink-700/60 truncate">{p.email}</div>
      </div>
      <div className="flex gap-1.5">
        {p.email_enabled && <span className="chip bg-sage-500/10 text-sage-700 text-xs">email</span>}
        {p.sms_enabled && <span className="chip bg-sage-500/10 text-sage-700 text-xs">sms</span>}
        <span className="chip bg-black/5 text-ink-800 text-xs">{badge}</span>
      </div>
    </div>
  );
}
