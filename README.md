# Pickup Planner

A warm, mobile-first web app that helps the Bergman family split kid pickups across grandparents and a nanny. Grandparents see the week, tap **Claim**, and get an email reminder the morning of — with the child, the time, and the exact pickup/drop-off location.

**Family:** Paula & Daniel (admins), Adam / Liam / Yali (kids), 4 grandparents + 1 nanny.

Paula's Google Calendar is the schedule source; both Paula and Daniel are full admins inside the app regardless of who owns the Google connection.

---

## Setup

### 1. Install
```bash
cd "Pickup Planner"
npm install
cp .env.example .env    # then fill in values (see below)
```

### 2. Create the Supabase project
1. Create a new project at <https://supabase.com>.
2. In **SQL Editor**, paste and run in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_rls.sql`
3. In **Authentication → Providers**, enable **Google** and add:
   - `http://localhost:3000/auth/callback`
   - `<your-deployed-url>/auth/callback`
4. Copy `Project URL`, `anon` key, and `service_role` key into `.env`.

### 3. Seed demo data
```bash
npm run seed
```
Creates the household, all users (password: `PickupPlanner!2026`), children, activities, locations, and a realistic week of pickup slots with one pre-unclaimed slot + one missing-location fallback case.

### 4. Connect Paula's Google Calendar
1. Create an OAuth client at <https://console.cloud.google.com/apis/credentials>.
2. Authorized redirect URIs:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/api/calendar/connect/callback`
3. Fill `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in `.env`.
4. Sign in as Paula, go to **Admin → Calendar**, click **Connect**.

### 5. Email reminders (Resend)
1. Sign up at <https://resend.com> (free tier is plenty).
2. Verify a sender domain, or use the onboarding address for testing.
3. Fill `RESEND_API_KEY` and `REMINDER_FROM_EMAIL` in `.env`.

### 6. Run
```bash
npm run dev
```
Open <http://localhost:3000>. Log in as `paula@example.com` / `PickupPlanner!2026` for admin, or any helper email for the grandparent view.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (seed + cron only) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth for calendar sync |
| `GOOGLE_REDIRECT_URI` | `<app>/api/calendar/connect/callback` |
| `RESEND_API_KEY` | Email provider for morning reminders |
| `REMINDER_FROM_EMAIL` | From-address for reminders |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | (optional) map previews, travel estimates |
| `NEXT_PUBLIC_APP_URL` | Absolute URL for redirects |
| `CRON_SECRET` | Guards `/api/cron/reminders`; set long + random |
| `TWILIO_*` | (optional) SMS swap-in for `lib/notify.ts` |

---

## Morning reminders — scheduled job

The endpoint `GET /api/cron/reminders?secret=<CRON_SECRET>` is designed to run **every minute** and only fires when the current time in the household's timezone matches `reminder_settings.morning_send_time`.

- **Vercel Cron:** `vercel.json` wires this up automatically on deploy.
- **Anywhere else:** add a cron/systemd timer that curls the URL once per minute.
- **Local dev:** run `curl "http://localhost:3000/api/cron/reminders?secret=..."` manually to test.

Idempotency: each slot has a `reminder_sent_at` flag; the job skips already-notified slots.

---

## What's complete vs. stubbed

### ✅ Complete
- Next.js 14 App Router + Tailwind + Supabase Auth (Google OAuth + email magic link)
- Full schema (12 tables), household-scoped RLS, auto-create-profile trigger
- Seeded demo household: Bergman family with realistic week, colors per child, claimed + unclaimed states, one deliberate missing-location fallback
- Landing → Login → My pickups → Available week → Admin overview flow
- Slot cards with large type, pickup + drop-off, Maps link, Claim/Unclaim (one tap)
- Child filter chips + week-forward/back navigation
- Admin overview with warnings (unclaimed / missing location), week grid, manual sync
- Admin pages: Calendar, Children & activities, Locations, Helpers, Reminders (with live preview)
- Google Calendar OAuth connect flow + event → pickup_slot sync (keyword-matched, deduped, fallback-location aware)
- Email reminders via Resend, `notify.ts` provider abstraction (Twilio drops in without touching the cron)
- Morning cron endpoint with per-household timezone handling, notification logging, and parent-fallback alert

### 🧩 Stubbed / intentionally minimal (easy to extend)
- **Admin CRUD forms.** Add/edit UI for children, activities, locations, and manual slot creation is scaffolded but read-only — use Supabase Studio for edits in v1.
- **Assignment override UI.** The `POST /api/slots/[id]/assign` endpoint exists; the admin dashboard hasn't wired a helper-picker to it yet.
- **Travel estimates.** `home_lat/lng` is stored on profiles, Google Maps key is in env — the distance calculation isn't wired to the slot card.
- **Hebrew/RTL.** `locale` is on the household row but not yet used for UI.
- **WhatsApp / SMS.** `notify.ts` is provider-agnostic; add a `twilioProvider` and swap the import in `cron/reminders/route.ts`.
- **Export weekly plan / parent-only notes** — schema supports them (`parent_notes`), UI surface is pending.

### 🔐 Permissions & ownership
- **Paula**: admin + sole calendar connection owner. Only she completes the Google OAuth.
- **Daniel**: admin, full parity on every other action. He can trigger syncs, override assignments, edit settings, etc. — his rights come from `household_members.role = 'admin'`, independent of calendar ownership.
- **Helpers (grandparents + nanny)**: can read household data, claim unclaimed slots, release their own active assignments. RLS enforces all of this at the database layer.

---

## File map

```
app/
  page.tsx                        landing
  login/                          sign in (Google + magic link)
  auth/callback/                  Supabase OAuth return
  (app)/
    layout.tsx                    app shell (header/footer)
    my-pickups/                   default grandparent landing
    pickups/                      weekly claim view
    admin/                        admin dashboard + settings tabs
  api/
    auth/signout/                 server signout
    slots/[id]/claim|unclaim|assign
    calendar/connect|connect/callback|sync
    cron/reminders                morning job
lib/
  supabase/{client,server,admin}  three client flavors
  google/calendar.ts              OAuth + event → slot sync
  notify.ts                       provider-agnostic reminders + copy
  slots.ts                        hydrated slot fetch + maps href
  permissions.ts                  getSessionContext / requireAdmin
  types.ts, week.ts
components/
  SlotCard.tsx                    the main card grandparents interact with
  ClaimButton.tsx                 one-tap claim/unclaim
  WeekNav.tsx                     prev/next week
supabase/migrations/
  0001_init.sql                   schema
  0002_rls.sql                    household-scoped RLS
scripts/seed.ts                   Bergman family demo data
vercel.json                       cron config
```

---

## Design notes

- Cream (#FBF6EC) base; sage-500 primary; coral-500 accents.
- Each child has a persistent color — shown as a left stripe on every card and as chip backgrounds for instant scanning.
- Type scale is deliberately large (17px base, 30–36px times, 24px titles) for grandparent readability; tap targets are min 44×44.
- Buttons are rounded-2xl with shadow-card, avoiding the stiff-institutional look.
- Light mode only — this is a family app, not a finance dashboard.

---

## Open design calls I made for you

1. **Email over SMS** for v1. Resend is a free, 5-minute setup; grandparents already use email; SMS adds phone-verification friction. Swap via `lib/notify.ts` whenever you want.
2. **One claim, not a queue.** Helpers either claim or they don't. No "interested" or "I can if nobody else can" state — keeps the UI obvious.
3. **Sunday-first week** (Israeli norm) — see `lib/week.ts`. Flip `weekStartsOn` if you want Monday.
4. **Keyword-matched activities**. Calendar event titles are matched to activities via `activity.event_keyword`. Simpler than rule builders, easy to tune.

Ping me when you've run the migrations and seed, and I'll walk through any tweaks.
