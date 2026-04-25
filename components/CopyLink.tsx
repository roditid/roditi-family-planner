'use client';
import { useState } from 'react';

export default function CopyLink({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="btn-ghost text-xs px-3 py-1.5"
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
