# Deploying Pickup Planner for real family use

You've already got a fully working demo at `http://localhost:3001` running on in-memory data. This file is the shopping list for turning that into a live app your grandparents can use on their phones.

**Total time, assuming no hiccups: ~90 minutes.** Nothing here requires code changes — it's all account creation + pasting credentials.

## 0. Before you start

You need:
- A GitHub account (for Vercel deploy)
- A credit card on file for Supabase & Vercel (both have generous free tiers — this app fits easily inside)
- 30–60 minutes of uninterrupted time

## 1. Supabase project (~20 min)

1. Sign up / log in at <https://supabase.com>.
2. New project → pick a region close to Israel (Frankfurt works well). Save the database password to 1Password.
3. Wait ~2 minutes for provisioning.
4. Open the project → **SQL Editor** → paste and run, in this order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_invites_and_events.sql`
5. Go to **Project Settings → API** and copy these three values:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`  (⚠️ keep server-side only)

## 2. Google OAuth — for Paula's Calendar only (~15 min)

The grandparents **don't** need Google accounts — they get personal magic links via email. You only need Google OAuth for Paula's calendar sync.

1. Go to <https://console.cloud.google.com/apis/credentials>, create a project called "Pickup Planner".
2. **OAuth consent screen**: External, fill in app name/support email.
3. **Create Credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs** (only these — for the calendar connect flow):
   - `http://localhost:3000/api/calendar/connect/callback`
   - `https://<your-vercel-subdomain>.vercel.app/api/calendar/connect/callback`
5. Save. Copy the **Client ID** and **Client secret** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
6. **Enable the Google Calendar API** at <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> (one click).

> The admins (Paula, Daniel) sign in with Supabase email magic-link (one-time code to inbox). The Google OAuth client above is *only* used by Paula to grant the app read access to her Calendar; it's not the sign-in path.

## 3. Seed the database (~5 min)

From your local terminal:
```bash
cd "/Users/dani/Claude Code/Pickup Planner"
# Replace .env.local demo-mode block with real values
cat > .env.local <<'EOF'
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=<your-value>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-value>
SUPABASE_SERVICE_ROLE_KEY=<your-value>
GOOGLE_CLIENT_ID=<your-value>
GOOGLE_CLIENT_SECRET=<your-value>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/calendar/connect/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<run: openssl rand -hex 32>
EOF
npm run seed
```
Expected output: `✓ Seed complete.` — creates Paula + Daniel + 4 grandparents + Anna the nanny, with a realistic week. Re-running is safe: it wipes and re-seeds the household (keeps auth users).

Restart the dev server (`npm run dev`) and sign in as `paula@example.com` / `PickupPlanner!2026`.

## 4. Resend for email reminders (~10 min)

1. Sign up at <https://resend.com>. Free tier = 3k emails/month.
2. **Add a domain** (ideally one you own, e.g. `bergman.family`) → follow the DNS instructions. For a quick start you can skip this and use the built-in sender address with the API key immediately — Resend's onboarding address works for testing.
3. Copy the API key → `RESEND_API_KEY`.
4. Set `REMINDER_FROM_EMAIL` to either your verified sender or `Pickup Planner <onboarding@resend.dev>` for testing.

## 5. Deploy to Vercel (~15 min)

1. Push the `Pickup Planner` directory to a new GitHub repo.
2. <https://vercel.com> → Import Git Repository → pick the repo.
3. **Environment Variables**: paste every key from your `.env.local` (but set `NEXT_PUBLIC_APP_URL` to your Vercel URL, and `GOOGLE_REDIRECT_URI` to `<your-vercel-url>/api/calendar/connect/callback`).
4. Deploy.
5. After deploy, go back to Google Cloud → edit the OAuth client → add the Vercel URL to authorized origins + redirect URIs (if you skipped it earlier).
6. The `vercel.json` I shipped registers the morning cron automatically. You can verify in **Project → Settings → Cron Jobs**.

## 6. Paula connects her calendar (~5 min)

1. Paula signs in at the deployed URL.
2. She goes to **Admin → Calendar → Connect Paula's Google Calendar**.
3. Completes Google OAuth (will see the Calendar scope request).
4. Back in Admin → Calendar, she clicks **↻ Sync now**. Slots should appear in the weekly view.
5. If an event doesn't become a slot, its title probably doesn't match any activity's `event_keyword`. Go to **Admin → Children & activities** and edit the keyword (e.g. the activity "Football practice" matches events containing "football").

## 7. Grandparents (~5 min)

The grandparent flow is now **link-only** — no sign-in, no passwords, no Google account needed.

1. After seeding, go to **Admin → Invites**. Each helper has a personal `https://yourapp/i/<token>` URL.
2. Hit **Send everyone their weekly link now** — each helper gets an email with their personal link. They tap it, and they're in.
3. The same link works forever (until you regenerate it). Tell them to **bookmark** it or **Add to Home Screen** on iOS for a one-tap icon.
4. Every Saturday at 09:00 (configurable in **Admin → Reminders**), the cron sends them a fresh email with the same link as a nudge to plan the week.

That's it. No Google, no password, no app store.

## 8. Verify the cron (~5 min)

To test the morning reminder path without waiting for 7:30 AM:
1. Temporarily change `reminder_settings.morning_send_time` in Supabase Studio to a time 2 minutes from now.
2. Wait for Vercel Cron to fire (runs every minute).
3. Check Supabase Studio → `notification_logs` table. You should see a `sent` row.
4. Reset `morning_send_time` to 07:30.

## 9. Optional hardening

- Change the seeded demo password — Paula & Daniel should reset their passwords on first login.
- Restrict RLS further if desired (e.g. only admins can view `notification_logs`).
- Consider adding an SMS fallback via Twilio by implementing `smsProvider` in `lib/notify.ts` and importing it alongside `emailProvider` in `app/api/cron/reminders/route.ts`.
- Turn off the demo mode toggle in deployed env (`DEMO_MODE=false`).

## Troubleshooting

**Grandparents can't sign in.** Check that Supabase → Authentication → Providers → Google is enabled AND that the redirect URI exactly matches what's in Google Cloud.

**Calendar sync runs but creates no slots.** Each event needs to match an activity's `event_keyword` substring (case-insensitive). Go to Admin → Children & activities and check keywords.

**Morning reminders aren't arriving.** Check `notification_logs` — `status = 'failed'` means Resend rejected it (usually: unverified sender). `status` missing entirely means the cron didn't fire at the right time; check `reminder_settings.morning_send_time` matches the household timezone's current minute.

**Re-seed needed.** Just run `npm run seed` again — it wipes and re-inserts the household's rows. Auth users are preserved.
