/**
 * In-memory demo store. Used when DEMO_MODE=true (no Supabase required).
 * Persisted on the Node process for the dev session — state survives page
 * navigations but resets when the server restarts. Good enough for a
 * "click around and see it work" preview.
 */
import { addDays, format, startOfWeek } from 'date-fns';
import type { SlotView, PickupSlot, Profile, Location, Child, Activity } from './types';

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
const HOUSEHOLD_ID = 'house-roditi';

type DemoProfile = Profile & { magic_token: string };

const USERS: DemoProfile[] = [
  { id: 'u-paula',   magic_token: 'tok-paula-7k2x9',   full_name: 'Paula Roditi',  email: 'paula@example.com',   phone_number: null, home_address: 'Tel Aviv',  home_lat: null, home_lng: null, role: 'admin',  helper_kind: null,            color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-daniel',  magic_token: 'tok-daniel-3q8m1',  full_name: 'Daniel Roditi', email: 'daniel@example.com',  phone_number: null, home_address: 'Tel Aviv',  home_lat: null, home_lng: null, role: 'admin',  helper_kind: null,            color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-rachel',  magic_token: 'tok-rachel-4v6n2',  full_name: 'Savta Rachel',   email: 'rachel@example.com',  phone_number: null, home_address: 'Ramat Aviv',home_lat: null, home_lng: null, role: 'helper', helper_kind: 'grandparent',   color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-yossi',   magic_token: 'tok-yossi-9p5j8',   full_name: 'Saba Yossi',     email: 'yossi@example.com',   phone_number: null, home_address: 'Ramat Gan', home_lat: null, home_lng: null, role: 'helper', helper_kind: 'grandparent',   color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-miri',    magic_token: 'tok-miri-2c4d6',    full_name: 'Savta Miri',     email: 'miri@example.com',    phone_number: null, home_address: 'Herzliya',  home_lat: null, home_lng: null, role: 'helper', helper_kind: 'grandparent',   color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-david',   magic_token: 'tok-david-8h3f5',   full_name: 'Saba David',     email: 'david@example.com',   phone_number: null, home_address: 'Kfar Saba', home_lat: null, home_lng: null, role: 'helper', helper_kind: 'grandparent',   color: null, email_enabled: true,  sms_enabled: false },
  { id: 'u-anna',    magic_token: 'tok-anna-6r1w4',    full_name: 'Anna (Nanny)',   email: 'anna@example.com',    phone_number: null, home_address: 'Tel Aviv',  home_lat: null, home_lng: null, role: 'helper', helper_kind: 'nanny',         color: null, email_enabled: true,  sms_enabled: false },
];

const LOCATIONS: Location[] = [
  { id: 'loc-home',    household_id: HOUSEHOLD_ID, label: 'Home',                         street: '14 Dizengoff St',   city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0774, lng: 34.7740, notes: null,                                     is_common: true },
  { id: 'loc-school',  household_id: HOUSEHOLD_ID, label: 'Tichon Hadash School',         street: '20 Weizmann St',    city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0853, lng: 34.7818, notes: 'Main gate on Weizmann',                  is_common: true },
  { id: 'loc-gan',     household_id: HOUSEHOLD_ID, label: 'Gan Shoshanim (Preschool)',    street: '8 Gordon St',       city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0832, lng: 34.7680, notes: 'Side gate for early pickup',             is_common: true },
  { id: 'loc-field',   household_id: HOUSEHOLD_ID, label: 'Gordon Field',                 street: 'Gordon Beach',      city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0836, lng: 34.7680, notes: 'Wait near the north gate',               is_common: true },
  { id: 'loc-dance',   household_id: HOUSEHOLD_ID, label: 'Suzanne Dellal Dance',         street: '5 Yechieli St',     city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0600, lng: 34.7625, notes: null,                                     is_common: true },
  { id: 'loc-music',   household_id: HOUSEHOLD_ID, label: 'Music Centre',                 street: '22 Rothschild Blvd',city: 'Tel Aviv', postal_code: null, country: 'IL', lat: 32.0647, lng: 34.7719, notes: null,                                     is_common: true },
];

const CHILDREN: Child[] = [
  { id: 'c-adam', household_id: HOUSEHOLD_ID, name: 'Adam', color: '#6BA3C5', school_name: 'Tichon Hadash',  school_location_id: 'loc-school', home_location_id: 'loc-home', notes: null },
  { id: 'c-liam', household_id: HOUSEHOLD_ID, name: 'Liam', color: '#7FA87D', school_name: 'Tichon Hadash',  school_location_id: 'loc-school', home_location_id: 'loc-home', notes: null },
  { id: 'c-yali', household_id: HOUSEHOLD_ID, name: 'Yali', color: '#E89070', school_name: 'Gan Shoshanim',  school_location_id: 'loc-gan',    home_location_id: 'loc-home', notes: null },
];

const ACTIVITIES: Activity[] = [
  { id: 'a-adam-school',   child_id: 'c-adam', title: 'School pickup',     default_pickup_location_id: 'loc-school', default_destination_location_id: 'loc-home',  weekday: null, start_time: null, end_time: null, notes: 'Main gate',           event_keyword: 'school' },
  { id: 'a-adam-football', child_id: 'c-adam', title: 'Football practice', default_pickup_location_id: 'loc-school', default_destination_location_id: 'loc-field', weekday: null, start_time: null, end_time: null, notes: 'Wait by north gate',  event_keyword: 'football' },
  { id: 'a-liam-school',   child_id: 'c-liam', title: 'School pickup',     default_pickup_location_id: 'loc-school', default_destination_location_id: 'loc-home',  weekday: null, start_time: null, end_time: null, notes: 'Main gate',           event_keyword: 'school' },
  { id: 'a-liam-music',    child_id: 'c-liam', title: 'Music lesson',      default_pickup_location_id: 'loc-music',  default_destination_location_id: 'loc-home',  weekday: null, start_time: null, end_time: null, notes: 'Ring the doorbell twice', event_keyword: 'music' },
  { id: 'a-yali-gan',      child_id: 'c-yali', title: 'Preschool pickup',  default_pickup_location_id: 'loc-gan',    default_destination_location_id: 'loc-home',  weekday: null, start_time: null, end_time: null, notes: 'Side gate',           event_keyword: 'gan' },
  { id: 'a-yali-dance',    child_id: 'c-yali', title: 'Dance class',       default_pickup_location_id: 'loc-dance',  default_destination_location_id: 'loc-home',  weekday: null, start_time: null, end_time: null, notes: null,                  event_keyword: 'dance' },
];

// ---------------------------------------------------------------------------
// Build a realistic week of slots from today's Sunday
// ---------------------------------------------------------------------------
type SlotSeed = {
  day: number; child: 'Adam' | 'Liam' | 'Yali';
  title: string; time: string; end: string | null;
  pickup: string | null; dest: string | null; notes: string | null;
  claimedBy?: string;
};

const SEEDS: SlotSeed[] = [
  { day: 1, child: 'Adam', title: 'School pickup',     time: '16:00', end: null,    pickup: 'loc-school', dest: 'loc-home',  notes: 'Main gate',                                  claimedBy: 'u-rachel' },
  { day: 1, child: 'Yali', title: 'Preschool pickup',  time: '13:30', end: null,    pickup: 'loc-gan',    dest: 'loc-home',  notes: 'Side gate for early pickup' },
  { day: 2, child: 'Adam', title: 'Football practice', time: '17:00', end: '18:30', pickup: 'loc-school', dest: 'loc-field', notes: 'Wait by north gate',                         claimedBy: 'u-yossi' },
  { day: 2, child: 'Liam', title: 'Music lesson',      time: '16:30', end: '17:30', pickup: 'loc-music',  dest: 'loc-home',  notes: 'Ring the doorbell twice' },
  { day: 3, child: 'Liam', title: 'School pickup',     time: '15:45', end: null,    pickup: null,         dest: 'loc-home',  notes: 'Calendar had no location — parent should fill' },
  { day: 3, child: 'Yali', title: 'Dance class',       time: '17:00', end: '18:00', pickup: 'loc-dance',  dest: 'loc-home',  notes: null,                                         claimedBy: 'u-anna' },
  { day: 4, child: 'Adam', title: 'School pickup',     time: '16:00', end: null,    pickup: 'loc-school', dest: 'loc-home',  notes: 'Main gate' },
  { day: 4, child: 'Liam', title: 'School pickup',     time: '15:45', end: null,    pickup: 'loc-school', dest: 'loc-home',  notes: 'Main gate',                                  claimedBy: 'u-miri' },
  { day: 5, child: 'Yali', title: 'Preschool pickup',  time: '12:30', end: null,    pickup: 'loc-gan',    dest: 'loc-home',  notes: 'Early Friday pickup' },
];

function buildSlots(): PickupSlot[] {
  // Align with defaultAnchor: on Fri/Sat we anchor to next Sunday so the
  // demo always shows a populated week.
  const now = new Date();
  const dow = now.getDay();
  const sun = startOfWeek(now, { weekStartsOn: 0 });
  const anchor = dow >= 5 ? addDays(sun, 7) : sun;
  return SEEDS.map((s, i): PickupSlot => {
    const date = format(addDays(anchor, s.day), 'yyyy-MM-dd');
    return {
      id: `slot-${i}`,
      household_id: HOUSEHOLD_ID,
      child_id: { Adam: 'c-adam', Liam: 'c-liam', Yali: 'c-yali' }[s.child],
      activity_id: null,
      source_event_id: null,
      source: 'manual',
      title: s.title,
      date,
      pickup_time: s.time + ':00',
      end_time: s.end ? s.end + ':00' : null,
      pickup_location_id: s.pickup,
      destination_location_id: s.dest,
      pickup_location_text: null,
      destination_text: null,
      notes: s.notes,
      parent_notes: null,
      status: s.claimedBy ? 'claimed' : 'unclaimed',
      reminder_sent_at: null,
      claim_cutoff_at: null,
    };
  });
}

// Mutable state (module-local — one instance per Node process)
let slots: PickupSlot[] = buildSlots();
let assignments: { slot_id: string; user_id: string }[] = SEEDS
  .map((s, i) => (s.claimedBy ? { slot_id: `slot-${i}`, user_id: s.claimedBy } : null))
  .filter(Boolean) as any;

// ---------------------------------------------------------------------------
// Public API used by pages + API routes when DEMO_MODE is on
// ---------------------------------------------------------------------------
export const DEMO = {
  householdId: HOUSEHOLD_ID,
  householdName: 'Roditi Family',
  timezone: 'Asia/Jerusalem',
};

export function allUsers(): Profile[] {
  return USERS;
}

export function getUser(id: string): Profile | null {
  return USERS.find((u) => u.id === id) ?? null;
}

export function findUserByEmail(email: string): Profile | null {
  return USERS.find((u) => u.email === email) ?? null;
}

export function findUserByToken(token: string): Profile | null {
  return USERS.find((u) => u.magic_token === token) ?? null;
}

export function tokenFor(userId: string): string | null {
  return USERS.find((u) => u.id === userId)?.magic_token ?? null;
}

export function listSlots(startISO: string, endISO: string): SlotView[] {
  return slots
    .filter((s) => s.date >= startISO && s.date < endISO)
    .sort((a, b) => (a.date + a.pickup_time).localeCompare(b.date + b.pickup_time))
    .map((s) => hydrate(s));
}

function hydrate(s: PickupSlot): SlotView {
  const child = CHILDREN.find((c) => c.id === s.child_id)!;
  const activity = ACTIVITIES.find((a) => a.id === s.activity_id) ?? null;
  const pickupLoc = s.pickup_location_id ? LOCATIONS.find((l) => l.id === s.pickup_location_id) ?? null : null;
  const destLoc = s.destination_location_id ? LOCATIONS.find((l) => l.id === s.destination_location_id) ?? null : null;
  const a = assignments.find((x) => x.slot_id === s.id);
  const assignment = a
    ? {
        id: `asg-${a.slot_id}`,
        pickup_slot_id: a.slot_id,
        assigned_to_user_id: a.user_id,
        assigned_by_user_id: null,
        assigned_at: new Date().toISOString(),
        released_at: null,
        status: 'active' as const,
        profile: getUser(a.user_id),
      }
    : null;
  return { ...s, child, activity, pickup_location: pickupLoc, destination_location: destLoc, assignment };
}

export function claimSlot(slotId: string, userId: string): { ok: boolean; error?: string } {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: 'Slot not found' };
  if (slot.status === 'claimed') return { ok: false, error: 'Already claimed' };
  assignments.push({ slot_id: slotId, user_id: userId });
  slot.status = 'claimed';
  return { ok: true };
}

export function unclaimSlot(slotId: string, userId: string): { ok: boolean; error?: string } {
  const i = assignments.findIndex((a) => a.slot_id === slotId && a.user_id === userId);
  if (i === -1) return { ok: false, error: 'You have not claimed this slot' };
  assignments.splice(i, 1);
  const slot = slots.find((s) => s.id === slotId);
  if (slot) slot.status = 'unclaimed';
  return { ok: true };
}

export function locations(): Location[] { return LOCATIONS; }
export function children(): Child[] { return CHILDREN; }
export function activities(): Activity[] { return ACTIVITIES; }

// ---------- Mutations used by admin forms ----------

export function createLocation(input: Partial<Location> & { label: string }): Location {
  const loc: Location = {
    id: `loc-${Math.random().toString(36).slice(2, 8)}`,
    household_id: HOUSEHOLD_ID,
    label: input.label,
    street: input.street ?? null,
    city: input.city ?? null,
    postal_code: null,
    country: input.country ?? 'IL',
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    notes: input.notes ?? null,
    is_common: !!input.is_common,
  };
  LOCATIONS.push(loc);
  return loc;
}

export function updateLocation(id: string, patch: Partial<Location>): Location | null {
  const i = LOCATIONS.findIndex((l) => l.id === id);
  if (i === -1) return null;
  LOCATIONS[i] = { ...LOCATIONS[i], ...patch };
  return LOCATIONS[i];
}

export function updateActivity(id: string, patch: Partial<Activity>): Activity | null {
  const i = ACTIVITIES.findIndex((a) => a.id === id);
  if (i === -1) return null;
  ACTIVITIES[i] = { ...ACTIVITIES[i], ...patch };
  return ACTIVITIES[i];
}

export function createSlot(input: {
  child_id: string;
  title: string;
  date: string;
  pickup_time: string;
  end_time?: string | null;
  pickup_location_id?: string | null;
  destination_location_id?: string | null;
  notes?: string | null;
}): PickupSlot {
  const slot: PickupSlot = {
    id: `slot-${Math.random().toString(36).slice(2, 8)}`,
    household_id: HOUSEHOLD_ID,
    child_id: input.child_id,
    activity_id: null,
    source_event_id: null,
    source: 'manual',
    title: input.title,
    date: input.date,
    pickup_time: input.pickup_time.length === 5 ? input.pickup_time + ':00' : input.pickup_time,
    end_time: input.end_time ? (input.end_time.length === 5 ? input.end_time + ':00' : input.end_time) : null,
    pickup_location_id: input.pickup_location_id ?? null,
    destination_location_id: input.destination_location_id ?? null,
    pickup_location_text: null,
    destination_text: null,
    notes: input.notes ?? null,
    parent_notes: null,
    status: 'unclaimed',
    reminder_sent_at: null,
    claim_cutoff_at: null,
  };
  slots.push(slot);
  return slot;
}

export function reassignSlot(slotId: string, userId: string, byUserId: string): { ok: boolean; error?: string } {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: 'Slot not found' };
  // release any existing
  const i = assignments.findIndex((a) => a.slot_id === slotId);
  if (i !== -1) assignments.splice(i, 1);
  assignments.push({ slot_id: slotId, user_id: userId });
  slot.status = 'claimed';
  return { ok: true };
}

export function clearAssignment(slotId: string): { ok: boolean } {
  const i = assignments.findIndex((a) => a.slot_id === slotId);
  if (i !== -1) assignments.splice(i, 1);
  const slot = slots.find((s) => s.id === slotId);
  if (slot) slot.status = 'unclaimed';
  return { ok: true };
}

type ReminderSettings = {
  morning_send_time: string;
  send_evening_before: boolean;
  evening_send_time: string;
  cutoff_time: string;
  parent_fallback_alert: boolean;
  timezone: string;
};

let reminderSettings: ReminderSettings = {
  morning_send_time: '07:30',
  send_evening_before: false,
  evening_send_time: '20:00',
  cutoff_time: '20:00',
  parent_fallback_alert: true,
  timezone: 'Asia/Jerusalem',
};

export function getReminderSettings(): ReminderSettings { return reminderSettings; }
export function updateReminderSettings(patch: Partial<ReminderSettings>): ReminderSettings {
  reminderSettings = { ...reminderSettings, ...patch };
  return reminderSettings;
}

// ---------- Slot event feed (admin "what's happened lately") ----------
export type DemoEvent = {
  id: string;
  kind: 'created' | 'claimed' | 'released' | 'reassigned' | 'unassigned' | 'updated';
  slot_id: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  created_at: string;
};

const events: DemoEvent[] = [];

export function logEvent(e: Omit<DemoEvent, 'id' | 'created_at'>) {
  events.unshift({ ...e, id: `ev-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString() });
  // cap to last 200 to avoid unbounded growth
  if (events.length > 200) events.length = 200;
}

export function recentEvents(limit = 20): DemoEvent[] {
  return events.slice(0, limit);
}

export function slotById(id: string): PickupSlot | null {
  return slots.find((s) => s.id === id) ?? null;
}

export function reset() {
  slots = buildSlots();
  assignments = SEEDS
    .map((s, i) => (s.claimedBy ? { slot_id: `slot-${i}`, user_id: s.claimedBy } : null))
    .filter(Boolean) as any;
}
