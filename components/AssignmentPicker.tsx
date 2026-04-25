'use client';
import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reassignSlotAction } from '@/app/_actions/admin';

interface Helper { id: string; full_name: string; helper_kind?: string | null; role: string; }

/**
 * Inline assignment dropdown. Optimistic: the select value flips locally
 * the instant the admin picks someone, while the server action fires in
 * the background. No spinner, no perceived lag.
 */
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
  const [value, setValue] = useOptimistic(currentUserId ?? '__clear__', (_p, n: string) => n);

  function pick(userId: string) {
    const formData = new FormData();
    formData.set('slot_id', slotId);
    formData.set('user_id', userId);
    start(async () => {
      setValue(userId);
      await reassignSlotAction(formData);
      router.refresh();
    });
  }

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => pick(e.target.value)}
      className={
        'text-sm rounded-lg border bg-white px-3 py-2 min-w-[170px] transition-all duration-150 ' +
        'focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 outline-none ' +
        (pending ? 'border-sage-500/50 opacity-80' : 'border-black/10 hover:border-sage-500/40')
      }
    >
      <option value="__clear__">— Unassigned —</option>
      {helpers.map((h) => (
        <option key={h.id} value={h.id}>
          {h.full_name}{labelFor(h)}
        </option>
      ))}
    </select>
  );
}

function labelFor(h: Helper): string {
  if (h.role === 'admin') return ' (Parent)';
  if (h.helper_kind === 'nanny') return ' (Nanny)';
  return '';
}
