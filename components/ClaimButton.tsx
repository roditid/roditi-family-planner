'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slotId: string;
  claimed: boolean;
  claimedByMe: boolean;
  onChange?: () => void;
}

export default function ClaimButton({ slotId, claimed, claimedByMe, onChange }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function doAction() {
    setErr(null);
    const path = claimedByMe
      ? `/api/slots/${slotId}/unclaim`
      : `/api/slots/${slotId}/claim`;
    const res = await fetch(path, { method: 'POST' });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Something went wrong' }));
      setErr(error);
      return;
    }
    start(() => {
      router.refresh();
      onChange?.();
    });
  }

  if (claimed && !claimedByMe) return null;
  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-coral-600">{err}</span>}
      <button
        onClick={doAction}
        disabled={pending}
        className={claimedByMe ? 'btn-ghost text-sm px-4 py-2' : 'btn-primary text-base px-5 py-2.5'}
      >
        {pending ? '…' : claimedByMe ? 'Unclaim' : 'Claim this pickup'}
      </button>
    </div>
  );
}
