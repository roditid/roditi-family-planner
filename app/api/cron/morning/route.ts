/**
 * 07:00 IL master cron — dispatches the early-morning jobs.
 *
 * Vercel Hobby caps cron jobs at 2. This is one of them. The other is
 * /api/cron/saturday-morning (Saturday-only roundup at 10:00 IL).
 *
 * Fires every day at 04:00 UTC = 07:00 IL:
 *   • sync-calendar  — refreshes upcoming slots, renews live watch
 *   • reminders      — morning-of pickup notifications
 *   • sunday-summary — admin recap with full week + Liezel WA button
 *                      (only on Sundays)
 *
 * Each sub-cron is still independently callable for manual triggers.
 *
 * Watchdog: if sync-calendar reports an error (e.g. invalid_grant when
 * Google access expires), every admin gets a "calendar connection
 * broken" email with a reconnect link. Fires at most once per day
 * (this cron runs once per day), which is the right cadence — the last
 * outage went unnoticed for days because nothing alerted anyone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendAndLog } from '@/lib/notify-log';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  if (!secret || url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roditi.ch';
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
  }).formatToParts(new Date()).find((p) => p.type === 'weekday')?.value ?? '';

  const jobs: string[] = ['sync-calendar', 'reminders'];
  if (weekday === 'Sun') jobs.push('sunday-summary');

  const results: any[] = [];
  for (const job of jobs) {
    try {
      const r = await fetch(`${baseUrl}/api/cron/${job}?secret=${encodeURIComponent(secret)}`, {
        cache: 'no-store',
      });
      const body = await r.json().catch(() => ({}));
      results.push({ job, status: r.status, body });
    } catch (e: any) {
      results.push({ job, error: e?.message ?? String(e) });
    }
  }

  // ── Calendar watchdog ──
  const syncResult = results.find((r) => r.job === 'sync-calendar');
  const syncErrors: { household: string; error: string }[] =
    (syncResult?.body?.results ?? []).filter((r: any) => r.error);
  let watchdogSent = 0;
  if (syncErrors.length > 0) {
    try {
      watchdogSent = await alertAdminsCalendarBroken(baseUrl, syncErrors);
    } catch (e) {
      console.error('calendar watchdog failed', e);
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), weekday, results, watchdogSent });
}

/** Email every admin of every broken household with a reconnect link. */
async function alertAdminsCalendarBroken(
  baseUrl: string,
  syncErrors: { household: string; error: string }[]
): Promise<number> {
  const sb = supabaseAdmin();
  let sent = 0;
  for (const { household, error } of syncErrors) {
    const isAuthError = /invalid_grant|unauthorized|invalid_client/i.test(error);
    const { data: members } = await sb
      .from('household_members')
      .select('profiles:user_id(full_name, email, email_enabled)')
      .eq('household_id', household)
      .eq('role', 'admin');
    const admins = (members ?? [])
      .map((m: any) => m.profiles)
      .filter((p: any) => p && p.email && p.email_enabled !== false);

    const subject = isAuthError
      ? '⚠️ Calendar connection broken — pickups are not syncing'
      : '⚠️ Calendar sync failed this morning';
    const fixSteps = isAuthError
      ? `Google has revoked the calendar access (this happens after a password change or ~6 months of inactivity). To fix:\n\n1. Open ${baseUrl}/admin/calendar\n2. Tap "Reconnect Google account" and sign in as Paula\n3. Tap "Sync now" to confirm it works\n4. Tap "Enable live sync" to restore instant updates`
      : `This morning's calendar sync failed with:\n\n    ${error}\n\nIf it happens again tomorrow, open ${baseUrl}/admin/calendar and try "Sync now" — the error message there will say more.`;
    const body = `Heads up — the website couldn't read the kids' Google Calendar this morning, so new events and edits are NOT flowing into the planner.\n\n${fixSteps}\n\n— Roditi Family Planner (automatic watchdog)`;
    const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22">` +
      `<p><b>Heads up</b> — the website couldn't read the kids' Google Calendar this morning, so new events and edits are <b>not</b> flowing into the planner.</p>` +
      (isAuthError
        ? `<p>Google has revoked the calendar access (this happens after a password change or ~6 months of inactivity).</p>` +
          `<p style="margin-top:1.2em"><a href="${baseUrl}/admin/calendar" style="display:inline-block;background:#E89070;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Reconnect the calendar →</a></p>` +
          `<p style="font-size:13px;color:#777">Sign in as Paula, approve access, then tap "Sync now" and "Enable live sync".</p>`
        : `<p>The error was: <code style="background:#f6f3ec;padding:2px 6px;border-radius:4px">${escapeHtml(error)}</code></p>` +
          `<p style="margin-top:1.2em"><a href="${baseUrl}/admin/calendar" style="display:inline-block;background:#5C7A5F;color:#FBF6EC;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600">Open calendar settings →</a></p>`) +
      `<p style="font-size:11px;color:#9a9889;margin-top:1.6em">— Roditi Family Planner (automatic watchdog, checks every morning)</p>` +
      `</div>`;

    for (const a of admins) {
      const r = await sendAndLog(sb, { household_id: household, to: a.email, subject, body, html });
      if (!r.error) sent++;
    }
  }
  return sent;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
