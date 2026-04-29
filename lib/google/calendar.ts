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

        if (special.kind === 'prep_day') {
          // Single household-wide row; no child_id. The event description
          // is the prep list — store as notes for the cron to pick up.
          await sb.from('daily_overrides').upsert({
            household_id: householdId,
            child_id: null,
            date,
            kind: 'prep_day',
            source_event_id: specialEventRow?.id ?? null,
            notes: ev.description ?? null,
          }, { onConflict: 'household_id,child_id,date,kind', ignoreDuplicates: false } as any);
        } else if (special.kind === 'no_gan' || special.kind === 'last_day_school' || special.kind === 'early_dismissal') {
          // One row per affected kid
          const kids = special.childIds.length
            ? (children ?? []).filter((c) => special.childIds.includes(c.name))
            : (children ?? []);
          for (const kid of kids) {
            await sb.from('daily_overrides').upsert({
              household_id: householdId,
              child_id: kid.id,
              date,
              kind: special.kind === 'no_gan' ? 'no_gan' : special.kind,
              dismissal_time: special.dismissalTime ?? null,
              source_event_id: specialEventRow?.id ?? null,
              notes: ev.description ?? null,
            }, { onConflict: 'household_id,child_id,date,kind', ignoreDuplicates: false } as any);
            // Keep the in-memory map in sync so picnic-style events later in
            // this same sync pass see the new early-dismissal time.
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
      // "1st Grade Prep". Empty array for ordinary activities.
      const tagAlongIds = ((match.activity as any)?.tag_along_child_ids as string[] | null) ?? [];

      // Order the route by dismissal time. Earliest-dismissed kid becomes
      // the slot's primary (first stop / pickup_location). Activity
      // ownership stays with match.child via activity_id, but slot.child_id
      // tracks the route leader so the chip + modal read in route order.
      let primaryChild: any = match.child;
      let routeAdditionalIds: string[] = tagAlongIds;
      if (tagAlongIds.length > 0) {
        const allInTrip = [match.child.id, ...tagAlongIds];
        const records = (children ?? []).filter((c) => allInTrip.includes(c.id));
        const ordered = [...records].sort((a, b) => {
          const at = a.gan_dismissal_time ?? '99:99:99';
          const bt = b.gan_dismissal_time ?? '99:99:99';
          return at < bt ? -1 : at > bt ? 1 : 0;
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
      // 16:00 Lag Baomer picnic. Helper collects Liam at home at ~15:45.
      const earlyDismissal = earlyDismissalByKidDate.get(`${primaryChild.id}|${date}`) ?? null;
      const isOffGan = !!(earlyDismissal && pickupTime > earlyDismissal);

      const slotPickupTime = isOffGan
        // From-home pickup: leave 15 min before the activity starts.
        ? subtractMinutes(pickupTime, 15)
        : (ganDismissal && pickupTime <= ganDismissal)
          ? subtractMinutes(pickupTime, 15)
          : (ganDismissal ?? pickupTime);
      const slotPickupLoc = isOffGan
        ? (childRecord.home_location_id ?? null)
        : (childRecord.school_location_id ?? match.activity?.default_pickup_location_id ?? null);
      const slotViaLoc = match.activity?.default_destination_location_id ?? null;
      // When the activity has no structured destination (one-off events like
      // a school picnic), fall back to the calendar event's free-text
      // location so the helper still sees where to go.
      const slotViaText = !slotViaLoc && ev.location ? ev.location : null;
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
        child_id: primaryChild.id,
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
        via_location_text: slotViaText,
        additional_child_ids: routeAdditionalIds,
        notes: match.activity?.notes ?? null,
        pack_notes: pack_notes || null,
        parent_notes: parent_notes || null,
        // Special at-Gan activities (Shavuot w/ grandparents, Lag Baomer
        // picnic, parents day, ceremony) — helper stays the whole time.
        requires_full_presence: isFullPresenceTitle(title),
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
];

function isFullPresenceTitle(title: string): boolean {
  const t = title.toLowerCase();
  return FULL_PRESENCE_KEYWORDS.some((kw) => t.includes(kw));
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
