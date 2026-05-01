import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { locations as demoLocations } from '@/lib/demo-store';
import { mapsHref } from '@/lib/maps';
import { createLocationAction, updateLocationAction, deleteLocationAction } from '@/app/_actions/admin';

export const dynamic = 'force-dynamic';

export default async function LocationsAdmin() {
  const ctx = await requireAdmin();
  let locs: any[] = [];
  if (demoMode()) locs = demoLocations();
  else {
    const sb = supabaseServer();
    const { data } = await sb.from('locations').select('*').eq('household_id', ctx.household!.id).order('label');
    locs = data ?? [];
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Locations</h1>
        <p className="text-ink-700/70 mt-1">
          Reusable places — school, home, activity centres. Once saved, you can use them as default pickup or drop-off for any activity.
        </p>
      </header>

      {/* Add new */}
      <section className="card p-6">
        <h2 className="font-display text-xl mb-4">+ Add a location</h2>
        <form action={createLocationAction} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input name="label" required placeholder="e.g. Gan Kipod (Lapin Garden)" className="input" />
            </Field>
            <Field label="Street">
              <input name="street" placeholder="22 Lapin St" className="input" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="City">
              <input name="city" defaultValue="Tel Aviv" className="input" />
            </Field>
            <Field label="Notes">
              <input name="notes" placeholder="e.g. Use the side gate" className="input" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700/80">
            <input type="checkbox" name="is_common" /> Mark as a frequent place
          </label>
          <button className="btn-primary">Add location</button>
        </form>
      </section>

      {/* Existing — each editable inline */}
      <section>
        <h2 className="font-display text-xl mb-3">Saved locations</h2>
        {locs.length === 0 ? (
          <div className="card p-6 text-sm text-ink-700/60 text-center">
            No locations yet. Add the kids' school, your home, and the activity centres above — then assign them per activity in <a className="underline" href="/admin/children">Children & activities</a>.
          </div>
        ) : (
          <div className="space-y-3">
            {locs.map((l: any) => <LocationRow key={l.id} l={l} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function LocationRow({ l }: { l: any }) {
  const href = mapsHref(l);
  return (
    <details className="card p-4 group" open={false}>
      <summary className="flex items-start gap-3 cursor-pointer list-none">
        <div className="text-2xl mt-0.5">📍</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{l.label}</span>
            {l.is_common && <span className="chip bg-sage-500/10 text-sage-700 text-xs">frequent</span>}
          </div>
          <div className="text-sm text-ink-700/70">{[l.street, l.city].filter(Boolean).join(', ') || '—'}</div>
          {l.notes && <div className="text-sm text-ink-700/60 italic">{l.notes}</div>}
        </div>
        <div className="flex gap-1 items-center">
          {href && (
            <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm text-sage-600 hover:underline px-2 py-1">
              Map
            </a>
          )}
          <span className="text-xs text-ink-700/40 px-2 py-1 group-open:hidden">edit ↓</span>
          <span className="text-xs text-ink-700/40 px-2 py-1 hidden group-open:inline">close ↑</span>
        </div>
      </summary>

      <form action={updateLocationAction} className="mt-4 pt-4 border-t border-black/5 space-y-3">
        <input type="hidden" name="id" value={l.id} />
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label mb-1.5 block">Name</span>
            <input name="label" defaultValue={l.label} required className="input text-sm" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Street</span>
            <input name="street" defaultValue={l.street ?? ''} className="input text-sm" />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label mb-1.5 block">City</span>
            <input name="city" defaultValue={l.city ?? ''} className="input text-sm" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Notes</span>
            <input name="notes" defaultValue={l.notes ?? ''} className="input text-sm" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_common" defaultChecked={!!l.is_common} /> Frequent place
        </label>
        <div className="flex gap-2 justify-between">
          <button className="btn-soft text-sm">Save</button>
          {/* Delete uses formAction on the same form — nesting <form>
              inside <form> threw the server-side exception that broke
              the whole tab. The hidden `id` input above is reused. */}
          <button
            type="submit"
            formAction={deleteLocationAction}
            formNoValidate
            className="text-sm text-ink-700/50 hover:text-coral-600 px-3 py-2"
          >
            Delete
          </button>
        </div>
      </form>
    </details>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}{required && <span className="text-coral-500"> *</span>}</span>
      {children}
    </label>
  );
}
