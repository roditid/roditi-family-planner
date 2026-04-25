import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { children as demoChildren, activities as demoActivities, locations as demoLocations } from '@/lib/demo-store';
import { updateActivityAction } from '@/app/_actions/admin';

export const dynamic = 'force-dynamic';

export default async function ChildrenAdmin() {
  const ctx = await requireAdmin();

  let kids: any[] = [];
  let locs: any[] = [];
  if (demoMode()) {
    locs = demoLocations();
    kids = demoChildren().map((c) => ({
      ...c,
      activities: demoActivities().filter((a) => a.child_id === c.id),
    }));
  } else {
    const sb = supabaseServer();
    const [{ data: kidRows }, { data: locRows }] = await Promise.all([
      sb.from('children')
        .select('*, activities(*)')
        .eq('household_id', ctx.household!.id)
        .order('name'),
      sb.from('locations').select('id, label').eq('household_id', ctx.household!.id).order('label'),
    ]);
    kids = kidRows ?? [];
    locs = locRows ?? [];
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Children & activities</h1>
        <p className="text-ink-700/70 mt-1">Set default pickup and drop-off locations so the app can fill in missing calendar locations automatically.</p>
      </header>

      <div className="space-y-6">
        {kids.map((k: any) => (
          <section key={k.id} className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-4 w-4 rounded-full" style={{ background: k.color }} />
              <h2 className="font-display text-2xl">{k.name}</h2>
              <span className="text-sm text-ink-700/60">· {k.school_name ?? 'no school set'}</span>
            </div>
            <div className="space-y-4">
              {(k.activities ?? []).map((a: any) => (
                <ActivityCard key={a.id} activity={a} locations={locs} />
              ))}
              {(k.activities ?? []).length === 0 && (
                <p className="text-sm text-ink-700/60">No activities yet.</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ activity, locations }: { activity: any; locations: any[] }) {
  return (
    <form action={updateActivityAction} className="rounded-xl border border-black/5 p-4 space-y-3">
      <input type="hidden" name="id" value={activity.id} />
      <div className="flex items-baseline justify-between">
        <label className="flex-1 max-w-md">
          <span className="label mb-1 block">Title</span>
          <input name="title" defaultValue={activity.title} required className="input" />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className="label mb-1 block">Default pickup</span>
          <select name="default_pickup_location_id" defaultValue={activity.default_pickup_location_id ?? ''} className="input">
            <option value="">— Not set —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label>
          <span className="label mb-1 block">Default drop-off</span>
          <select name="default_destination_location_id" defaultValue={activity.default_destination_location_id ?? ''} className="input">
            <option value="">— Not set —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className="label mb-1 block">Calendar keyword</span>
          <input name="event_keyword" defaultValue={activity.event_keyword ?? ''} placeholder="e.g. football" className="input" />
        </label>
        <label>
          <span className="label mb-1 block">Notes</span>
          <input name="notes" defaultValue={activity.notes ?? ''} className="input" />
        </label>
      </div>
      <div className="text-right">
        <button className="btn-soft text-sm">Save</button>
      </div>
    </form>
  );
}
