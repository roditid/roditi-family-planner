/**
 * Google Calendar integration — Paula's account is the single connected
 * calendar for v1. We pull events inside a date window, match each event to
 * a child/activity (via activity.event_keyword or calendar mapping), and
 * upsert a pickup_slot. The schema's unique index on source_event_id
 * prevents duplicates on re-sync.
 *
 * Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.
 * OAuth connection flow lives in /api/calendar/connect.
 */
import { google, calendar_v3 } from 'googleapis';
import { SupabaseClient } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'openid',
  'email',
  'profile',
];

/**
 * Refresh the access token in-place on the connected_calendars row.
 */
async function authorizedClient(sb: SupabaseClient, householdId: string) {
  const { data: conn } = await sb
    .from('connected_calendars')
    .select('*')
    .eq('household_id', householdId)
    .single();
  if (!conn) throw new Error('No connected calendar for this household.');

  const client = oauthClient();
  client.setCredentials({
    access_token: conn.access_token ?? undefined,
    refresh_token: conn.refresh_token ?? undefined,
    expiry_date: conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : undefined,
  });
  client.on('tokens', async (tokens) => {
    await sb.from('connected_calendars').update({
      access_token: tokens.access_token ?? conn.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : conn.token_expires_at,
    }).eq('id', conn.id);
  });

  return { client, conn };
}

/**
 * Pull events for the next `days` days across all selected calendars,
 * store them in calendar_events, and generate/refresh pickup_slots.
 *
 * Returns counts for the admin UI.
 */
export async function syncCalendar(sb: SupabaseClient, householdId: string, days = 14) {
  const { client, conn } = await authorizedClient(sb, householdId);
  const cal = google.calendar({ version: 'v3', auth: client });
  const calIds: string[] = Array.isArray(conn.selected_calendar_ids)
    ? conn.selected_calendar_ids
    : JSON.parse(conn.selected_calendar_ids || '[]');
  const timeMin = new Date().toISOString();
  const timeMax = addDays(new Date(), days).toISOString();

  let eventsSeen = 0;
  let slotsCreated = 0;

  // Load activities once to match keywords.
  const { data: activities } = await sb
    .from('activities')
    .select('*, child:children(id,name,household_id)')
    .eq('child.household_id', householdId);

  const include = (conn.include_keywords ?? []) as string[];
  const exclude = (conn.exclude_keywords ?? []) as string[];

  for (const calId of calIds.length ? calIds : ['primary']) {
    const res = await cal.events.list({
      calendarId: calId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const events = res.data.items ?? [];
    for (const ev of events) {
      if (!ev.start?.dateTime) continue; // skip all-day for pickup logic
      const title = ev.summary ?? '(untitled)';
      if (include.length && !include.some((k) => matches(title, k))) continue;
      if (exclude.some((k) => matches(title, k))) continue;

      eventsSeen++;
      const start = new Date(ev.start.dateTime);
      const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;

      const { data: eventRow } = await sb.from('calendar_events').upsert({
        household_id: householdId,
        calendar_id: calId,
        google_event_id: ev.id!,
        title,
        description: ev.description ?? null,
        location_text: ev.location ?? null,
        start_at: start.toISOString(),
        end_at: end?.toISOString() ?? null,
        raw: ev as any,
      }, { onConflict: 'calendar_id,google_event_id' }).select().single();

      const match = matchActivity(title, activities ?? []);
      if (!match) continue;

      const pickupTime = format(start, 'HH:mm:ss');
      const endTime = end ? format(end, 'HH:mm:ss') : null;
      const date = format(start, 'yyyy-MM-dd');

      const { error } = await sb.from('pickup_slots').upsert({
        household_id: householdId,
        child_id: match.child.id,
        activity_id: match.id,
        source_event_id: eventRow!.id,
        source: 'calendar',
        title,
        date,
        pickup_time: pickupTime,
        end_time: endTime,
        pickup_location_id: match.default_pickup_location_id,
        destination_location_id: match.default_destination_location_id,
        pickup_location_text: ev.location ?? null,  // preserve raw for display if no structured
        notes: match.notes,
      }, { onConflict: 'source_event_id' });
      if (!error) slotsCreated++;
    }
  }

  await sb.from('connected_calendars').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: `ok — ${eventsSeen} events, ${slotsCreated} slots`,
    last_sync_error: null,
  }).eq('id', conn.id);

  return { eventsSeen, slotsCreated };
}

function matches(title: string, kw: string) {
  return title.toLowerCase().includes(kw.toLowerCase());
}

function matchActivity(title: string, activities: any[]) {
  const t = title.toLowerCase();
  return activities.find((a) => a.event_keyword && t.includes(a.event_keyword.toLowerCase())) ?? null;
}
