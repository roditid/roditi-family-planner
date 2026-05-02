'use client';
import { useState, useTransition } from 'react';
import { sendSaturdayNowAction } from '@/app/_actions/invites';

export default function FireSaturdayButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<null | { ok: boolean; invitesSent: number; adminSent: number; error?: string }>(null);

  function fire() {
    setResult(null);
    start(async () => {
      const r = await sendSaturdayNowAction();
      setResult(r);
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={fire}
        disabled={pending}
        className="btn-primary text-sm disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Fire Saturday flow'}
      </button>
      {result && (
        result.ok ? (
          <span className="text-sm text-sage-700">
            ✓ Sent {result.invitesSent} grandparent invite{result.invitesSent === 1 ? '' : 's'} + {result.adminSent} admin email{result.adminSent === 1 ? '' : 's'}.
          </span>
        ) : (
          <span className="text-sm text-coral-600">
            ⚠︎ {result.error ?? 'Failed — check Vercel logs'}
          </span>
        )
      )}
    </div>
  );
}
