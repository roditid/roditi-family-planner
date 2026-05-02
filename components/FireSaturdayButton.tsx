'use client';
import { useState, useTransition } from 'react';
import { sendSaturdayNowAction } from '@/app/_actions/invites';

type Result = Awaited<ReturnType<typeof sendSaturdayNowAction>>;

export default function FireSaturdayButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  function fire() {
    setResult(null);
    start(async () => {
      const r = await sendSaturdayNowAction();
      setResult(r);
    });
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={fire}
        disabled={pending}
        className="btn-primary text-sm disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Fire Saturday flow'}
      </button>

      {result && !result.ok && (
        <div className="mt-3 text-sm text-coral-600">
          ⚠︎ {result.error ?? 'Failed — check Vercel logs'}
        </div>
      )}

      {result && result.ok && (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-700/55 mb-1">Grandparent invites</div>
            {result.inviteResults.length === 0 ? (
              <div className="text-ink-700/60">No helpers found in this household.</div>
            ) : (
              <ul className="space-y-1">
                {result.inviteResults.map((r) => (
                  <li key={r.email ?? r.name} className="flex items-baseline gap-2">
                    <span className={r.sent ? 'text-sage-700' : 'text-ink-700/40'}>{r.sent ? '✓' : '–'}</span>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-ink-700/55 truncate">{r.email ?? '(no email)'}</span>
                    {r.skipped && <span className="text-coral-600 text-xs">{r.skipped}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-700/55 mb-1">Admin roundup</div>
            {result.adminResults.length === 0 ? (
              <div className="text-ink-700/60">No admins found in this household.</div>
            ) : (
              <ul className="space-y-1">
                {result.adminResults.map((r) => (
                  <li key={r.email ?? r.name} className="flex items-baseline gap-2">
                    <span className={r.sent ? 'text-sage-700' : 'text-ink-700/40'}>{r.sent ? '✓' : '–'}</span>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-ink-700/55 truncate">{r.email ?? '(no email)'}</span>
                    {r.skipped && <span className="text-coral-600 text-xs">{r.skipped}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
