'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode } from '@/lib/demo-session';
import { allUsers, DEMO } from '@/lib/demo-store';
import { emailProvider } from '@/lib/notify';

/**
 * Send everyone their personal link by email. Used by:
 *   - the "Send now" button on /admin/invites
 *   - the Saturday cron at /api/cron/saturday-invites
 */
export async function sendInvitesNowAction() {
  const ctx = await requireAdmin();
  await sendInvitesForHousehold(ctx.household!.id);
  revalidatePath('/admin/invites');
}

export async function sendInvitesForHousehold(householdId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

  type Row = { id: string; full_name: string; email: string | null; magic_token: string | null; helper_kind?: string | null };
  let helpers: Row[] = [];

  if (demoMode()) {
    helpers = allUsers()
      .filter((u) => u.role === 'helper')
      .map((u: any) => ({ id: u.id, full_name: u.full_name, email: u.email, magic_token: u.magic_token, helper_kind: u.helper_kind }));
  } else {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('household_members')
      .select('helper_kind, profiles:user_id(id, full_name, email, magic_token)')
      .eq('household_id', householdId)
      .eq('role', 'helper');
    helpers = (data ?? []).map((m: any) => ({ ...m.profiles, helper_kind: m.helper_kind })) as Row[];
  }

  const sent: { to: string; ok: boolean }[] = [];
  for (const h of helpers) {
    if (!h.email || !h.magic_token) continue;
    const url = `${baseUrl}/i/${h.magic_token}`;
    const subject = `${firstName(h.full_name)} — your pickups for this week`;
    const body = [
      `Hi ${firstName(h.full_name)},`,
      ``,
      `Here's your personal link for this week's pickups. Tap it to see what's on, and claim any you can do:`,
      ``,
      url,
      ``,
      `(You can bookmark this — it's your link any time.)`,
      ``,
      `— The Roditi family`,
    ].join('\n');
    const r = await emailProvider.send({ to: h.email, subject, body });
    sent.push({ to: h.email, ok: !r.error });

    if (!demoMode()) {
      const sb = supabaseAdmin();
      await sb.from('profiles').update({ last_invite_sent_at: new Date().toISOString() }).eq('id', h.id);
    }
  }
  return sent;
}

function firstName(s: string) { return (s ?? '').split(' ')[0] || 'there'; }
