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
import { google } from 'googleapis';
import { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Calendar scope is now READ + WRITE so we can update event titles when a
// helper claims a pickup ("[Levanah] Soccer - Liam"). Re-authorization is
// required: Paula must run /admin/calendar → Connect once after this change.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
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
 * Update a Google Calendar event's title to reflect the current claim state.
 *
 *   • When `helperFirstName` is provided, the event title becomes
 *     "[Helper] Original Title" (e.g. "[Levanah] Soccer - Liam").
 *   • When it's null, any existing "[…]" prefix is stripped, restoring the
 *     original title.
 *
 * Idempotent: re-applying the same prefix is a no-op. Failures are
 * swallowed (logged) so a calendar hiccup never breaks the claim flow.
 */
export async function updateEventTitleForClaim(
  sb: SupabaseClient,
  householdId: string,
  sourceEventId: string,
  helperFirstName: string | null
) {
  try {
    const { data: ev } = await sb
      .from('calendar_events')
      .select('calendar_id, google_event_id, title')
      .eq('id', sourceEventId)
      .maybeSingle();
    if (!ev) {
      await logCalendarTitleEvent(sb, householdId, 'failed', helperFirstName, sourceEventId, 'calendar_events row not found');
      return { ok: false, error: 'event not found' };
    }

    const baseTitle = (ev.title ?? '').replace(/^\[[^\]]+\]\s*/, '');
    const newTitle = helperFirstName ? `[${helperFirstName}] ${baseTitle}` : baseTitle;

    const { client } = await authorizedClient(sb, householdId);
    const cal = google.calendar({ version: 'v3', auth: client });
    // sendUpdates: 'none' so Google doesn't email all existing attendees
    // every time the title changes (e.g., when Tataia claims, Paula
    // shouldn't get a "calendar event updated" email).
    await cal.events.patch({
      calendarId: ev.calendar_id,
      eventId: ev.google_event_id,
      sendUpdates: 'none',
      requestBody: { summary: newTitle },
    });

    await sb
      .from('calendar_events')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', sourceEventId);

    await logCalendarTitleEvent(sb, householdId, 'sent', helperFirstName, sourceEventId, newTitle);
    return { ok: true, title: newTitle };
  } catch (e: any) {
    console.error('updateEventTitleForClaim failed', e?.message ?? e);
    await logCalendarTitleEvent(sb, householdId, 'failed', helperFirstName, sourceEventId, e?.message ?? 'unknown');
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Push a slot's new title back to its source Google Calendar event,
 * preserving any [Helper] prefix that's already on the live event.
 *
 * Distinct from updateEventTitleForClaim (which manipulates the prefix
 * only): this one replaces the BASE title (everything after the prefix)
 * with whatever the admin typed on the website edit form. Used by
 * updateSlotAction when title changes.
 */
export async function updateEventSummary(
  sb: SupabaseClient,
  householdId: string,
  sourceEventId: string,
  newBaseTitle: string
) {
  try {
    const { data: ev } = await sb
      .from('calendar_events')
      .select('calendar_id, google_event_id, title')
      .eq('id', sourceEventId)
      .maybeSingle();
    if (!ev) return { ok: false, error: 'event not found' };

    // Preserve the "[Helper] " prefix if one is currently on the event.
    const prefixMatch = (ev.title ?? '').match(/^\s*\[([^\]]+)\]\s*/);
    const prefix = prefixMatch ? prefixMatch[0] : '';
    const newTitle = `${prefix}${newBaseTitle}`;

    const { client } = await authorizedClient(sb, householdId);
    const cal = google.calendar({ version: 'v3', auth: client });
    await cal.events.patch({
      calendarId: ev.calendar_id,
      eventId: ev.google_event_id,
      sendUpdates: 'none',
      requestBody: { summary: newTitle },
    });
    await sb
      .from('calendar_events')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', sourceEventId);
    return { ok: true };
  } catch (e: any) {
    console.error('updateEventSummary failed', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/** Best-effort write to notification_events so /admin/activity surfaces
 *  whether the calendar title patch actually worked. Without this, a
 *  failed patch silently rotted the chain (claim succeeds, but the
 *  source calendar event title never changes). */
async function logCalendarTitleEvent(
  sb: SupabaseClient,
  householdId: string,
  status: 'sent' | 'failed',
  helperFirstName: string | null,
  sourceEventId: string,
  detail: string
) {
  try {
    const { logNotification } = await import('../notify-log');
    await logNotification(sb, {
      household_id: householdId,
      kind: status === 'sent' ? 'calendar_title_updated' : 'calendar_title_failed',
      channel: 'google_calendar',
      recipient: helperFirstName ?? '(strip prefix)',
      subject: detail,
      status,
      error: status === 'failed' ? detail : null,
    });
  } catch {/* swallow */}
}

/**
 * Register a Google Calendar push notification (watch) for the household's
 * primary selected calendar. Google POSTs to /api/calendar/webhook on
 * every event change, and we re-sync within seconds. Watch lasts up to 7
 * days; the daily sync cron renews it when expiry is within 24h.
 *
 * Returns the channel/resource ids and expiration so the caller can
 * persist them on connected_calendars.
 */
export async function registerCalendarWatch(
  sb: SupabaseClient,
  householdId: string
): Promise<{ ok: boolean; channelId?: string; resourceId?: string; expiration?: string; error?: string }> {
  try {
    const { client, conn } = await authorizedClient(sb, householdId);
    const cal = google.calendar({ version: 'v3', auth: client });
    const calIds: string[] = Array.isArray(conn.selected_calendar_ids)
      ? conn.selected_calendar_ids
      : JSON.parse(conn.selected_calendar_ids || '[]');
    const targetCalId = calIds[0] ?? 'primary';
    const channelId = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
    const webhookUrl = `${baseUrl}/api/calendar/webhook`;

    const { data } = await cal.events.watch({
      calendarId: targetCalId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        // Stash the household id in token so the webhook handler can
        // look up which household to re-sync without a DB roundtrip.
        token: `household=${householdId}`,
      },
    });
    const expirationMs = data.expiration ? Number(data.expiration) : Date.now() + 6 * 24 * 3600 * 1000;
    const expIso = new Date(expirationMs).toISOString();

    await sb.from('connected_calendars').update({
      watch_channel_id: channelId,
      watch_resource_id: data.resourceId ?? null,
      watch_expires_at: expIso,
    }).eq('id', conn.id);

    return { ok: true, channelId, resourceId: data.resourceId ?? undefined, expiration: expIso };
  } catch (e: any) {
    console.error('registerCalendarWatch failed', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Stop an active Google Calendar push notification channel. Called when
 * Paula reconnects a different calendar or before re-registering a watch.
 */
export async function stopCalendarWatch(
  sb: SupabaseClient,
  householdId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: conn } = await sb
      .from('connected_calendars')
      .select('id, watch_channel_id, watch_resource_id, access_token, refresh_token, token_expires_at')
      .eq('household_id', householdId)
      .single();
    if (!conn?.watch_channel_id || !conn.watch_resource_id) return { ok: true };

    const client = oauthClient();
    client.setCredentials({
      access_token: conn.access_token ?? undefined,
      refresh_token: conn.refresh_token ?? undefined,
      expiry_date: conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : undefined,
    });
    const cal = google.calendar({ version: 'v3', auth: client });
    await cal.channels.stop({
      requestBody: { id: conn.watch_channel_id, resourceId: conn.watch_resource_id },
    });
    await sb.from('connected_calendars').update({
      watch_channel_id: null,
      watch_resource_id: null,
      watch_expires_at: null,
    }).eq('id', conn.id);
    return { ok: true };
  } catch (e: any) {
    console.error('stopCalendarWatch failed', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Renew the watch if it's within 24h of expiry. Called by the daily sync
 * cron — keeps the live-sync channel alive without manual intervention.
 */
export async function renewWatchIfExpiring(sb: SupabaseClient, householdId: string) {
  const { data: conn } = await sb
    .from('connected_calendars')
    .select('watch_expires_at')
    .eq('household_id', householdId)
    .single();
  if (!conn?.watch_expires_at) return { ok: true, skipped: true };
  const expiresMs = new Date(conn.watch_expires_at).getTime();
  const oneDayFromNow = Date.now() + 24 * 3600 * 1000;
  if (expiresMs > oneDayFromNow) return { ok: true, skipped: true };
  await stopCalendarWatch(sb, householdId);
  return registerCalendarWatch(sb, householdId);
}

/**
 * Add an email as a Google Calendar attendee on the source event so the
 * claimer gets a real calendar invite in their personal inbox + native
 * Google reminders. Used when an admin (Paula or Dani) claims a slot —
 * they keep the household calendar and want a parallel entry on their
 * personal Google Calendar.
 *
 * Idempotent: if the email is already an attendee, it's a no-op. Failures
 * are swallowed (logged) so a calendar hiccup doesn't break the claim.
 */
export async function addAttendeeToEvent(
  sb: SupabaseClient,
  householdId: string,
  sourceEventId: string,
  email: string,
  options: { sendUpdates?: 'all' | 'externalOnly' | 'none' } = {}
) {
  try {
    const { data: ev } = await sb
      .from('calendar_events')
      .select('calendar_id, google_event_id')
      .eq('id', sourceEventId)
      .maybeSingle();
    if (!ev) return { ok: false, error: 'event not found' };

    const { client } = await authorizedClient(sb, householdId);
    const cal = google.calendar({ version: 'v3', auth: client });
    // Fetch existing attendees first so we don't overwrite.
    const { data: existing } = await cal.events.get({
      calendarId: ev.calendar_id,
      eventId: ev.google_event_id,
    });
    const attendees = (existing.attendees ?? []) as { email?: string }[];
    if (attendees.some((a) => (a.email ?? '').toLowerCase() === email.toLowerCase())) {
      return { ok: true, already: true };
    }
    const merged = [...attendees, { email }];
    // Default sendUpdates='none' so Google doesn't email the calendar
    // owner (Paula) every time a new attendee joins. The claimer's
    // personal Google Calendar still picks up the event because they're
    // now on the attendee list — they just don't get a notification
    // email from Google. Our system sends its own confirmation email.
    await cal.events.patch({
      calendarId: ev.calendar_id,
      eventId: ev.google_event_id,
      sendUpdates: options.sendUpdates ?? 'none',
      requestBody: { attendees: merged },
    });
    // Log to notification feed (best effort).
    try {
      const { logNotification } = await import('../notify-log');
      await logNotification(sb, {
        household_id: householdId,
        kind: 'calendar_invite',
        channel: 'google_calendar',
        recipient: email,
        subject: 'Calendar invite added on claim',
        slot_id: null,
      });
    } catch {}
    return { ok: true };
  } catch (e: any) {
    console.error('addAttendeeToEvent failed', e?.message ?? e);
    try {
      const { logNotification } = await import('../notify-log');
      await logNotification(sb, {
        household_id: householdId,
        kind: 'calendar_invite_failed',
        channel: 'google_calendar',
        recipient: email,
        subject: 'Calendar invite failed',
        status: 'failed',
        error: e?.message ?? String(e),
      });
    } catch {}
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Pull events for the next `days` days across all selected calendars,
 * store them in calendar_events, and generate/refresh pickup_slots.
 *
 * Returns counts for the admin UI.
 */
export async function syncCalendar(sb: SupabaseClient, householdId: string, days = 21) {
  const { client, conn } = await authorizedClient(sb, householdId);
  const cal = google.calendar({ version: 'v3', auth: client });
  const calIds: string[] = Array.isArray(conn.selected_calendar_ids)
    ? conn.selected_calendar_ids
    : JSON.parse(conn.selected_calendar_ids || '[]');
  const timeMin = new Date().toISOString();
  const timeMax = addDays(new Date(), days).toISOString();

  // Get household timezone so we render slot times correctly regardless of
  // where the sync runs from (local machine vs Vercel UTC).
  const { data: household } = await sb.from('households').select('timezone').eq('id', householdId).single();
  const tz = household?.timezone ?? 'Asia/Jerusalem';

  let eventsSeen = 0;
  let slotsCreated = 0;

  // Load children + activities + locations for matching.
  const { data: children } = await sb
    .from('children')
    .select('id, name, color, school_location_id, home_location_id, gan_dismissal_time, household_id')
    .eq('household_id', householdId);

  // Pre-load all of the household's saved locations so we can try to
  // match a calendar event's free-text location against an existing
  // entry. If we find a match, the slot links to the structured row
  // (door codes, contact phone, hours come along automatically). Else
  // we fall back to storing the raw text on slot.via_location_text.
  const { data: householdLocations } = await sb
    .from('locations')
    .select('id, label, street, city, lat, lng')
    .eq('household_id', householdId);
  const allLocations = householdLocations ?? [];

  const { data: activities } = await sb
    .from('activities')
    .select('*, child:children(id,name,household_id)')
    .eq('child.household_id', householdId);

  const include = (conn.include_keywords ?? []) as string[];
  const exclude = (conn.exclude_keywords ?? []) as string[];

  // Pre-load early-dismissal overrides for this window. If an event starts
  // AFTER the early-dismissal time on the same date for the same kid, the
  // kid is already home — the helper should pick up from Home, not Gan.
  // Keyed `${child_id}|${date}` → 'HH:MM:SS'.
  const earlyDismissalByKidDate = new Map<string, string>();
  {
    const startISO = new Date().toISOString().slice(0, 10);
    const endISO = formatInTimeZone(addDays(new Date(), days), tz, 'yyyy-MM-dd');
    const { data: overrides } = await sb
      .from('daily_overrides')
      .select('child_id, date, dismissal_time, kind')
      .eq('household_id', householdId)
      .eq('kind', 'early_dismissal')
      .gte('date', startISO)
      .lte('date', endISO);
    for (const o of overrides ?? []) {
      if (!o.child_id || !o.dismissal_time) continue;
      earlyDismissalByKidDate.set(`${o.child_id}|${o.date}`, o.dismissal_time);
    }
  }

  // Tracks every google_event_id we see across all calendars in this
  // sync pass. After the loop, any calendar_events row in the time
  // window whose google_event_id isn't in this set was deleted on
  // Google's side — we remove it (and its slot) so the website reflects
  // the deletion.
  const seenGoogleEventIds = new Set<string>();

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
    const childNames = (children ?? []).map((c) => c.name);

    for (const ev of events) {
      // Record presence BEFORE filtering. If a previously-imported event
      // matches the include/exclude filter today, we still don't want
      // to delete it — the user simply changed their filter.
      if (ev.id) seenGoogleEventIds.add(ev.id);
      const title = ev.summary ?? '(untitled)';

      // Special markers (no-gan, gan-until-HH:MM, prep-day, last-day) are
      // control signals — they must bypass include/exclude keyword filters.
      // Otherwise an "include: pickup" filter would silently drop a
      // "Liam - gan until 12:30" early-dismissal marker.
      const special = detectSpecialEvent(title, childNames);
      if (!special) {
        if (include.length && !include.some((k) => matches(title, k))) continue;
        if (exclude.some((k) => matches(title, k))) continue;
      }

      // All-day events have ev.start.date; timed events have ev.start.dateTime.
      // Special markers (no-gan, prep-day, last-day) often live as all-day.
      const isAllDay = !ev.start?.dateTime;
      const startDate = isAllDay
        ? new Date((ev.start?.date ?? '') + 'T00:00:00')
        : new Date(ev.start!.dateTime!);

      if (special) {
        eventsSeen++;
        // Persist the source event row so daily_overrides can reference it.
        const { data: specialEventRow } = await sb.from('calendar_events').upsert({
          household_id: householdId,
          calendar_id: calId,
          google_event_id: ev.id!,
          title,
          description: ev.description ?? null,
          location_text: ev.location ?? null,
          start_at: startDate.toISOString(),
          end_at: ev.end?.dateTime ? new Date(ev.end.dateTime).toISOString() : null,
          raw: ev as any,
        }, { onConflict: 'calendar_id,google_event_id' }).select().single();

        const date = formatInTimeZone(startDate, tz, 'yyyy-MM-dd');

        // NB: the unique index on daily_overrides uses coalesce(child_id, ...)
        // which PostgREST's onConflict can't target by column names — so we
        // replace upsert with explicit delete-by-key + insert. Without this,
        // every early-dismissal write was silently no-op'd.
        if (special.kind === 'prep_day') {
          await sb.from('daily_overrides')
            .delete()
            .eq('household_id', householdId)
            .is('child_id', null)
            .eq('date', date)
            .eq('kind', 'prep_day');
          await sb.from('daily_overrides').insert({
            household_id: householdId,
            child_id: null,
            date,
            kind: 'prep_day',
            source_event_id: specialEventRow?.id ?? null,
            notes: ev.description ?? null,
          });
        } else if (special.kind === 'no_gan' || special.kind === 'last_day_school' || special.kind === 'early_dismissal') {
          const kids = special.childIds.length
            ? (children ?? []).filter((c) => special.childIds.includes(c.name))
            : (children ?? []);
          const overrideKind = special.kind === 'no_gan' ? 'no_gan' : special.kind;
          for (const kid of kids) {
            await sb.from('daily_overrides')
              .delete()
              .eq('household_id', householdId)
              .eq('child_id', kid.id)
              .eq('date', date)
              .eq('kind', overrideKind);
            await sb.from('daily_overrides').insert({
              household_id: householdId,
              child_id: kid.id,
              date,
              kind: overrideKind,
              dismissal_time: special.dismissalTime ?? null,
              source_event_id: specialEventRow?.id ?? null,
              notes: ev.description ?? null,
            });
            if (special.kind === 'early_dismissal' && special.dismissalTime) {
              earlyDismissalByKidDate.set(`${kid.id}|${date}`, special.dismissalTime);
            }
          }
        }
        continue; // special events don't create pickup_slots
      }

      if (!ev.start?.dateTime) continue; // regular pickup logic needs a timed event

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

      // Strip any "[Helper] " auto-claim prefix BEFORE matching + display.
      // The prefix is purely a directive for the importer (it tells us
      // who claimed the slot); the slot title itself should read
      // "Soccer", not "[Vovo] Soccer".
      const cleanTitle = title.replace(/^\s*\[[^\]]+\]\s*/, '');
      const match = await resolveEventMatch(sb, cleanTitle, children ?? [], activities ?? []);
      if (!match) continue;

      const pickupTime = formatInTimeZone(start, tz, 'HH:mm:ss');
      const endTime = end ? formatInTimeZone(end, tz, 'HH:mm:ss') : null;
      const date = formatInTimeZone(start, tz, 'yyyy-MM-dd');

      // Display title: prefer parsed activity name ("Soccer") over the
      // cleaned calendar title ("Soccer - Liam"), so the UI shows the
      // cleaner version.
      const displayTitle = match.activityTitle ?? cleanTitle;

      // Slot model: pickup = first-route kid's Gan, additional Gan stops for
      // any tag-along siblings, then via = activity location, dest = Home.
      //
      // Route order: when tag-along kids ride along, sort the full pickup
      // list (primary + tagalongs) by gan_dismissal_time so the helper
      // collects in dismissal order. Yali (16:00) before Adam (16:15) — so
      // the kid waits the least at the Gan.
      //
      // pickup_time logic:
      //   • Prefer the route-leader's gan_dismissal_time so the helper
      //     isn't standing at the Gan while the kid is still inside.
      //   • EXCEPTION: when the activity starts at or before the dismissal
      //     time, the helper would be late if they collected at dismissal.
      //     Pull pickup back 15 min before activity start so there's transit
      //     time (Ganenets allow early pickup when there's an activity to
      //     get to). Adam @ 16:30 dismissal + Ninja @ 16:30 → pickup 16:15.

      // Tag-along siblings: any kids stored on activities.tag_along_child_ids
      // ride the slot automatically. e.g. Yali always joins Adam's
      // "1st Grade Prep". Empty array for ordinary activities. For
      // household events (birthdays, holidays), every kid rides along.
      const tagAlongIds = match.isHouseholdEvent
        ? (match.householdKidIds ?? [])
        : (((match.activity as any)?.tag_along_child_ids as string[] | null) ?? []);

      // Order the route by dismissal time. Earliest-dismissed kid becomes
      // the slot's primary (first stop / pickup_location). Activity
      // ownership stays with match.child via activity_id, but slot.child_id
      // tracks the route leader so the chip + modal read in route order.
      let primaryChild: any = match.child;
      let routeAdditionalIds: string[] = tagAlongIds;
      if (tagAlongIds.length > 0) {
        const allInTrip = [match.child.id, ...tagAlongIds];
        const records = (children ?? []).filter((c) => allInTrip.includes(c.id));
        // Sort by dismissal ascending; Yali wins ties — she's always
        // collected first when she's in a combined trip.
        const ordered = [...records].sort((a, b) => {
          const at = a.gan_dismissal_time ?? '99:99:99';
          const bt = b.gan_dismissal_time ?? '99:99:99';
          if (at !== bt) return at < bt ? -1 : 1;
          if (a.name === 'Yali') return -1;
          if (b.name === 'Yali') return 1;
          return 0;
        });
        primaryChild = ordered[0];
        routeAdditionalIds = ordered.slice(1).map((c) => c.id);
      }

      const childRecord = primaryChild as any;
      const ganDismissal = childRecord.gan_dismissal_time as string | null;

      // Off-Gan flow: if there's an early-dismissal override for this kid
      // on this date AND the activity starts AFTER the early dismissal
      // time, the kid is already home — pickup origin is Home, not Gan.
      // Example: May 5 — "Liam - gan until 12:30" early dismissal, then
      // 16:00 Lag Baomer picnic. Helper collects Liam at home before the
      // event.
      const earlyDismissal = earlyDismissalByKidDate.get(`${primaryChild.id}|${date}`) ?? null;
      const isOffGan = !!(earlyDismissal && pickupTime > earlyDismissal);
      const fullPresence = isFullPresenceTitle(title);

      // Morning-from-home flow: events that start in the morning (before
      // the kid would normally be at the Gan) flip the trip — pickup at
      // Home, drop off at the kid's Gan after the event. Example: May 5
      // "Adam - Judo Competition" at 8:45. The kid still needs the regular
      // afternoon Gan→Home, which is generated separately.
      //   Heuristic: event start hour < 12 AND not detected as off-Gan
      //   (which would be afternoon-from-home). If the activity has an
      //   explicit default_pickup_location pointing to a non-school place,
      //   we trust that instead.
      const eventStartHour = parseInt(pickupTime.slice(0, 2), 10);
      const isMorningFromHome = !isOffGan && !fullPresence && !match.isHouseholdEvent && eventStartHour < 12;
      // Household events (birthdays, holidays) always run from home →
      // event → home. They're never picked up at a Gan.
      const isHouseholdFromHome = !!match.isHouseholdEvent;

      const slotPickupTime = fullPresence || isHouseholdFromHome
        // Full-presence events + household events (Lag Baomer picnic,
        // parents day, ceremonies, birthdays, holidays): helper ATTENDS
        // the whole event. pickup_time = event start, no 15-min pre-pull
        // — they're meeting the family at the event.
        ? pickupTime
        : isOffGan || isMorningFromHome
          // From-home pickup: leave 15 min before the activity starts.
          ? subtractMinutes(pickupTime, 15)
          : (ganDismissal && pickupTime <= ganDismissal)
            ? subtractMinutes(pickupTime, 15)
            : (ganDismissal ?? pickupTime);
      const slotPickupLoc = isOffGan || isMorningFromHome || isHouseholdFromHome
        ? (childRecord.home_location_id ?? null)
        : (childRecord.school_location_id ?? match.activity?.default_pickup_location_id ?? null);
      // Resolve the via (activity) location:
      //   1. activity row's default destination wins if set
      //   2. otherwise, try to match the event's free-text location
      //      against the household's saved locations — if we find a
      //      match (by label or street/city), link to that location
      //      so the helper picks up door codes / contact phone for
      //      free.
      //   3. otherwise, store the raw text as a fallback so the helper
      //      still sees an address.
      let slotViaLoc = match.activity?.default_destination_location_id ?? null;
      let slotViaText: string | null = null;
      if (!slotViaLoc && ev.location) {
        const matched = matchLocationByText(ev.location, allLocations);
        if (matched) slotViaLoc = matched.id;
        else slotViaText = ev.location;
      }
      // Morning-from-home: drop off at the kid's Gan AFTER the event.
      // Otherwise (household events, regular activities, off-Gan): drop
      // off at home.
      const slotDestLoc = isMorningFromHome
        ? (childRecord.school_location_id ?? null)
        : (childRecord.home_location_id ?? null);

      // Pull per-event one-offs out of the calendar description. Recognized
      // labels (case-insensitive, anywhere on a line):
      //   Pack: …    Bring: …    Wear: …    →  pack_notes
      //   Note: …                            →  parent_notes (admin-only)
      // Lines that don't match a label are dropped — the description is
      // free-form, we only lift the structured bits.
      const desc = ev.description ?? '';
      const pack_notes = pickLabeledLines(desc, ['pack', 'bring', 'wear']);
      const parent_notes = pickLabeledLines(desc, ['note', 'notes']);

      // If Paula prefixed the event with "[Helper Name] " in her calendar,
      // honour it: detect the prefix, look up the matching helper by first
      // name, and ensure that helper is the active assignment for this slot.
      // Resolved BEFORE the slot upsert so we have all the data to wire up
      // the assignment in the same sync pass.
      const prefixMatch = title.match(/^\s*\[([^\]]+)\]\s*/);
      const prefixedFirstName = prefixMatch ? prefixMatch[1].trim().split(/\s+/)[0] : null;
      let prefixedHelperId: string | null = null;
      if (prefixedFirstName) {
        const { data: candidates } = await sb
          .from('household_members')
          .select('user_id, profiles:user_id(id, full_name)')
          .eq('household_id', householdId);
        const lower = prefixedFirstName.toLowerCase();
        const m = (candidates ?? []).find((c: any) => {
          const fn = (c.profiles?.full_name ?? '').toLowerCase();
          return fn.startsWith(lower) || fn.includes(`(${lower}`);
        });
        prefixedHelperId = m?.user_id ?? null;
      }

      // Check whether the admin manually edited an existing slot for
      // this calendar event. If so, preserve their changes instead of
      // blowing them away on every sync. We still bump
      // activity_start_time / end_time / location_text in case the
      // event time moved on Google — those are reference fields, not
      // user edits — but skip the title, pickup_time, and
      // additional_child_ids which the edit form may have changed.
      const { data: existingSlot } = await sb
        .from('pickup_slots')
        .select('id, manually_arranged')
        .eq('source_event_id', eventRow!.id)
        .maybeSingle();
      const isManual = !!existingSlot?.manually_arranged;

      const fullPayload = {
        household_id: householdId,
        child_id: primaryChild.id,
        activity_id: match.activity?.id ?? null,
        source_event_id: eventRow!.id,
        source: 'calendar',
        title: displayTitle,
        date,
        pickup_time: slotPickupTime,
        activity_start_time: pickupTime,
        end_time: endTime,
        pickup_location_id: slotPickupLoc,
        via_location_id: slotViaLoc,
        destination_location_id: slotDestLoc,
        pickup_location_text: ev.location ?? null,
        via_location_text: slotViaText,
        additional_child_ids: routeAdditionalIds,
        notes: match.activity?.notes ?? null,
        pack_notes: pack_notes || null,
        parent_notes: parent_notes || null,
        requires_full_presence: isFullPresenceTitle(title),
      };
      // Manual-edit-safe payload: skip the fields admins commonly edit.
      const manualSafePayload = {
        household_id: householdId,
        source_event_id: eventRow!.id,
        // Don't overwrite child_id / title / pickup_time / additional_child_ids.
        activity_start_time: pickupTime,
        end_time: endTime,
        pickup_location_text: ev.location ?? null,
        via_location_text: slotViaText,
        pack_notes: pack_notes || null,
        parent_notes: parent_notes || null,
        requires_full_presence: isFullPresenceTitle(title),
      };
      const { error } = await sb.from('pickup_slots').upsert(
        isManual ? manualSafePayload : fullPayload,
        { onConflict: 'source_event_id' }
      );
      if (!error) slotsCreated++;

      // Calendar-driven assignment: if Paula prefixed the event with a
      // helper's name in brackets, ensure that helper is the active
      // assignment for this slot. Mirrors the manual-claim flow from
      // /api/slots/[id]/claim — same side effects so the prefix path
      // doesn't quietly skip the confirmation email, the slot_events
      // log, the Liezel summary refresh, the admin claim notification,
      // and the .ics calendar invite.
      if (prefixedHelperId) {
        try {
          const { data: slotRow } = await sb
            .from('pickup_slots')
            .select('id, status')
            .eq('source_event_id', eventRow!.id)
            .maybeSingle();
          if (slotRow) {
            const { data: existing } = await sb
              .from('slot_assignments')
              .select('id, assigned_to_user_id')
              .eq('pickup_slot_id', slotRow.id)
              .eq('status', 'active')
              .maybeSingle();
            if (existing?.assigned_to_user_id !== prefixedHelperId) {
              if (existing) {
                await sb.from('slot_assignments')
                  .update({ status: 'overridden', released_at: new Date().toISOString() })
                  .eq('id', existing.id);
              }
              await sb.from('slot_assignments').insert({
                pickup_slot_id: slotRow.id,
                assigned_to_user_id: prefixedHelperId,
                status: 'active',
              });
              await sb.from('pickup_slots').update({ status: 'claimed' }).eq('id', slotRow.id);

              // ── Side effects (same as the manual claim API). Lazy-
              // imported so we don't tangle calendar.ts with email/log
              // modules at module-load time.
              const [{ recordEvent }, { sendLiezelSummaryUpdate }, { sendAdminClaimUpdate }, { renderClaimConfirmation, emailProvider }] = await Promise.all([
                import('../events'),
                import('../notify-liezel'),
                import('../notify-admins'),
                import('../notify'),
              ]);

              await recordEvent({
                householdId,
                slotId: slotRow.id,
                actorUserId: prefixedHelperId, // self-claim via title prefix
                subjectUserId: prefixedHelperId,
                kind: 'claimed',
              });

              // Hydrate slot + claimer profile + role.
              const { data: hydratedSlot } = await sb
                .from('pickup_slots')
                .select(`*, child:children(*), activity:activities(*),
                  pickup_location:pickup_location_id(*),
                  via_location:via_location_id(*),
                  destination_location:destination_location_id(*)`)
                .eq('id', slotRow.id)
                .maybeSingle();
              const { data: claimerProfile } = await sb
                .from('profiles')
                .select('full_name, email, email_enabled')
                .eq('id', prefixedHelperId)
                .maybeSingle();
              const { data: claimerMembership } = await sb
                .from('household_members')
                .select('role')
                .eq('household_id', householdId)
                .eq('user_id', prefixedHelperId)
                .maybeSingle();
              const claimerIsAdmin = claimerMembership?.role === 'admin';

              // For admin claimers, add their personal email as a Google
              // Calendar attendee on the source event with sendUpdates=
              // 'none'. Their personal calendar shows the event natively
              // without spamming the calendar owner.
              if (claimerIsAdmin && claimerProfile?.email && eventRow!.id) {
                try {
                  await addAttendeeToEvent(sb, householdId, eventRow!.id, claimerProfile.email, { sendUpdates: 'none' });
                } catch (e) {
                  console.error('add admin attendee failed', e);
                }
              }

              // Confirmation email — same format for everyone, no .ics
              // (admins get the calendar event via the attendee path).
              if (hydratedSlot && claimerProfile?.email && claimerProfile?.email_enabled !== false) {
                const extraIds = (hydratedSlot.additional_child_ids as string[] | null) ?? [];
                let additional_children: any[] = [];
                if (extraIds.length > 0) {
                  const { data: kids } = await sb.from('children').select('*, school_location:school_location_id(*)').in('id', extraIds);
                  additional_children = kids ?? [];
                }
                const fullSlot = { ...hydratedSlot, additional_children };
                const { subject, body, html, attachments } = renderClaimConfirmation(fullSlot as any, claimerProfile.full_name ?? null);
                const { sendAndLog } = await import('../notify-log');
                await sendAndLog(sb, {
                  household_id: householdId,
                  to: claimerProfile.email,
                  subject, body, html, attachments,
                  actor_user_id: prefixedHelperId,
                  slot_id: slotRow.id,
                });
              }

              await sendLiezelSummaryUpdate(sb, householdId);
              // Skip cross-admin notification when the claimer is an
              // admin (Paula/Dani independent). Helper claims still
              // notify admins so they have mid-week visibility.
              if (!claimerIsAdmin) {
                await sendAdminClaimUpdate(sb, householdId, {
                  actorName: claimerProfile?.full_name?.split(' ')[0] ?? null,
                  action: 'claimed',
                  slotLabel: hydratedSlot
                    ? `${(hydratedSlot as any).child?.name ?? '?'} · ${hydratedSlot.title} · ${hydratedSlot.date} ${(hydratedSlot.pickup_time as string).slice(0, 5)}`
                    : null,
                });
              }
            }
          }
        } catch (e) {
          console.error('calendar-prefix auto-claim failed', e);
        }
      }
    }
  }

  // ── Detect deletions on Google's side ──
  // Pull every calendar_events row this household has in the sync window.
  // Any whose google_event_id wasn't seen during the loop above is an
  // event Paula deleted from Google Calendar. Remove the corresponding
  // pickup_slot (so the website reflects the deletion) and the
  // calendar_events row itself.
  let slotsDeleted = 0;
  let eventsDeleted = 0;
  try {
    const { data: dbEvents } = await sb
      .from('calendar_events')
      .select('id, google_event_id, title')
      .eq('household_id', householdId)
      .gte('start_at', timeMin)
      .lt('start_at', timeMax);

    const orphans = (dbEvents ?? []).filter(
      (e: any) => e.google_event_id && !seenGoogleEventIds.has(e.google_event_id)
    );

    if (orphans.length > 0) {
      const orphanIds = orphans.map((e: any) => e.id);
      // Pull the slot ids so we can drop their active assignments first
      // (FK from slot_assignments.pickup_slot_id may not cascade).
      const { data: orphanSlots } = await sb
        .from('pickup_slots')
        .select('id')
        .in('source_event_id', orphanIds);
      const orphanSlotIds = (orphanSlots ?? []).map((s: any) => s.id);
      if (orphanSlotIds.length > 0) {
        await sb.from('slot_assignments').delete().in('pickup_slot_id', orphanSlotIds);
        await sb.from('pickup_slots').delete().in('id', orphanSlotIds);
        slotsDeleted = orphanSlotIds.length;
      }
      await sb.from('calendar_events').delete().in('id', orphanIds);
      eventsDeleted = orphanIds.length;

      // Log to the activity feed so admins see what disappeared.
      try {
        const { logNotification } = await import('../notify-log');
        for (const o of orphans) {
          await logNotification(sb, {
            household_id: householdId,
            kind: 'calendar_title_updated' as any,
            channel: 'google_calendar',
            recipient: '(deleted)',
            subject: `Event deleted from Google: ${(o as any).title ?? '(no title)'}`,
          });
        }
      } catch {/* swallow */}
    }
  } catch (e: any) {
    console.error('orphan cleanup failed', e?.message ?? e);
  }

  await sb.from('connected_calendars').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: `ok — ${eventsSeen} events, ${slotsCreated} slots${eventsDeleted ? `, ${eventsDeleted} deleted` : ''}`,
    last_sync_error: null,
  }).eq('id', conn.id);

  return { eventsSeen, slotsCreated, slotsDeleted, eventsDeleted };
}

function matches(title: string, kw: string) {
  return title.toLowerCase().includes(kw.toLowerCase());
}

/**
 * Try to match a calendar event's free-text location field against
 * one of the household's saved Locations rows. Strategy (case-/punct-
 * insensitive):
 *   1. Exact label match
 *   2. The text contains the location's street + city as a substring
 *      (or vice versa) — Google's location often pastes a full address
 *      that wraps the saved location's address
 *   3. Substring overlap on label + street tokens
 *
 * Returns the matched location row, or null when nothing's close enough.
 */
interface SavedLocation { id: string; label: string; street: string | null; city: string | null }
function matchLocationByText(text: string, locations: SavedLocation[]): SavedLocation | null {
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const target = norm(text);
  if (!target) return null;
  // 1. exact label
  for (const loc of locations) {
    if (norm(loc.label) === target) return loc;
  }
  // 2. address substring either way
  for (const loc of locations) {
    const addr = norm([loc.street, loc.city].filter(Boolean).join(' '));
    if (addr && (target.includes(addr) || addr.includes(target))) return loc;
  }
  // 3. label substring (e.g. "Drahi" matches "Drahi · Neve Tzedek
  //    Community Center")
  for (const loc of locations) {
    const lbl = norm(loc.label);
    if (lbl && lbl.length >= 4 && target.includes(lbl)) return loc;
  }
  return null;
}

// ─── Special calendar-event patterns ────────────────────────────────────
// These let Paula drive the schedule by writing recognizable titles in
// roditikids@gmail.com instead of clicking through the admin UI.
//
//   "Liam - No gan"                 → no Gan→Home that day for Liam
//   "Kids - No gan"                 → no Gan for any kid
//   "A&L - No gan"                  → initials map to kids (A=Adam, L=Liam, Y=Yali)
//   "Liam - gan until 12:30"        → early-dismissal override for that date
//   "Adam - Last day of gan"        → school-activity reminder, Adam-only
//   "prep day for tomorrow"         → backpack items go to Liezel via WhatsApp
//   "Liam - Shavuot w/ Grandparents" + at the Gan → requires_full_presence

interface SpecialEventMatch {
  kind: 'no_gan' | 'early_dismissal' | 'last_day_school' | 'prep_day';
  childIds: string[]; // empty = all kids
  dismissalTime?: string; // 'HH:MM:SS' for early_dismissal
}

const KID_INITIAL_TO_NAME: Record<string, string> = {
  a: 'Adam', l: 'Liam', y: 'Yali',
};

/**
 * Map a kid-prefix string ("Liam" / "Kids" / "A&L" / "Y&A") to a list of
 * child names. Returns empty array if the prefix doesn't resolve.
 */
function resolveKidPrefix(prefix: string, childNames: string[]): string[] {
  const trimmed = prefix.trim().toLowerCase();
  if (!trimmed) return [];
  if (trimmed === 'kids' || trimmed === 'all') return childNames;
  // Direct name match
  const direct = childNames.find((n) => n.toLowerCase() === trimmed);
  if (direct) return [direct];
  // Initials joined with & (or comma / space)
  if (/^[ayl](\s*[&,+]\s*[ayl])+$/i.test(trimmed)) {
    const inits = trimmed.split(/[\s&,+]+/).filter(Boolean);
    const names: string[] = [];
    for (const init of inits) {
      const name = KID_INITIAL_TO_NAME[init];
      if (name && childNames.includes(name)) names.push(name);
    }
    return names;
  }
  return [];
}

/**
 * Decide whether an event title is a "special" override / marker rather
 * than a regular pickup. Returns the parsed payload or null if it's a
 * normal event.
 */
function detectSpecialEvent(title: string, childNames: string[]): SpecialEventMatch | null {
  const t = title.trim();

  // "prep day for tomorrow" — case-insensitive, ignores punctuation
  if (/prep\s*day\s*(for\s*)?tomorrow/i.test(t)) {
    return { kind: 'prep_day', childIds: [] };
  }

  // "[KidPrefix] - No gan"  (case-insensitive, allows en/em dash)
  const noGanMatch = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*no\s*gan\s*$/i);
  if (noGanMatch) {
    const kids = resolveKidPrefix(noGanMatch[1], childNames);
    return { kind: 'no_gan', childIds: kids };
  }

  // "[Kid] - gan until 12:30"
  const untilMatch = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*gan\s*until\s*(\d{1,2})[:.](\d{2})/i);
  if (untilMatch) {
    const kids = resolveKidPrefix(untilMatch[1], childNames);
    const hh = String(parseInt(untilMatch[2], 10)).padStart(2, '0');
    const mm = untilMatch[3];
    return { kind: 'early_dismissal', childIds: kids, dismissalTime: `${hh}:${mm}:00` };
  }

  // "[Kid] - Last day of gan" — Adam-only school activity, others ignored
  const lastDayMatch = t.match(/^([\w\s&+,]+?)\s*[-–—]\s*last\s*day\s*of\s*gan/i);
  if (lastDayMatch) {
    const kids = resolveKidPrefix(lastDayMatch[1], childNames);
    return { kind: 'last_day_school', childIds: kids };
  }

  return null;
}

const FULL_PRESENCE_KEYWORDS = [
  'shavuot', 'lag baomer', 'lag ba\'omer', 'picnic', 'parents day',
  'yom hahorim', 'mesibat', 'celebration', 'ceremony', 'siyum',
  'birthday', 'b-day', 'bday', 'party',
];

function isFullPresenceTitle(title: string): boolean {
  const t = title.toLowerCase();
  return FULL_PRESENCE_KEYWORDS.some((kw) => t.includes(kw));
}

// Keywords that mark an event as a "household event" — birthday parties,
// holidays, weekend celebrations, school festivals. Even when no specific
// kid is named in the title, if any of these match we still create a slot
// (with all kids attached) so the family doesn't lose the event.
const HOUSEHOLD_EVENT_KEYWORDS = [
  'birthday', 'b-day', 'bday', 'party', 'picnic', 'celebration',
  'ceremony', 'siyum', 'mesibat', 'parents day', 'yom hahorim',
  'shavuot', 'lag baomer', 'lag ba\'omer', 'rosh hashana', 'pesach',
  'sukkot', 'purim', 'simchat torah', 'hanukkah', 'tu bishvat',
  'family', 'holiday',
];

function isHouseholdEvent(title: string): boolean {
  const t = title.toLowerCase();
  return HOUSEHOLD_EVENT_KEYWORDS.some((kw) => t.includes(kw));
}

/**
 * Pull labeled fragments out of a free-form description. For every line that
 * starts with one of `labels:` (case-insensitive), strip the label and
 * collect the remainder. Returns the joined text, or '' if nothing matched.
 *
 *   "Bring: water bottle\nWear: red shirt"  +  ['pack','bring','wear']
 *     → "water bottle. red shirt"
 */
/** Subtract `minutes` from an "HH:MM:SS" time string. Returns "HH:MM:SS". */
function subtractMinutes(timeHHMMSS: string, minutes: number): string {
  const [h, m] = timeHHMMSS.split(':').map(Number);
  let total = h * 60 + m - minutes;
  if (total < 0) total = 0;
  const h2 = Math.floor(total / 60);
  const m2 = total % 60;
  return `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00`;
}

function pickLabeledLines(desc: string, labels: string[]): string {
  if (!desc) return '';
  const re = new RegExp(`^\\s*(?:${labels.join('|')})\\s*:\\s*(.+?)\\s*$`, 'gim');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out.join('. ').replace(/\.\s*\.\s*/g, '. ');
}

interface EventMatch {
  child: { id: string; name: string; school_location_id: string | null; home_location_id: string | null };
  activity: any | null;
  activityTitle: string | null;
  /** True for events that match no specific kid but ARE family events
   *  (birthdays, holidays, school festivals). Pickup flow flips to
   *  Home → Event → Home and all kids ride the slot. */
  isHouseholdEvent?: boolean;
  /** When isHouseholdEvent, the full list of kid ids on the slot (primary
   *  + every additional child). The caller uses this for the slot's
   *  additional_child_ids field. */
  householdKidIds?: string[];
}

/**
 * Decide which child + activity an event belongs to.
 *
 * Primary pattern: "Activity - Kid Name" (e.g. "Ninja - Adam", "Judo - Liam").
 * Separator can be ` - `, ` — `, ` – `, or `: `. Last segment is the kid.
 *
 * Fallback: legacy keyword match against `activity.event_keyword`.
 *
 * If we resolve a child + activity name, we ALSO auto-create an activity
 * row on first sight so the parent can later set defaults for it in the
 * admin UI without typing the name again.
 */
async function resolveEventMatch(
  sb: SupabaseClient,
  title: string,
  children: any[],
  activities: any[]
): Promise<EventMatch | null> {
  // Try the "Activity - Kid Name" pattern.
  const SEP = /\s+[-–—:|/]\s+/;
  const segs = title.split(SEP).map((s) => s.trim()).filter(Boolean);
  if (segs.length >= 2) {
    // The kid name might be in any segment, but most commonly the LAST.
    // Check both ends.
    const candidates = [segs[segs.length - 1], segs[0]];
    for (const cand of candidates) {
      const child = children.find((c) => c.name.toLowerCase() === cand.toLowerCase());
      if (!child) continue;
      // Activity title = whatever's NOT the kid name.
      const activityTitle = segs.filter((s) => s !== cand).join(' - ').trim();
      // Find or create the activity row by (child_id, lower(title)).
      let activity = activities.find((a) =>
        a.child?.id === child.id && a.title.toLowerCase() === activityTitle.toLowerCase()
      );
      if (!activity && activityTitle) {
        const { data: created } = await sb.from('activities').insert({
          child_id: child.id,
          title: activityTitle,
          event_keyword: activityTitle.toLowerCase(),
        }).select('*, child:children(id,name,household_id)').single();
        activity = created;
        activities.push(activity);
      }
      return { child, activity: activity ?? null, activityTitle: activityTitle || null };
    }
  }

  // Fallback: legacy keyword match.
  const kw = activities.find((a) => a.event_keyword && matches(title, a.event_keyword));
  if (kw?.child) return { child: kw.child, activity: kw, activityTitle: kw.title };

  // Last resort: kid name appears anywhere in the title.
  const child = children.find((c) => matches(title, c.name));
  if (child) return { child, activity: null, activityTitle: title };

  // Household event fallback: birthday party, holiday, school festival,
  // etc. — no specific kid in the title, but it's clearly a family event
  // off the kids' calendar. Attach ALL kids so the family sees it on
  // every helper's view. Primary kid is the first child alphabetically
  // (just for storage); the chip renders the kid stack.
  if (isHouseholdEvent(title) && children.length > 0) {
    const sorted = [...children].sort((a, b) => a.name.localeCompare(b.name));
    return {
      child: sorted[0],
      activity: null,
      activityTitle: title,
      isHouseholdEvent: true,
      householdKidIds: sorted.slice(1).map((c) => c.id),
    };
  }

  return null;
}
