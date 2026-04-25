# Pickup Planner — Roadmap

Running list of things Paula and Dani want to add. Pulled from the chat
sessions; updated as items ship.

## Open

### 1. Dedicated kids' Google Calendar (single source of truth)
**Why:** Paula wants a separate email account for the kids' events so it's
not mixed into her personal calendar. Every event there is the canonical
record — address, ganenet phone, door code, notes — and any change to the
event in that calendar flows into Pickup Planner automatically.

**What to build:**
- Onboarding step: Paula creates a new Google account (e.g. `roditi.kids@gmail.com`),
  reconnects `/admin/calendar` against that account.
- Calendar import: read structured event metadata —
  - `event.location` → already used as fallback; promote to first-class. If
    the location string matches a known location label, link the slot to it;
    otherwise create a new location entry on the fly.
  - `event.description` → parse for "Phone:", "Code:", "Note:" lines and
    merge them into the location's notes (or per-slot notes).
- Re-sync should refresh location data when the source event changes.

### 2. Birthday parties / Gan events / holidays on the kids' calendar
**Why:** Same calendar holds non-Gan events (a friend's birthday, a Gan
ceremony, a holiday picnic). They should show up in Pickup Planner alongside
regular pickups so the helpers see the full week.

**What to build:**
- Loosen the calendar matcher so events that don't match "Activity - Kid"
  pattern still create slots (using the event title as-is, location from
  `event.location`).
- Tag slots by event-kind in the UI (regular, birthday, holiday, ceremony)
  with subtle visual differentiation — different chip background or icon.
- Possibly: "RSVP-only" events that just appear as info, no helper required.

### 3. End-of-day backpack reminder
**Why:** Helpers (especially Liezel) need a heads-up the night before so
they pack the right gear in the kids' backpacks: judo uniform if Liam has
judo tomorrow, fancy clothes for a Pesach celebration, a special lunchbox
for a Gan holiday.

**What to build:**
- Per-activity "what to pack" notes on the Activities table (e.g. Judo →
  "judo uniform"). Already partially supported via `activities.notes`.
- Per-event one-off notes in the Google Calendar event description (e.g.
  "fancy clothes for Pesach"). Calendar import should pull these into
  `slot.parent_notes` (admin-visible) or a new `pack_notes` field.
- Daily evening cron (~20:00 Israel) → for each upcoming-tomorrow slot with
  pack notes, send Paula + Liezel a single consolidated reminder:
  > Tomorrow's backpacks:
  > • Liam — judo uniform (Judo at 16:15)
  > • Yali — fancy clothes (Pesach celebration at Gan)
- Channel: same as the rest of the notification stack (email today,
  WhatsApp/SMS once that's set up).

## Decisions still open

- **Notification channel** — currently email. Twilio SMS or Twilio WhatsApp
  on the table; Paula deciding.
- **Photo of Yali** — currently shrunk in CSS so framing matches the boys.
  Could re-crop the source file for a cleaner result.

## Recently shipped (most recent first)

- Calendar event title prefix on claim/unclaim/reassign — Paula's calendar
  shows `[Helper] Activity - Kid` immediately. Requires re-authorization
  with the new write scope at `/admin/calendar`.
- Sunday-morning summary cron to admins, Saturday-evening reminder cron to
  grandparents only, Liezel auto-summary on every assignment change.
- 2-kid Gan→Home combos start with Yali (earliest dismissal).
- Per-child photo framing tweak (Yali unzoomed).
- Combined-trip title is just "Home" (kid names already on the chip).
- Share message strips door codes/ganenet from each stop — name + address only.
- Schedule view scrolls 28 days forward, no past dates, empty days collapsed.
- /admin/unassigned page with bulk-assignment dropdowns.
- Multi-stop slots (pickup → via → destination) for Gan→Activity→Home.
- Sibling-combine for Gan→Home defaults (auto-generated for next 21 weekdays).
- Per-kid `gan_dismissal_time` populated, used for slot pickup_time.
- Real Roditi-family data seeded: Ganim, activity locations, kid photos.
