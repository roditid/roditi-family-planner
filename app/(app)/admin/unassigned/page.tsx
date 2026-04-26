/**
 * Admin: unassigned pickups dashboard.
 *
 * Use case (Sunday morning ritual): Paula opens this page from a WhatsApp
 * link and sees every pickup in the next 4 weeks that no helper has claimed.
 * She bulk-assigns them — typically alternating Liezel and herself for the
 * Gan→Home defaults — and Liezel later gets a weekly summary.
 *
 * The page is intentionally dense: one row per slot, the assignment dropdown
 * inline so a few taps clears the whole list.
 */
import { addDays, format } from 'date-fns';
import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchSlots } from '@/lib/slots';
import { prettyDay, prettyTime } from '@/lib/week';
import AssignmentPicker from '@/components/AssignmentPicker';
import { buildWeeklySummaryForUser } from '@/lib/summaries';

export const dynamic = 'force-dynamic';

export default async function UnassignedPickupsPage() {
  const ctx = await requireAdmin();
  const sb = supabaseServer();

  const today = new Date();
  const startISO = format(today, 'yyyy-MM-dd');
  const endISO = format(addDays(today, 28), 'yyyy-MM-dd');

  const slots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);
  const unassigned = slots
    .filter((s) => s.status === 'unclaimed')
    .sort((a, b) => (a.date + a.pickup_time).localeCompare(b.date + b.pickup_time));

  // Build the helper list (admins + helpers)
  const { data: members } = await sb
    .from('household_members')
    .select('helper_kind, role, profiles:user_id(id, full_name)')
    .eq('household_id', ctx.household!.id);
  const helpers = (members ?? []).map((m: any) => ({
    id: m.profiles.id,
    full_name: m.profiles.full_name,
    helper_kind: m.helper_kind,
    role: m.role,
  }));
  const ROLE_ORDER: Record<string, number> = { admin: 0, grandparent: 1, nanny: 2, other: 3 };
  helpers.sort((a, b) => {
    const ka = a.role === 'admin' ? 0 : ROLE_ORDER[a.helper_kind ?? 'other'] ?? 3;
    const kb = b.role === 'admin' ? 0 : ROLE_ORDER[b.helper_kind ?? 'other'] ?? 3;
    return ka - kb || a.full_name.localeCompare(b.full_name);
  });

  // Group unassigned by date for easier scanning
  const byDate = new Map<string, typeof unassigned>();
  for (const s of unassigned) {
    if (!byDate.has(s.date)) byDate.set(s.date, [] as any);
    byDate.get(s.date)!.push(s);
  }

  // Pre-build Liezel's weekly summary so the WhatsApp button can hand-off
  // a fully-formed message to wa.me (no Twilio required). Looks her up by
  // helper_kind='nanny' inside this household.
  const liezel = (members ?? [])
    .map((m: any) => m.profiles)
    .find((p: any) => p && (p.full_name ?? '').toLowerCase().startsWith('liezel'));
  const liezelPhone = (liezel?.phone_number ?? '').replace(/[^\d]/g, '');
  let liezelMessage = '';
  if (liezel) {
    const { body } = await buildWeeklySummaryForUser(sb, ctx.household!.id, liezel.id, (liezel.full_name ?? 'Liezel').split(' ')[0]);
    liezelMessage = body;
  }
  const liezelWaHref = liezelPhone && liezelMessage
    ? `https://wa.me/${liezelPhone}?text=${encodeURIComponent(liezelMessage)}`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Unassigned pickups</h1>
          <p className="text-ink-700/70 mt-1 text-sm">
            {unassigned.length === 0
              ? 'Every pickup in the next 4 weeks has a helper. Nice.'
              : `${unassigned.length} pickup${unassigned.length === 1 ? '' : 's'} in the next 4 weeks need a helper. Assign Liezel or yourself.`}
          </p>
        </div>
        <Link href="/admin" className="text-sm text-sage-700 hover:underline">← Admin</Link>
      </div>

      {/* Hand-off to Liezel via WhatsApp — no automation, just a tap-and-send
          link that opens WhatsApp pre-filled with her current weekly summary.
          Replaces the auto-Liezel-email until we wire up Twilio. */}
      {liezelWaHref && (
        <a
          href={liezelWaHref}
          target="_blank" rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-2xl bg-[#25D366] hover:bg-[#1ebe57] text-white px-4 py-3.5 transition active:scale-[0.99]"
        >
          <div className="leading-tight">
            <div className="font-semibold">Send Liezel her weekly summary on WhatsApp</div>
            <div className="text-xs opacity-90 mt-0.5">Opens WhatsApp with the full list pre-filled — tap send.</div>
          </div>
          <span className="text-xl">→</span>
        </a>
      )}

      {unassigned.length === 0 ? (
        <div className="rounded-2xl bg-cream-200/40 p-8 text-center">
          <div className="text-4xl mb-2">🌿</div>
          <div className="font-display text-lg">All quiet. Nothing to assign.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(byDate.entries()).map(([date, list]) => (
            <section key={date}>
              <h2 className="font-display text-lg sm:text-xl mb-2 px-1">{prettyDay(new Date(date + 'T00:00:00'))}</h2>
              <div className="space-y-1.5">
                {list.map((s) => {
                  const allKids = [s.child, ...(s.additional_children ?? [])];
                  return (
                    <div key={s.id} className="card p-3 flex items-center gap-3 flex-wrap">
                      <div className="font-display tabular-nums text-lg w-14 shrink-0">{prettyTime(s.pickup_time)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.12em] font-bold flex flex-wrap gap-x-1.5">
                          {allKids.map((k, i) => (
                            <span key={k.id} style={{ color: k.color }}>
                              {k.name}{i < allKids.length - 1 && <span className="text-ink-700/40"> →</span>}
                            </span>
                          ))}
                        </div>
                        <div className="text-sm leading-tight font-medium">{s.title}</div>
                        {s.pickup_location && (
                          <div className="text-xs text-ink-700/55 truncate">
                            from {s.pickup_location.label}
                            {s.via_location && ` → ${s.via_location.label}`}
                          </div>
                        )}
                      </div>
                      <AssignmentPicker
                        slotId={s.id}
                        currentUserId={s.assignment?.assigned_to_user_id ?? null}
                        helpers={helpers}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
