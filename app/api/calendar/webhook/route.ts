/**
 * Google Calendar push notification (webhook) receiver.
 *
 * Google POSTs to this URL on every event change in any calendar we've
 * registered a watch on. Headers identify the channel + resource and
 * what kind of change happened. We respond 200 fast, then re-sync the
 * affected household's calendar in the background.
 *
 * No auth gate — the family password / supabase auth checks don't apply
 * here; Google has no cookies. We verify legitimacy via:
 *   1. The X-Goog-Channel-ID header matches a stored channel.
 *   2. The X-Goog-Channel-Token contains the household id we set when
 *      registering the watch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncCalendar } from '@/lib/google/calendar';
import { generateDefaultSlots } from '@/lib/defaults';

export async function POST(req: NextRequest) {
  const channelId = req.headers.get('x-goog-channel-id');
  const resourceId = req.headers.get('x-goog-resource-id');
  const resourceState = req.headers.get('x-goog-resource-state');
  const channelToken = req.headers.get('x-goog-channel-token');

  // Initial "sync" notification arrives right after watch registration —
  // Google sends one to confirm the channel is live. Nothing to do.
  if (resourceState === 'sync') {
    return NextResponse.json({ ok: true, ack: 'sync' });
  }

  if (!channelId || !channelToken) {
    return NextResponse.json({ error: 'missing headers' }, { status: 400 });
  }

  // Pull household id out of the token we set during watch registration.
  // Format: "household=<uuid>".
  const match = channelToken.match(/household=([0-9a-f-]+)/i);
  const householdId = match?.[1];
  if (!householdId) {
    return NextResponse.json({ error: 'invalid token' }, { status: 400 });
  }

  // Verify the channel id actually matches what we registered. Prevents
  // a guessed-token DoS that would force expensive syncs.
  const sb = supabaseAdmin();
  const { data: conn } = await sb
    .from('connected_calendars')
    .select('id, watch_channel_id, watch_resource_id')
    .eq('household_id', householdId)
    .maybeSingle();
  if (!conn || conn.watch_channel_id !== channelId) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 404 });
  }
  if (resourceId && conn.watch_resource_id && conn.watch_resource_id !== resourceId) {
    return NextResponse.json({ error: 'resource mismatch' }, { status: 400 });
  }

  // Run the actual sync. Google's webhook timeout is generous (~30s) but
  // we still keep this snappy. On error we still 200 — Google retries
  // delivery of failed webhooks, but a sync failure here would just be
  // re-attempted on the next change anyway.
  try {
    await syncCalendar(sb, householdId, 30);
    await generateDefaultSlots(sb, householdId, 30);
  } catch (e: any) {
    console.error('webhook sync failed', e?.message ?? e);
  }

  return NextResponse.json({ ok: true });
}
