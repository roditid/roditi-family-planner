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
 */
import { NextRequest, NextResponse } from 'next/server';

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

  return NextResponse.json({ ran_at: new Date().toISOString(), weekday, results });
}
