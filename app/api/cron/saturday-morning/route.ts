/**
 * Saturday 10:00 IL cron — dispatches the helper-roundup email.
 *
 * Vercel Hobby caps cron jobs at 2. This is the second slot. Fires
 * every day at 07:00 UTC = 10:00 IL, but the underlying job runs only
 * on Saturdays — other days return a "skipped" result.
 *
 * If we ever upgrade to Pro we can drop this dispatcher and run
 * /api/cron/saturday-invites directly on a Saturday-only schedule.
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

  if (weekday !== 'Sat') {
    return NextResponse.json({ ran_at: new Date().toISOString(), weekday, skipped: 'not Saturday' });
  }

  const results: any[] = [];
  try {
    const r = await fetch(`${baseUrl}/api/cron/saturday-invites?secret=${encodeURIComponent(secret)}`, {
      cache: 'no-store',
    });
    const body = await r.json().catch(() => ({}));
    results.push({ job: 'saturday-invites', status: r.status, body });
  } catch (e: any) {
    results.push({ job: 'saturday-invites', error: e?.message ?? String(e) });
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), weekday, results });
}
