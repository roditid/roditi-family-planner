/**
 * Seed Pickup Planner with the Bergman family demo data.
 *
 * Fully idempotent: wipes rows belonging to the demo household, then
 * re-inserts. Safe to run repeatedly during setup.
 *
 *   Paula  — parent/admin (connected Google Calendar owner)
 *   Daniel — parent/admin
 *   Helpers: 4 grandparents + 1 nanny
 *   Kids: Adam, Liam, Yali
 *
 * Run AFTER applying migrations 0001_init.sql and 0002_rls.sql.
 *   npm run seed
 */
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { addDays, format, startOfWeek } from 'date-fns';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey || url.includes('localhost:54321')) {
  console.error('This script needs real Supabase credentials in .env.');
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must point at your project.');
  process.exit(1);
}
const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const DEMO_PASSWORD = 'PickupPlanner!2026';
const HOUSEHOLD_NAME = 'Bergman Family';

type SeedUser = {
  email: string;
  full_name: string;
  role: 'admin' | 'helper';
  helper_kind?: 'grandparent' | 'nanny';
  home?: string;
};

const USERS: SeedUser[] = [
  { email: 'paula@example.com', full_name: 'Paula Bergman', role: 'admin' },
  { email: 'daniel@example.com', full_name: 'Daniel Bergman', role: 'admin' },
  { email: 'savta.rachel@example.com', full_name: 'Savta Rachel', role: 'helper', helper_kind: 'grandparent', home: 'Ramat Aviv, Tel Aviv' },
  { email: 'saba.yossi@example.com',   full_name: 'Saba Yossi',   role: 'helper', helper_kind: 'grandparent', home: 'Ramat Gan' },
  { email: 'savta.miri@example.com',   full_name: 'Savta Miri',   role: 'helper', helper_kind: 'grandparent', home: 'Herzliya' },
  { email: 'saba.david@example.com',   full_name: 'Saba David',   role: 'helper', helper_kind: 'grandparent', home: 'Kfar Saba' },
  { email: 'nanny.anna@example.com',   full_name: 'Anna (Nanny)', role: 'helper', helper_kind: 'nanny',       home: 'Tel Aviv' },
];

async function findOrCreateUser(u: SeedUser): Promise<string> {
  // Paginate through auth.users — Supabase's admin listUsers is paginated.
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((x) => x.email === u.email);
    if (found) return found.id;
    if (data.users.length < 200) break;
    page++;
  }
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (error) throw error;
  return data.user!.id;
}

async function main() {
  console.log('→ creating auth users');
  const ids: Record<string, string> = {};
  for (const u of USERS) ids[u.email] = await findOrCreateUser(u);

  console.log('→ creating/finding household');
  const { data: existing, error: selErr } = await sb.from('households').select('*').eq('name', HOUSEHOLD_NAME).maybeSingle();
  if (selErr) { console.error('  household select failed:', selErr); process.exit(1); }
  let household = existing;
  if (!household) {
    const { data, error } = await sb.from('households').insert({ name: HOUSEHOLD_NAME, timezone: 'Asia/Jerusalem' }).select().single();
    if (error) { console.error('  household insert failed:', error); process.exit(1); }
    household = data!;
  }
  const householdId = household.id;

  console.log('→ wiping old demo rows in this household (keeping auth users)');
  // Deletion order respects FKs.
  await sb.from('slot_assignments').delete().in('pickup_slot_id',
    (await sb.from('pickup_slots').select('id').eq('household_id', householdId)).data?.map((r) => r.id) ?? ['__none__']);
  await sb.from('pickup_slots').delete().eq('household_id', householdId);
  await sb.from('calendar_events').delete().eq('household_id', householdId);
  await sb.from('activities').delete().in('child_id',
    (await sb.from('children').select('id').eq('household_id', householdId)).data?.map((r) => r.id) ?? ['__none__']);
  await sb.from('children').delete().eq('household_id', householdId);
  await sb.from('locations').delete().eq('household_id', householdId);
  await sb.from('connected_calendars').delete().eq('household_id', householdId);
  await sb.from('reminder_settings').delete().eq('household_id', householdId);
  await sb.from('household_members').delete().eq('household_id', householdId);

  console.log('→ profiles + memberships');
  for (const u of USERS) {
    const token = randomToken(u.full_name);
    await sb.from('profiles').upsert({
      id: ids[u.email],
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      helper_kind: u.helper_kind ?? null,
      home_address: u.home ?? null,
      email_enabled: true,
      magic_token: token,
      token_issued_at: new Date().toISOString(),
    });
    await sb.from('household_members').insert({
      household_id: householdId,
      user_id: ids[u.email],
      role: u.role,
      helper_kind: u.helper_kind ?? null,
    });
  }

  console.log('→ locations');
  const locDefs = [
    { label: 'Home',                        street: '14 Dizengoff St',      city: 'Tel Aviv', lat: 32.0774, lng: 34.7740, is_common: true,  notes: null },
    { label: 'Tichon Hadash School',        street: '20 Weizmann St',       city: 'Tel Aviv', lat: 32.0853, lng: 34.7818, is_common: true,  notes: 'Main gate on Weizmann' },
    { label: 'Gan Shoshanim (Preschool)',   street: '8 Gordon St',          city: 'Tel Aviv', lat: 32.0832, lng: 34.7680, is_common: true,  notes: 'Side gate for early pickup' },
    { label: 'Gordon Field',                street: 'Gordon Beach',         city: 'Tel Aviv', lat: 32.0836, lng: 34.7680, is_common: true,  notes: 'Wait near the north gate' },
    { label: 'Suzanne Dellal Dance',        street: '5 Yechieli St',        city: 'Tel Aviv', lat: 32.0600, lng: 34.7625, is_common: true,  notes: null },
    { label: 'Music Centre',                street: '22 Rothschild Blvd',   city: 'Tel Aviv', lat: 32.0647, lng: 34.7719, is_common: true,  notes: null },
  ];
  const L: Record<string, string> = {};
  for (const l of locDefs) {
    const { data } = await sb.from('locations').insert({ household_id: householdId, ...l }).select().single();
    L[l.label] = data!.id;
  }

  console.log('→ children');
  const kidDefs = [
    { name: 'Adam', color: '#6BA3C5', school_name: 'Tichon Hadash',  school_location: 'Tichon Hadash School' },
    { name: 'Liam', color: '#7FA87D', school_name: 'Tichon Hadash',  school_location: 'Tichon Hadash School' },
    { name: 'Yali', color: '#E89070', school_name: 'Gan Shoshanim',  school_location: 'Gan Shoshanim (Preschool)' },
  ];
  const K: Record<string, string> = {};
  for (const k of kidDefs) {
    const { data } = await sb.from('children').insert({
      household_id: householdId,
      name: k.name,
      color: k.color,
      school_name: k.school_name,
      school_location_id: L[k.school_location],
      home_location_id: L['Home'],
    }).select().single();
    K[k.name] = data!.id;
  }

  console.log('→ activities');
  const activities = [
    { child: 'Adam', title: 'School pickup',     pickup: 'Tichon Hadash School',    dest: 'Home',         notes: 'Main gate',               keyword: 'school' },
    { child: 'Adam', title: 'Football practice', pickup: 'Tichon Hadash School',    dest: 'Gordon Field', notes: 'Wait by north gate',      keyword: 'football' },
    { child: 'Liam', title: 'School pickup',     pickup: 'Tichon Hadash School',    dest: 'Home',         notes: 'Main gate',               keyword: 'school' },
    { child: 'Liam', title: 'Music lesson',      pickup: 'Music Centre',            dest: 'Home',         notes: 'Ring doorbell',           keyword: 'music' },
    { child: 'Yali', title: 'Preschool pickup',  pickup: 'Gan Shoshanim (Preschool)', dest: 'Home',       notes: 'Side gate',               keyword: 'gan' },
    { child: 'Yali', title: 'Dance class',       pickup: 'Suzanne Dellal Dance',    dest: 'Home',         notes: null,                      keyword: 'dance' },
  ];
  for (const a of activities) {
    await sb.from('activities').insert({
      child_id: K[a.child],
      title: a.title,
      default_pickup_location_id: L[a.pickup],
      default_destination_location_id: L[a.dest],
      notes: a.notes,
      event_keyword: a.keyword,
    });
  }

  console.log('→ connected calendar (placeholder for Paula)');
  await sb.from('connected_calendars').insert({
    household_id: householdId,
    owner_user_id: ids['paula@example.com'],
    google_account_email: 'paula@example.com',
    selected_calendar_ids: JSON.stringify(['primary']),
    last_sync_status: 'not yet connected — complete Google OAuth in Admin → Calendar',
  });

  console.log('→ reminder settings');
  await sb.from('reminder_settings').insert({
    household_id: householdId,
    morning_send_time: '07:30',
    cutoff_time: '20:00',
    timezone: 'Asia/Jerusalem',
  });

  console.log('→ pickup slots for this week');
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const iso = (d: Date) => format(d, 'yyyy-MM-dd');

  const slots = [
    { day: 1, child: 'Adam', title: 'School pickup',     time: '16:00', end: null,    pickup: 'Tichon Hadash School',      dest: 'Home',         notes: 'Main gate' },
    { day: 1, child: 'Yali', title: 'Preschool pickup',  time: '13:30', end: null,    pickup: 'Gan Shoshanim (Preschool)', dest: 'Home',         notes: 'Side gate for early pickup' },
    { day: 2, child: 'Adam', title: 'Football practice', time: '17:00', end: '18:30', pickup: 'Tichon Hadash School',      dest: 'Gordon Field', notes: 'Wait by north gate' },
    { day: 2, child: 'Liam', title: 'Music lesson',      time: '16:30', end: '17:30', pickup: 'Music Centre',              dest: 'Home',         notes: 'Ring doorbell twice' },
    { day: 3, child: 'Liam', title: 'School pickup',     time: '15:45', end: null,    pickup: null,                         dest: 'Home',         notes: 'Calendar had no location — using school default' },
    { day: 3, child: 'Yali', title: 'Dance class',       time: '17:00', end: '18:00', pickup: 'Suzanne Dellal Dance',      dest: 'Home',         notes: null },
    { day: 4, child: 'Adam', title: 'School pickup',     time: '16:00', end: null,    pickup: 'Tichon Hadash School',      dest: 'Home',         notes: 'Main gate' },
    { day: 4, child: 'Liam', title: 'School pickup',     time: '15:45', end: null,    pickup: 'Tichon Hadash School',      dest: 'Home',         notes: 'Main gate' },
    { day: 5, child: 'Yali', title: 'Preschool pickup',  time: '12:30', end: null,    pickup: 'Gan Shoshanim (Preschool)', dest: 'Home',         notes: 'Early Friday pickup' },
  ];

  const slotIds: string[] = [];
  for (const s of slots) {
    const { data } = await sb.from('pickup_slots').insert({
      household_id: householdId,
      child_id: K[s.child],
      title: s.title,
      source: 'manual',
      date: iso(addDays(monday, s.day - 1)),
      pickup_time: s.time,
      end_time: s.end,
      pickup_location_id: s.pickup ? L[s.pickup] : null,
      destination_location_id: L[s.dest],
      notes: s.notes,
      status: 'unclaimed',
    }).select().single();
    slotIds.push(data!.id);
  }

  const preClaims = [
    { i: 0, user: 'savta.rachel@example.com' },
    { i: 2, user: 'saba.yossi@example.com' },
    { i: 5, user: 'nanny.anna@example.com' },
    { i: 7, user: 'savta.miri@example.com' },
  ];
  for (const c of preClaims) {
    await sb.from('slot_assignments').insert({
      pickup_slot_id: slotIds[c.i],
      assigned_to_user_id: ids[c.user],
      status: 'active',
    });
    await sb.from('pickup_slots').update({ status: 'claimed' }).eq('id', slotIds[c.i]);
  }

  console.log('\n✓ Seed complete (fully re-runnable).');
  console.log('  Household:', householdId);
  console.log('  Demo password (all users):', DEMO_PASSWORD);
  console.log('  Sign in as paula@example.com for admin, any helper email for grandparent view.');
}

function randomToken(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  const rand = [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => b.toString(36).padStart(2, '0').slice(-2))
    .join('')
    .slice(0, 16);
  return `${slug}-${rand}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
