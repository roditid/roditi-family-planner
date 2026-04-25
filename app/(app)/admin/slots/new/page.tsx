import Link from 'next/link';
import { format } from 'date-fns';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { children as demoChildren, locations as demoLocations } from '@/lib/demo-store';
import { createSlotAction } from '@/app/_actions/admin';

export const dynamic = 'force-dynamic';

export default async function NewSlotPage() {
  const ctx = await requireAdmin();

  let kids: any[] = [];
  let locs: any[] = [];
  if (demoMode()) {
    kids = demoChildren();
    locs = demoLocations();
  } else {
    const sb = supabaseServer();
    const [{ data: c }, { data: l }] = await Promise.all([
      sb.from('children').select('id, name, color').eq('household_id', ctx.household!.id).order('name'),
      sb.from('locations').select('id, label').eq('household_id', ctx.household!.id).order('label'),
    ]);
    kids = c ?? [];
    locs = l ?? [];
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-700/60 hover:underline">← Back to overview</Link>
        <h1 className="font-display text-3xl mt-2">New pickup</h1>
        <p className="text-ink-700/70 mt-1">Create a one-off pickup that isn't on the calendar.</p>
      </div>

      <form action={createSlotAction} className="card p-6 space-y-5">
        <Field label="Child" required>
          <select name="child_id" required className="input">
            <option value="">— Choose —</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </Field>

        <Field label="What's the pickup for?" required>
          <input name="title" required placeholder="e.g. School pickup" className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required>
            <input name="date" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} className="input" />
          </Field>
          <Field label="Pickup time" required>
            <input name="pickup_time" type="time" required defaultValue="16:00" className="input" />
          </Field>
        </div>

        <Field label="End time (optional)">
          <input name="end_time" type="time" className="input" />
        </Field>

        <Field label="Pick up from">
          <select name="pickup_location_id" className="input">
            <option value="">— None / will use activity default —</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Drop off at">
          <select name="destination_location_id" className="input">
            <option value="">— None —</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Notes">
          <textarea name="notes" rows={2} placeholder="Anything the helper should know" className="input" />
        </Field>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary flex-1">Create pickup</button>
          <Link href="/admin" className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">
        {label} {required && <span className="text-coral-500">*</span>}
      </span>
      {children}
    </label>
  );
}
