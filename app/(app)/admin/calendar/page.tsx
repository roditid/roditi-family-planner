import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function CalendarSettings({ searchParams }: { searchParams: { synced?: string; connected?: string } }) {
  const ctx = await requireAdmin();
  const justSynced = typeof searchParams.synced === 'string';
  const justConnected = searchParams.connected === '1';

  let conn: any = null;
  let owner: any = null;
  if (demoMode()) {
    conn = {
      google_account_email: 'paula@example.com',
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'ok — 14 events, 9 slots (demo)',
      last_sync_error: null,
    };
    owner = { full_name: 'Paula Roditi', email: 'paula@example.com' };
  } else {
    const sb = supabaseServer();
    const { data } = await sb
      .from('connected_calendars')
      .select('*, owner:owner_user_id(full_name, email)')
      .eq('household_id', ctx.household!.id)
      .maybeSingle();
    conn = data;
    owner = data?.owner;
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl">Calendar</h1>
        <p className="text-ink-700/70 mt-1">
          Schedule data comes from a single connected Google Calendar. Both admins manage assignments, but only the calendar owner re-authenticates when the connection expires.
        </p>
      </header>

      {justSynced && (
        <div className="rounded-2xl bg-sage-500/10 border border-sage-500/30 px-5 py-4">
          <div className="font-medium text-sage-700 mb-1">
            ✓ Synced — {searchParams.synced} slot{searchParams.synced === '1' ? '' : 's'} imported
          </div>
          <div className="text-sm text-ink-700/70">
            Pickups now live on the dashboard.{' '}
            <Link href="/admin" className="underline text-sage-700 font-medium">View this week's pickups →</Link>
          </div>
        </div>
      )}

      {justConnected && (
        <div className="rounded-2xl bg-sage-500/10 border border-sage-500/30 px-5 py-4">
          <div className="font-medium text-sage-700">✓ Connected. Click "Sync now" below to import events.</div>
        </div>
      )}

      {conn && conn.access_token && conn.refresh_token ? (
        <div className="card p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-sage-500 text-cream-50 grid place-items-center font-display text-xl">
              {(owner?.full_name ?? 'P').slice(0, 1)}
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider text-ink-700/60">Connected account</div>
              <div className="font-medium text-lg">{owner?.full_name ?? 'Paula'}</div>
              <div className="text-sm text-ink-700/70">{conn.google_account_email}</div>
            </div>
            <span className="chip bg-sage-500/10 text-sage-700 h-fit">Calendar owner</span>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/5 text-sm">
            <Field label="Last sync">
              {conn.last_sync_at ? format(new Date(conn.last_sync_at), 'MMM d, HH:mm') : 'never'}
            </Field>
            <Field label="Status">{conn.last_sync_status ?? '—'}</Field>
          </div>

          <div className="pt-4 border-t border-black/5 flex gap-2 flex-wrap">
            <form action="/api/calendar/sync" method="post">
              <button className="btn-soft">↻ Sync now</button>
            </form>
            <a href="/api/calendar/connect" className="btn-ghost">Reconnect Paula's account</a>
          </div>

          {conn.last_sync_error && (
            <div className="rounded-xl bg-coral-400/15 border border-coral-400/30 px-4 py-3 text-coral-600 text-sm">
              <b>Last sync error:</b> {conn.last_sync_error}
            </div>
          )}
        </div>
      ) : (
        <div className="card p-6 space-y-4">
          <p>
            {conn
              ? 'A connection record exists but the access tokens are missing — likely a stub from initial setup. Click below to authorize Google Calendar and overwrite it.'
              : "No Google Calendar is connected yet. Paula should sign in with Google and grant access — her calendar contains the kids' schedules."}
          </p>
          <a href="/api/calendar/connect" className="btn-primary">Connect Paula's Google Calendar</a>
        </div>
      )}

      <div className="card p-6 space-y-2 text-sm text-ink-700/80">
        <div className="font-medium text-ink-900">How this works</div>
        <p>Events are pulled from Paula's calendar and matched to each child via the activity <b>keyword</b> you set under Children. If an event has no location, the activity's default pickup location is used.</p>
        <p>Household administration (assignments, overrides, reminders) is shared by both Paula and Daniel — independent of who owns the calendar connection.</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-ink-700/60 mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}
