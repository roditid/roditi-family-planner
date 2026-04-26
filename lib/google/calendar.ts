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
    // Look up the calendar event row so we know which Google calendar to call.
    const { data: ev } = await sb
      .from('calendar_events')
      .select('calendar_id, google_event_id, title')
      .eq('id', sourceEventId)
      .maybeSingle();
    if (!ev) return { ok: false, error: 'event not found' };

    const baseTitle = (ev.title ?? '').replace(/^\[[^\]]+\]\s*/, '');
    const newTitle = helperFirstName ? `[${helperFirstName}] ${baseTitle}` : baseTitle;

    const { client } = await authorizedClient(sb, householdId);
    const cal = google.calendar({ version: 'v3', auth: client });
    await cal.events.patch({
      calendarId: ev.calendar_id,
      eventId: ev.google_event_id,
      requestBody: { summary: newTitle },
    });

    // Mirror the new title onto our calendar_events row so future syncs
    // start from the updated baseline.
    await sb
      .from('calendar_events')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', sourceEventId);

    return { ok: true, title: newTitle };
  } catch (e: any) {
    console.error('updateEventTitleForClaim failed', e?.message ?? e);
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

  // Load children + activities for matching.
  const { data: children } = await sb
    .from('children')
    .select('id, name, color, school_location_id, home_location_id, gan_dismissal_time, household_id')
    .eq('household_id', householdId);

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

      const match = await resolveEventMatch(sb, title, children ?? [], activities ?? []);
      if (!match) continue;

      const pickupTime = formatInTimeZone(start, tz, 'HH:mm:ss');
      const endTime = end ? formatInTimeZone(end, tz, 'HH:mm:ss') : null;
      const date = formatInTimeZone(start, tz, 'yyyy-MM-dd');

      // Display title: prefer parsed activity name (e.g. "Ninja") over the raw
      // calendar title ("Ninja - Adam") so the UI shows the cleaner version.
      const displayTitle = match.activityTitle ?? title;

      // Slot model: pickup = child's Gan, via = activity location, dest = Home.
      // The helper picks the kid up from the Gan at dismissal time, walks to
      // the activity (the "via" stop), waits, then walks them home.
      //
      // pickup_time: prefer the kid's gan_dismissal_time (so the helper isn't
      // late picking the kid up at the Gan). Fall back to event start time if
      // the kid has no Gan dismissal recorded yet.
      const childRecord = match.child as any;
      const ganDismissal = childRecord.gan_dismissal_time as string | null;
      const slotPickupTime = ganDismissal ?? pickupTime;
      const slotPickupLoc = childRecord.school_location_id ?? match.activity?.default_pickup_location_id ?? null;
      const slotViaLoc = match.activity?.default_destination_location_id ?? null;
      const slotDestLoc = childRecord.home_location_id ?? null;

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

      const { error } = await sb.from('pickup_slots').upsert({
        household_id: householdId,
        child_id: match.child.id,
        activity_id: match.activity?.id ?? null,
        source_event_id: eventRow!.id,
        source: 'calendar',
        title: displayTitle,
        date,
        pickup_time: slotPickupTime,
        // pickupTime here is the calendar event's start (the activity itself);
        // helpful for the chip + modal to show "Soccer 17:00–18:30" alongside
        // the helper's earlier Gan-pickup time.
        activity_start_time: pickupTime,
        end_time: endTime,
        pickup_location_id: slotPickupLoc,
        via_location_id: slotViaLoc,
        destination_location_id: slotDestLoc,
        pickup_location_text: ev.location ?? null,  // preserve raw event location as fallback
        notes: match.activity?.notes ?? null,
        pack_notes: pack_notes || null,
        parent_notes: parent_notes || null,
      }, { onConflict: 'source_event_id' });
      if (!error) slotsCreated++;

      // Calendar-driven assignment: if Paula prefixed the event with a
      // helper's name in brackets, ensure that helper is the active
      // assignment for this slot. We look up the slot we just upserted by
      // source_event_id, then reconcile the assignment if it doesn't match.
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
            }
          }
        } catch (e) {
          console.error('calendar-prefix auto-claim failed', e);
        }
      }
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

/**
 * Pull labeled fragments out of a free-form description. For every line that
 * starts with one of `labels:` (case-insensitive), strip the label and
 * collect the remainder. Returns the joined text, or '' if nothing matched.
 *
 *   "Bring: water bottle\nWear: red shirt"  +  ['pack','bring','wear']
 *     → "water bottle. red shirt"
 */
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

  return null;
}
