'use client';
/**
 * Admin-only "Combine with another pickup" picker shown on solo
 * Gan→Home auto-default slots. Lists the OTHER solo Gan→Home slots
 * on the same date that are also eligible for merging, lets admin
 * pick which one(s) to combine.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mergeSlotsAction } from '@/app/_actions/combine';

interface MergeCandidate {
  id: string;
  childName: string;
  pickupTime: string; // HH:MM:SS
}

interface Props {
  currentSlotId: string;
  candidates: MergeCandidate[]; // other solo Gan→Home slots on same date
}

export default function MergeWithPicker({ currentSlotId, candidates }: Props) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (candidates.length === 0) return null;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function merge() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.append('slot_ids[]', currentSlotId);
      for (const id of picked) fd.append('slot_ids[]', id);
      const r = await mergeSlotsAction(fd);
      if (!r.ok) { setMsg({ ok: false, text: `⚠︎ ${r.error}` }); return; }
      setMsg({ ok: true, text: '✓ Combined' });
      router.refresh();
    });
  }

  return (
    <div className="pt-3 border-t border-black/5 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-700/55 font-semibold">
        Combine with another pickup
      </div>
      <div className="flex flex-wrap gap-2">
        {candidates.map((c) => {
          const checked = picked.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                checked
                  ? 'bg-sage-500 text-cream-50'
                  : 'bg-cream-50 text-ink-700 border border-black/10 hover:border-sage-500/40'
              }`}
            >
              {checked ? '✓ ' : ''}{c.childName} · {c.pickupTime.slice(0, 5)}
            </button>
          );
        })}
      </div>
      {picked.size > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={merge}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-sage-500 text-cream-50 hover:bg-sage-600 disabled:opacity-60"
          >
            {pending ? 'Combining…' : `Combine into one trip`}
          </button>
          {msg && (
            <span className={`text-xs ${msg.ok ? 'text-sage-700' : 'text-coral-600'}`}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
