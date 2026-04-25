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

/**
 * Send the weekly invite to helpers. By default targets grandparents only —
 * Liezel and the parents fill the gaps via /admin/unassigned, they don't
 * need a "claim what you want" prompt.
 *
 * Pass `{ kinds: ['grandparent', 'nanny', 'other'] }` to widen the audience
 * for the manual "Send invites now" admin button.
 */
export async function sendInvitesForHousehold(
  householdId: string,
  options: { kinds?: string[] } = {}
) {
  const kinds = options.kinds ?? ['grandparent']; // Saturday-cron default
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

  // Filter to the requested helper kinds
  helpers = helpers.filter((h) => kinds.includes(h.helper_kind ?? 'other'));

  const sent: { to: string; ok: boolean }[] = [];
  for (const h of helpers) {
    if (!h.email || !h.magic_token) continue;
    const url = `${baseUrl}/i/${h.magic_token}`;
    const subject = `${firstName(h.full_name)} — pickups for this week`;
    const body = [
      `Hi ${firstName(h.full_name)},`,
      ``,
      `Here are next week's pickups. Tap your link to see what's on and claim any you can do:`,
      ``,
      url,
      ``,
      `Whatever you don't claim, Paula and Liezel will pick up. Thanks for being there.`,
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
