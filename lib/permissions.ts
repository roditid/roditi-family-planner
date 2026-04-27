import { cache } from 'react';
import { supabaseServer } from './supabase/server';
import { demoMode, demoCurrentUser } from './demo-session';
import { DEMO } from './demo-store';

/**
 * React cache() memoizes the result for the duration of a single request,
 * so the layout + page + any nested server components share one query
 * round-trip instead of three. Saves ~300 ms per page on Vercel/Supabase
 * cross-region hops.
 */
export const getSessionContext = cache(_getSessionContext);

async function _getSessionContext() {
  // --- Demo mode: cookie-selected user, no Supabase ---
  if (demoMode()) {
    const u = demoCurrentUser();
    if (!u) return null;
    return {
      user: { id: u.id, email: u.email ?? '' } as any,
      profile: u,
      household: { id: DEMO.householdId, name: DEMO.householdName, timezone: DEMO.timezone },
      role: u.role,
      helperKind: u.helper_kind,
    };
  }

  // --- Real mode: Supabase session ---
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: membership } = await sb
    .from('household_members')
    .select('household_id, role, helper_kind, households(name, timezone)')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return { user, household: null, role: null as 'admin' | 'helper' | null };

  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();

  return {
    user,
    profile,
    household: {
      id: membership.household_id,
      name: (membership.households as any)?.name ?? 'Household',
      timezone: (membership.households as any)?.timezone ?? 'Asia/Jerusalem',
    },
    role: membership.role as 'admin' | 'helper',
    helperKind: membership.helper_kind,
  };
}

export async function requireAuth() {
  const ctx = await getSessionContext();
  if (!ctx?.user) throw new Error('UNAUTHORIZED');
  return ctx;
}

export async function requireAdmin() {
  const ctx = await requireAuth();
  if (ctx.role !== 'admin') throw new Error('FORBIDDEN');
  return ctx;
}
