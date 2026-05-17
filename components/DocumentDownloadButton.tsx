'use client';
/**
 * Tap to fetch a short-lived signed URL and open it in a new tab.
 * Avoids exposing storage paths in the rendered HTML and keeps URLs
 * unguessable + time-limited.
 */
import { useState, useTransition } from 'react';
import { getDocumentSignedUrl } from '@/app/_actions/documents';

export default function DocumentDownloadButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function open() {
    setErr(null);
    start(async () => {
      const r = await getDocumentSignedUrl(id);
      if (!r.url) { setErr(r.error ?? 'failed'); return; }
      window.open(r.url, '_blank', 'noopener,noreferrer');
    });
  }
  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="btn-soft text-xs"
      >
        {pending ? 'Opening…' : 'Open ↗'}
      </button>
      {err && <span className="text-xs text-coral-600 ml-2">{err}</span>}
    </>
  );
}
