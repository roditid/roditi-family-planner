'use client';
/**
 * Admin-only edit form inside the slot detail modal. Collapsed by
 * default so the modal stays clean for helpers. Fields:
 *   • Title (string)
 *   • Pickup time (HH:MM)
 *   • End time (HH:MM, optional)
 *   • Additional kids on the trip (multi-checkbox)
 *   • Delete pickup (with confirm)
 *
 * For calendar-sourced slots, title edits push back to the Google
 * Calendar event (preserving any [Helper] prefix). Time/date/location
 * edits are website-only — for those, the source of truth is still
 * Google Calendar; editing on the calendar flows back through sync.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSlotAction, deleteSlotAction } from '@/app/_actions/slots';

interface Kid { id: string; name: string }
interface SlotShape {
  id: string;
  title: string;
  pickup_time: string;
  end_time: string | null;
  source: string;
  child: { id: string; name: string };
  additional_children?: { id: string; name: string }[];
  notes?: string | null;
}

interface Props {
  slot: SlotShape;
  allKids: Kid[]; // all kids in the household, for the additional-children picker
}

export default function SlotEditForm({ slot, allKids }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  // Local state for the additional kids checkboxes — uncontrolled would
  // be fine but we mirror it to keep the count in the label.
  const initialExtra = new Set((slot.additional_children ?? []).map((k) => k.id));
  const [extras, setExtras] = useState<Set<string>>(initialExtra);

  function toggleKid(id: string) {
    setExtras((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save(formData: FormData) {
    // Inject the latest checkbox state into the submission.
    formData.delete('additional_child_ids[]');
    for (const id of extras) formData.append('additional_child_ids[]', id);
    setMsg(null);
    start(async () => {
      const r = await updateSlotAction(formData);
      setMsg(r.ok ? { ok: true, text: '✓ Saved' } : { ok: false, text: `⚠︎ ${r.error}` });
      if (r.ok) router.refresh();
    });
  }

  function doDelete() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set('slot_id', slot.id);
      const r = await deleteSlotAction(fd);
      if (!r.ok) { setMsg({ ok: false, text: `⚠︎ ${r.error}` }); return; }
      router.refresh();
    });
  }

  const otherKids = allKids.filter((k) => k.id !== slot.child.id);
  const isCalendarSlot = slot.source === 'calendar';

  return (
    <div className="rounded-xl bg-cream-200/40 p-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center justify-between"
      >
        <span className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold">
          Edit pickup details
        </span>
        <span className="text-xs text-ink-700/55">{open ? '↑' : '↓'}</span>
      </button>

      {open && (
        <form action={save} className="mt-3 space-y-3 text-sm">
          <input type="hidden" name="slot_id" value={slot.id} />

          <Field label="Title">
            <input
              name="title"
              defaultValue={slot.title}
              className="input text-sm w-full"
              required
            />
            {isCalendarSlot && (
              <span className="text-[11px] text-ink-700/50 mt-1 block">
                Saving will also rename the source calendar event.
              </span>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup time">
              <input
                type="time"
                name="pickup_time"
                defaultValue={slot.pickup_time.slice(0, 5)}
                className="input text-sm"
              />
            </Field>
            <Field label="End time (optional)">
              <input
                type="time"
                name="end_time"
                defaultValue={slot.end_time?.slice(0, 5) ?? ''}
                className="input text-sm"
              />
            </Field>
          </div>

          {otherKids.length > 0 && (
            <Field label={`Other kids on this trip (${extras.size})`}>
              <div className="flex flex-wrap gap-2 mt-1">
                {otherKids.map((k) => {
                  const checked = extras.has(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => toggleKid(k.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                        checked
                          ? 'bg-sage-500 text-cream-50'
                          : 'bg-cream-50 text-ink-700 border border-black/10 hover:border-sage-500/40'
                      }`}
                    >
                      {checked ? '✓ ' : ''}{k.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              type="submit"
              disabled={pending}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {!showDelete ? (
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="text-xs text-ink-700/55 hover:text-coral-600 underline underline-offset-2 ml-auto"
              >
                Cancel pickup
              </button>
            ) : (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-coral-600">Cancel this pickup?</span>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={pending}
                  className="text-xs px-2.5 py-1 rounded-md bg-coral-400 text-white hover:bg-coral-500 disabled:opacity-60"
                >
                  Yes, cancel
                </button>
                <button
                  type="button"
                  onClick={() => setShowDelete(false)}
                  className="text-xs text-ink-700/55"
                >
                  Keep
                </button>
              </div>
            )}
          </div>

          {msg && (
            <div className={`text-xs ${msg.ok ? 'text-sage-700' : 'text-coral-600'}`}>
              {msg.text}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
