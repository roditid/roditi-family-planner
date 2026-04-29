/**
 * Centralised helper-list fetch + sort. Used by the admin dashboard,
 * /admin/unassigned, and now the SlotDetailModal so any view can let
 * admins reassign helpers without bouncing back to /admin.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { demoMode } from './demo-session';
import { allUsers } from './demo-store';

export interface Helper {
  id: string;
  full_name: string;
  helper_kind: string | null;
  role: string;
}

const ROLE_ORDER: Record<string, number> = { admin: 0, grandparent: 1, nanny: 2, other: 3 };

export async function fetchHelpers(sb: SupabaseClient, householdId: string): Promise<Helper[]> {
  if (demoMode()) {
    return allUsers().map((u) => ({
      id: u.id,
      full_name: u.full_name,
      helper_kind: u.helper_kind ?? null,
      role: u.role,
    })).sort(sortFn);
  }

  const { data } = await sb
    .from('household_members')
    .select('helper_kind, role, profiles:user_id(id, full_name)')
    .eq('household_id', householdId);
  const list: Helper[] = (data ?? []).map((m: any) => ({
    id: m.profiles.id,
    full_name: m.profiles.full_name,
    helper_kind: m.helper_kind ?? null,
    role: m.role,
  }));
  return list.sort(sortFn);
}

function sortFn(a: Helper, b: Helper) {
  const ka = a.role === 'admin' ? 0 : ROLE_ORDER[a.helper_kind ?? 'other'] ?? 3;
  const kb = b.role === 'admin' ? 0 : ROLE_ORDER[b.helper_kind ?? 'other'] ?? 3;
  return ka - kb || a.full_name.localeCompare(b.full_name);
}
