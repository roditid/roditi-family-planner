'use client';
/**
 * Toggle that flips the Google Calendar push-notification (watch) on or
 * off. Once enabled, edits to the kids' calendar appear on the website
 * within seconds. Daily cron renews the watch within 24h of expiry.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function LiveSyncToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    setErr(null);
    start(async () => {
      const method = enabled ? 'DELETE' : 'POST';
      const res = await fetch('/api/calendar/watch', { method });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={enabled
          ? 'btn-ghost text-coral-600 hover:bg-coral-400/10'
          : 'btn-soft bg-sage-500/15 text-sage-700 hover:bg-sage-500/25'}
      >
        {pending ? '…' : enabled ? 'Disable live sync' : '⚡ Enable live sync'}
      </button>
      {err && <span className="text-sm text-coral-600 self-center">{err}</span>}
    </>
  );
}
