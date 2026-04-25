import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode } from '@/lib/demo-session';
import { getReminderSettings } from '@/lib/demo-store';
import { renderReminder } from '@/lib/notify';
import { fetchSlots } from '@/lib/slots';
import { weekRange } from '@/lib/week';
import { updateReminderSettingsAction } from '@/app/_actions/admin';

export const dynamic = 'force-dynamic';

export default async function RemindersAdmin() {
  const ctx = await requireAdmin();

  let r: any;
  if (demoMode()) r = getReminderSettings();
  else {
    const sb = supabaseServer();
    const { data } = await sb.from('reminder_settings').select('*').eq('household_id', ctx.household!.id).maybeSingle();
    r = data ?? { morning_send_time: '07:30', send_evening_before: false, evening_send_time: '20:00', cutoff_time: '20:00', parent_fallback_alert: true, timezone: 'Asia/Jerusalem' };
  }

  const sb = supabaseServer();
  const { startISO, endISO } = weekRange(new Date());
  const slots = await fetchSlots(sb, ctx.household!.id, startISO, endISO);
  const example = slots.find((s) => s.pickup_location) ?? slots[0];
  const preview = example ? renderReminder(example) : null;

  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl">Reminder settings</h1>
        <p className="text-ink-700/70 mt-1">Daily morning reminder for whoever is on pickup duty. Runs as a scheduled job.</p>
      </header>

      <form action={updateReminderSettingsAction} className="card p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Morning send time">
            <input type="time" name="morning_send_time" defaultValue={(r.morning_send_time || '07:30').slice(0, 5)} className="input" />
          </Field>
          <Field label="Timezone">
            <select name="timezone" defaultValue={r.timezone ?? 'Asia/Jerusalem'} className="input">
              <option value="Asia/Jerusalem">Asia/Jerusalem</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="UTC">UTC</option>
            </select>
          </Field>
          <Field label="Claim cutoff (night before)">
            <input type="time" name="cutoff_time" defaultValue={(r.cutoff_time || '20:00').slice(0, 5)} className="input" />
          </Field>
          <Field label="Evening-before time">
            <input type="time" name="evening_send_time" defaultValue={(r.evening_send_time || '20:00').slice(0, 5)} className="input" />
          </Field>
        </div>
        <div className="space-y-2 pt-2 border-t border-black/5">
          <label className="flex items-center gap-3">
            <input type="checkbox" name="send_evening_before" defaultChecked={!!r.send_evening_before} className="h-4 w-4" />
            <span>Also send an evening-before reminder</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="parent_fallback_alert" defaultChecked={!!r.parent_fallback_alert} className="h-4 w-4" />
            <span>Alert admins at cutoff if a pickup is still unclaimed</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary">Save settings</button>
        </div>
      </form>

      <section>
        <h2 className="font-display text-xl mb-2">Preview</h2>
        {preview ? (
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wider text-ink-700/60 mb-1">Subject</div>
            <div className="font-medium mb-3">{preview.subject}</div>
            <div className="text-xs uppercase tracking-wider text-ink-700/60 mb-1">Body</div>
            <pre className="whitespace-pre-wrap text-[15px] font-sans">{preview.body}</pre>
          </div>
        ) : (
          <div className="card p-6 text-ink-700/60">No upcoming slots to preview.</div>
        )}
      </section>

      <p className="text-xs text-ink-700/50">
        Channel: email (Resend). SMS via Twilio is scaffolded in <code>lib/notify.ts</code> — fill in credentials and swap the provider to enable.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
