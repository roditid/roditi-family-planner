'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reassignSlotAction } from '@/app/_actions/admin';

interface Helper { id: string; full_name: string; helper_kind?: string | null; role: string; }

export default function AssignmentPicker({
  slotId,
  currentUserId,
  helpers,
}: {
  slotId: string;
  currentUserId: string | null;
  helpers: Helper[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    start(async () => {
      await reassignSlotAction(formData);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="inline-flex">
      <input type="hidden" name="slot_id" value={slotId} />
      <select
        name="user_id"
        defaultValue={currentUserId ?? ''}
        disabled={pending}
        onChange={(e) => {
          // Auto-submit on change — feels more immediate.
          const form = e.currentTarget.form!;
          const fd = new FormData(form);
          submit(fd);
        }}
        className="text-sm rounded-lg border border-black/10 bg-white px-2 py-1.5 min-w-[160px]"
      >
        <option value="__clear__">— Unassign —</option>
        {helpers.map((h) => (
          <option key={h.id} value={h.id}>
            {h.full_name}{h.helper_kind === 'nanny' ? ' (Nanny)' : ''}
          </option>
        ))}
      </select>
    </form>
  );
}
