/**
 * Liezel summary trigger.
 *
 * Anytime an assignment changes for the household — a grandparent claims, a
 * helper unclaims, or Paula reassigns via the admin picker — Liezel gets a
 * fresh weekly summary so she always has the up-to-date picture of her
 * pickups for the week.
 *
 * Best-effort and silent on failure. Skips when Liezel doesn't exist or has
 * no email/phone on file (so the dev-mode database doesn't error).
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { emailProvider } from './notify';
import { buildWeeklySummaryForUser } from './summaries';

export async function sendLiezelSummaryUpdate(sb: SupabaseClient, householdId: string) {
  try {
    // Find Liezel's profile in this household
    const { data: members } = await sb
      .from('household_members')
      .select('profiles:user_id(id, full_name, email, email_enabled)')
      .eq('household_id', householdId)
      .eq('helper_kind', 'nanny');
    const liezel = (members ?? [])
      .map((m: any) => m.profiles)
      .find((p: any) => p && (p.full_name ?? '').toLowerCase().startsWith('liezel'));
    if (!liezel?.email || liezel.email_enabled === false) return;

    const firstName = (liezel.full_name ?? '').split(' ')[0] || 'Liezel';
    const { subject, body } = await buildWeeklySummaryForUser(sb, householdId, liezel.id, firstName);
    await emailProvider.send({ to: liezel.email, subject, body });
  } catch (e) {
    console.error('Liezel summary update failed', e);
  }
}
