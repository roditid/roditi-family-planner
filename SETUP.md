# Setting up Roditi Family Planner for your family

This is a family pickup-planning app — built originally for the Roditi family
in Tel Aviv. It lets a household of admins (parents) coordinate weekly
pickups across grandparents, a nanny, and other helpers, all driven by a
shared Google Calendar.

If you're reading this it's because someone (👋 Paula) shared the repo so
your family can have one too. Setup takes ~30 minutes if you're comfortable
with services like Supabase + Vercel, or about an hour if Claude Code is
holding your hand through it.

**The fastest path: open this folder in Claude Code and say:**

> Read SETUP.md and walk me through setting this up for my family — I'm
> the [Smith] family with kids [Aria 5, Noah 3, Ben 7] and helpers
> [Grandma Rose, Grandpa Joe, our nanny Maria]. Help me create accounts,
> wire up the env vars, and replace the Roditi-specific data with mine.

Claude will do most of the work.

---

## What you'll need to create (free tier on all of these)

1. **Supabase project** — https://supabase.com → New project
   - This is the database + auth. ~5 min to create.
2. **Resend account** — https://resend.com → API keys
   - For email reminders. 3,000 emails/month free.
3. **Google Cloud OAuth credentials** — https://console.cloud.google.com
   - For Google Calendar sync (read + write events).
   - You'll create an OAuth Client ID + add yourself as a "test user".
4. **Vercel account** — https://vercel.com
   - For hosting. Connect to GitHub for auto-deploys.
5. **A domain** (optional) — Vercel gives you `<your-project>.vercel.app`
   for free. If you want a personal domain, GoDaddy / Namecheap / etc.

## Setup steps

### 1. Clone & install
```bash
git clone <this-repo-url>
cd <repo-dir>
npm install
```

### 2. Create your Supabase project
1. Go to https://supabase.com → New Project. Pick a name and region close to
   you (this matters for latency — the Roditi family uses `eu-central-1` /
   Frankfurt).
2. Once provisioned, open the project's **SQL Editor** and run each file
   in `supabase/migrations/` in order: `0001_init.sql`, `0002_rls.sql`, …
   through `0013_early_transit_backfill.sql`.
3. Open **Settings → API** and copy:
   - `URL` → goes into `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → goes into `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → goes into `SUPABASE_SERVICE_ROLE_KEY`
4. Open **Settings → Authentication → Providers**, enable **Email** with
   **Magic links** turned on.

### 3. Create a Resend API key
1. Sign up at https://resend.com.
2. **API Keys → Create API Key** → goes into `RESEND_API_KEY`.
3. (Optional) verify a domain so emails come from `family-planner@yourdomain`
   instead of `onboarding@resend.dev`. Default works fine for testing.

### 4. Create Google OAuth credentials
1. Go to https://console.cloud.google.com → New Project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External, fill in app
   name and email. Add the **Calendar** scope:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
4. **Audience → Test users** → add the Gmail addresses that will sign in
   (yours + any helpers / a dedicated kids' calendar account).
5. **APIs & Services → Credentials → + Create Credentials → OAuth client
   ID** → Web application:
   - Authorized redirect URIs (one per environment):
     - `http://localhost:3000/api/calendar/connect/callback`
     - `http://localhost:3000/auth/callback`
     - `https://<your-app>.vercel.app/api/calendar/connect/callback`
     - `https://<your-app>.vercel.app/auth/callback`
6. Copy the Client ID + Secret → goes into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

### 5. Configure `.env.local`
```bash
cp .env.example .env.local
# Fill in every blank with the values from the previous steps.
```

### 6. Customize the family data
This is where Claude Code earns its keep. Things hardcoded for the Roditi
family that need to become yours:

- **Household / kids / locations** — in `supabase/migrations/0005_seed_real_data.sql`
  and `0006_cleanup_duplicates.sql`. Either edit those before running, or
  add a new `0014_my_family_data.sql` that overrides them.
- **Per-child special logic** — search the codebase for these names and
  replace with yours where appropriate:
  - `Yali`, `Liam`, `Adam` (children's names)
  - `Vovo`, `Tataia`, `Nonna`, `Liezel` (helper slugs)
  - `Roditi` (household name)
  - `roditi.ch` (the production URL, in `NEXT_PUBLIC_APP_URL`)
  - `Tel Aviv` / `'Asia/Jerusalem'` (timezone, in `lib/google/calendar.ts`
    and the household record)
- **Stroller note** in `components/SlotDetailModal.tsx` — currently
  hardcoded to remind helpers to ask Dani about a stroller for Yali. If
  your family has a similar one-kid-needs-X situation, adapt; otherwise
  delete the `<StrollerNote />` block.
- **Photos** — drop your kid photos at `public/kids/<name>.jpg` and
  the per-child color in the `children` table.

A good Claude Code prompt:

> Find every Roditi/Yali/Liam/Adam/Vovo/Tataia/Nonna/Liezel reference in
> the codebase. For each one, ask me what to replace it with for my
> family, then make all the edits.

### 7. Run locally
```bash
npm run dev
```
Visit `http://localhost:3000`. Sign in with your email (you'll get a
magic link via Resend).

### 8. Deploy to Vercel
1. Push to a GitHub repo.
2. https://vercel.com/new → Import the repo.
3. Add every variable from `.env.local` to **Project Settings → Environment
   Variables** (Production + Preview).
4. **Important** — set the function region in `vercel.json` to be near
   your Supabase region (`fra1` for Frankfurt, `iad1` for US East,
   `sin1` for Singapore, etc.). The Roditi default is `fra1`.
5. Update `NEXT_PUBLIC_APP_URL` in Vercel env to your final domain (e.g.
   `https://<your-app>.vercel.app` or your custom domain).
6. Update the Google OAuth redirect URIs to match your final domain.

That's it. Open `https://<your-app>.vercel.app` and your family planner
is live.

## What you get out of the box

- Weekly schedule of pickups, claimable by tap from grandparents'
  personal links (`/<helper-slug>`)
- Google Calendar sync — events titled `Soccer - Liam` / `Judo - Adam`
  become pickup slots automatically
- Auto-generated daily Gan→Home defaults (combined siblings on one trip)
- Special calendar patterns: `[Kid] - No gan`, `[Kid] - gan until 12:30`,
  `prep day for tomorrow`, `[Helper Name] Activity - Kid` (auto-claim)
- Email reminders (Resend) — Saturday reminder for grandparents,
  Sunday summary for admins, evening backpack reminder for parents +
  nanny
- WhatsApp deep-links for messages that need a real person to send them
  (we haven't wired automated WhatsApp because Twilio costs money)

## Roadmap items the Roditis haven't built yet

See `ROADMAP.md` in this folder. Open with Claude Code and grab any of
them as your next project.

## Questions / debugging

The codebase is heavily commented — open any file you're confused about
and Claude can explain it. Things to check first if something breaks:
- `vercel logs <deployment-url>` for runtime errors
- Supabase **Logs → Postgres** for SQL errors
- `/admin/calendar` page for sync status (last error message shows there)

Good luck. — The Roditis 💚
