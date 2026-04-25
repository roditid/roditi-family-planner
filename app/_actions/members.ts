'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode } from '@/lib/demo-session';
import { emailProvider } from '@/lib/notify';

/**
 * Update a helper's profile fields (email, full_name, helper_kind).
 * Only admins of the helper's household can do this.
 */
export async function updateHelperAction(formData: FormData) {
  const ctx = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (!userId) return;

  const email = strOrNull(formData.get('email'));
  const full_name = strOrNull(formData.get('full_name'));
  const helper_kind = strOrNull(formData.get('helper_kind')) as 'grandparent' | 'nanny' | 'other' | null;

  if (demoMode()) {
    revalidatePath('/admin/helpers');
    return;
  }

  const sb = supabaseAdmin();

  // Verify the user is a member of this household.
  const { data: membership } = await sb
    .from('household_members')
    .select('user_id')
    .eq('household_id', ctx.household!.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return;

  // Update profile (email_enabled goes true if a real email is set).
  const profileUpdate: Record<string, unknown> = {};
  if (email !== null) {
    profileUpdate.email = email;
    profileUpdate.email_enabled = !email.endsWith('@example.com') && !email.endsWith('@roditi.family');
  }
  if (full_name !== null) profileUpdate.full_name = full_name;
  if (helper_kind !== null) profileUpdate.helper_kind = helper_kind;

  if (Object.keys(profileUpdate).length) {
    await sb.from('profiles').update(profileUpdate).eq('id', userId);
  }

  // Update auth.users email too (keeps things in sync, allows magic-link sign-in
  // for admins later if we promote the helper).
  if (email) {
    await sb.auth.admin.updateUserById(userId, { email, email_confirm: true });
  }

  // Update household_members.helper_kind too (it's stored in both places).
  if (helper_kind !== null) {
    await sb.from('household_members').update({ helper_kind }).eq('user_id', userId).eq('household_id', ctx.household!.id);
  }

  revalidatePath('/admin/helpers');
  revalidatePath('/admin/invites');
}

/**
 * Send the personal-link invite email to a single helper. Useful when an
 * admin updates a helper's email and wants to ping them right away.
 */
export async function sendOneInviteAction(formData: FormData) {
  const ctx = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (!userId) return;

  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from('profiles')
    .select('full_name, email, magic_token')
    .eq('id', userId)
    .single();
  if (!profile?.email || !profile.magic_token) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
  const url = `${baseUrl}/i/${profile.magic_token}`;
  const first = (profile.full_name ?? '').split(' ')[0] || 'there';

  await emailProvider.send({
    to: profile.email,
    subject: `${first} — your personal pickup planner link`,
    body: [
      `Hi ${first},`,
      ``,
      `Here's your personal link for the family's pickup planner. Tap to see what's happening this week and claim any pickups you can do:`,
      ``,
      url,
      ``,
      `(Bookmark this — it's your link any time. On iPhone, tap Share → Add to Home Screen for a one-tap icon.)`,
      ``,
      `— The Roditi family`,
    ].join('\n'),
  });

  await sb.from('profiles').update({ last_invite_sent_at: new Date().toISOString() }).eq('id', userId);
  revalidatePath('/admin/helpers');
}

/**
 * Generate a fresh magic_token, invalidating the old personal link. Use if
 * a token was shared too widely or compromised.
 */
export async function regenerateTokenAction(formData: FormData) {
  const ctx = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (!userId) return;

  const sb = supabaseAdmin();
  const { data: m } = await sb.from('household_members').select('user_id').eq('household_id', ctx.household!.id).eq('user_id', userId).maybeSingle();
  if (!m) return;

  const newToken = `tok-${randomBytes(8).toString('hex')}`;
  await sb.from('profiles').update({ magic_token: newToken, token_issued_at: new Date().toISOString() }).eq('id', userId);
  revalidatePath('/admin/helpers');
  revalidatePath('/admin/invites');
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
