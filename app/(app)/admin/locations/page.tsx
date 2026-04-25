import Link from 'next/link';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { locations as demoLocations } from '@/lib/demo-store';
import { mapsHref } from '@/lib/maps';
import { createLocationAction } from '@/app/_actions/admin';

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
        <p className="text-ink-700/70 mt-1">Reusable places — school, home, activities — attached to children, activities, and slots.</p>
      </header>

      <section className="card p-6">
        <h2 className="font-display text-xl mb-4">+ Add a location</h2>
        <form action={createLocationAction} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name" required><input name="label" required placeholder="e.g. Basketball court" className="input" /></Field>
            <Field label="Street"><input name="street" placeholder="20 Weizmann St" className="input" /></Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="City"><input name="city" defaultValue="Tel Aviv" className="input" /></Field>
            <Field label="Notes"><input name="notes" placeholder="Wait near north gate" className="input" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700/80">
            <input type="checkbox" name="is_common" /> Mark as a common/frequent location
          </label>
          <button className="btn-primary">Add location</button>
        </form>
      </section>

      <section>
        <h2 className="font-display text-xl mb-3">Saved locations</h2>
        <div className="card divide-y divide-black/5">
          {locs.map((l: any) => (
            <div key={l.id} className="p-4 flex items-start gap-4">
              <div className="text-2xl mt-0.5">📍</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{l.label}</div>
                  {l.is_common && <span className="chip bg-sage-500/10 text-sage-700 text-xs">common</span>}
                </div>
                <div className="text-sm text-ink-700/70">{[l.street, l.city].filter(Boolean).join(', ') || '—'}</div>
                {l.notes && <div className="text-sm text-ink-700/60 italic">{l.notes}</div>}
              </div>
              <a href={mapsHref(l) ?? '#'} target="_blank" rel="noreferrer" className="text-sm text-sage-600 hover:underline">Map</a>
            </div>
          ))}
          {locs.length === 0 && <div className="p-4 text-sm text-ink-700/60">No locations yet — add one above.</div>}
        </div>
      </section>
    </div>
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
