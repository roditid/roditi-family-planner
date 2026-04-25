import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { children as demoChildren, activities as demoActivities, locations as demoLocations } from '@/lib/demo-store';
import { updateActivityAction, deleteActivityAction } from '@/app/_actions/admin';

export const dynamic = 'force-dynamic';

export default async function ChildrenAdmin() {
  const ctx = await requireAdmin();

  let kids: any[] = [];
  let locs: any[] = [];
  let slotCounts: Record<string, number> = {};
  if (demoMode()) {
    locs = demoLocations();
    kids = demoChildren().map((c) => ({
      ...c,
      activities: demoActivities().filter((a) => a.child_id === c.id),
    }));
  } else {
    const sb = supabaseServer();
    const [{ data: kidRows }, { data: locRows }, { data: slotsForCount }] = await Promise.all([
      sb.from('children').select('*, activities(*)').eq('household_id', ctx.household!.id).order('name'),
      sb.from('locations').select('id, label').eq('household_id', ctx.household!.id).order('label'),
      sb.from('pickup_slots').select('activity_id').eq('household_id', ctx.household!.id).gte('date', new Date().toISOString().slice(0, 10)),
    ]);
    kids = kidRows ?? [];
    locs = locRows ?? [];
    for (const s of slotsForCount ?? []) {
      if (s.activity_id) slotCounts[s.activity_id] = (slotCounts[s.activity_id] ?? 0) + 1;
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Children & activities</h1>
        <p className="text-ink-700/70 mt-1">
          Set a default pickup and drop-off for each activity. Saving updates all upcoming pickups for that activity, so helpers see the right place automatically.
        </p>
      </header>

      {locs.length === 0 && (
        <div className="rounded-2xl bg-coral-400/15 border border-coral-400/30 px-4 py-3 text-sm text-ink-700/85">
          You haven't added any locations yet. <Link href="/admin/locations" className="underline font-medium">Add a few in Locations →</Link>{' '}then come back here to assign them per activity.
        </div>
      )}

      <div className="space-y-6">
        {kids.map((k: any) => (
          <section key={k.id} className="card p-6">
            <div className="flex items-center gap-3 mb-1">
              <span className="h-5 w-5 rounded-full" style={{ background: k.color }} aria-hidden />
              <h2 className="font-display text-2xl">{k.name}</h2>
            </div>
            {k.school_name && (
              <p className="text-sm text-ink-700/60 ml-8 mb-4">School: {k.school_name}</p>
            )}
            <div className="space-y-4 mt-4">
              {(k.activities ?? []).map((a: any) => (
                <ActivityCard key={a.id} activity={a} locations={locs} childColor={k.color} slotCount={slotCounts[a.id] ?? 0} />
              ))}
              {(k.activities ?? []).length === 0 && (
                <p className="text-sm text-ink-700/60 italic">
                  Activities are auto-created the first time a calendar event matches this child (e.g. "Soccer - {k.name}").
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ActivityCard({
  activity, locations, childColor, slotCount,
}: { activity: any; locations: any[]; childColor: string; slotCount: number }) {
  return (
    <details className="rounded-xl border border-black/[0.06] bg-cream-100/40 group">
      <summary className="p-4 cursor-pointer list-none flex items-center gap-3">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: childColor }} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{activity.title}</div>
          <div className="text-xs text-ink-700/60 mt-0.5 truncate">
            {activity.default_pickup_location_id?.label
              ? `Pickup: ${activity.default_pickup_location_id.label}`
              : <span className="text-coral-600">Pickup not set</span>}
            {activity.default_destination_location_id?.label && ` → ${activity.default_destination_location_id.label}`}
          </div>
        </div>
        {slotCount > 0 && (
          <span className="chip bg-black/5 text-ink-700 text-xs">{slotCount} upcoming</span>
        )}
        <span className="text-xs text-ink-700/40 px-2 group-open:hidden">edit ↓</span>
      </summary>

      <form action={updateActivityAction} className="px-4 pb-4 pt-0 space-y-3 border-t border-black/[0.06]">
        <input type="hidden" name="id" value={activity.id} />
        <div className="grid sm:grid-cols-2 gap-3 pt-3">
          <label>
            <span className="label mb-1 block">Activity name</span>
            <input name="title" defaultValue={activity.title} required className="input text-sm" />
          </label>
          <label>
            <span className="label mb-1 block">Calendar keyword <span className="font-normal lowercase text-ink-700/50">(matches event titles)</span></span>
            <input name="event_keyword" defaultValue={activity.event_keyword ?? ''} placeholder="e.g. soccer" className="input text-sm" />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label>
            <span className="label mb-1 block">Default pickup</span>
            <select name="default_pickup_location_id" defaultValue={activity.default_pickup_location_id?.id ?? activity.default_pickup_location_id ?? ''} className="input text-sm">
              <option value="">— Not set —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label>
            <span className="label mb-1 block">Default drop-off</span>
            <select name="default_destination_location_id" defaultValue={activity.default_destination_location_id?.id ?? activity.default_destination_location_id ?? ''} className="input text-sm">
              <option value="">— Not set —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label mb-1 block">Helper note <span className="font-normal lowercase text-ink-700/50">(shows on every pickup of this activity)</span></span>
          <input name="notes" defaultValue={activity.notes ?? ''} placeholder='e.g. "Wait by the side gate"' className="input text-sm" />
        </label>
        <div className="flex gap-2 justify-between pt-1">
          <button className="btn-soft text-sm">Save & apply to {slotCount} upcoming pickup{slotCount === 1 ? '' : 's'}</button>
          <DeleteActivityForm id={activity.id} />
        </div>
      </form>
    </details>
  );
}

function DeleteActivityForm({ id }: { id: string }) {
  return (
    <form action={deleteActivityAction} className="inline-flex">
      <input type="hidden" name="id" value={id} />
      <button className="text-sm text-ink-700/50 hover:text-coral-600 px-3 py-2" formNoValidate>
        Delete activity
      </button>
    </form>
  );
}
