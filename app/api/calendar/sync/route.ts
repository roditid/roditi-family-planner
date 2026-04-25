import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncCalendar } from '@/lib/google/calendar';

// Either admin can trigger a sync. Uses the service-role client so RLS
// doesn't need to know about the sync job's writes to calendar_events.
export async function POST() {
  try {
    const ctx = await requireAdmin();
    const sb = supabaseAdmin();
    const result = await syncCalendar(sb, ctx.household!.id);
    return NextResponse.redirect(
      new URL(`/admin/calendar?synced=${result.slotsCreated}`, process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
      { status: 303 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
