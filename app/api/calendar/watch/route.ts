/**
 * Admin-only endpoint to enable / disable Google Calendar live sync via
 * webhook push notifications. POST = register, DELETE = stop.
 *
 * The watch lasts up to 7 days; the daily sync cron renews it when
 * within 24h of expiry, so once enabled it runs forever.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerCalendarWatch, stopCalendarWatch } from '@/lib/google/calendar';

export async function POST() {
  const ctx = await requireAdmin();
  const sb = supabaseAdmin();
  // Stop any existing watch first so we don't accumulate channels.
  await stopCalendarWatch(sb, ctx.household!.id);
  const r = await registerCalendarWatch(sb, ctx.household!.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function DELETE() {
  const ctx = await requireAdmin();
  const sb = supabaseAdmin();
  const r = await stopCalendarWatch(sb, ctx.household!.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
