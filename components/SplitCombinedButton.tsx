'use client';
/**
 * Admin-only button shown inside the slot detail modal for combined
 * Gan→Home auto-defaults. One tap converts the combined trip into
 * separate solo pickups, one per kid.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { splitSlotAction } from '@/app/_actions/combine';

export default function SplitCombinedButton({ slotId }: { slotId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function fire() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set('slot_id', slotId);
      const r = await splitSlotAction(fd);
      if (!r.ok) { setMsg(`⚠︎ ${r.error}`); return; }
      setMsg(`✓ Split into ${r.splitCount} separate pickups.`);
      router.refresh();
    });
  }

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={fire}
        disabled={pending}
        className="text-xs text-ink-700/60 hover:text-coral-600 underline underline-offset-2"
      >
        {pending ? 'Splitting…' : 'Split into separate pickups'}
      </button>
      {msg && <span className="ml-2 text-xs text-ink-700/70">{msg}</span>}
    </div>
  );
}
