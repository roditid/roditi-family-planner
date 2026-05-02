'use client';
/**
 * Admin-only button at the bottom of /home that opens WhatsApp pre-filled
 * with the full week's pickup summary, addressed to Liezel. Same body as
 * the Sunday-summary email; this one fires on demand whenever Paula
 * (or Dani) wants to push an updated view to Liezel mid-week.
 */
import { useState } from 'react';

interface Props {
  liezelPhone: string | null; // digits only, no '+' or spaces
  summaryBody: string;
}

export default function SendSummaryToLiezel({ liezelPhone, summaryBody }: Props) {
  const [tapped, setTapped] = useState(false);
  if (!liezelPhone) {
    return (
      <div className="text-xs text-ink-700/45 px-1 mt-6">
        Add Liezel's phone number in <a href="/admin/helpers" className="underline">Settings → Helpers</a> to enable the WhatsApp summary button here.
      </div>
    );
  }
  const href = `https://wa.me/${liezelPhone}?text=${encodeURIComponent(summaryBody)}`;
  return (
    <div className="mt-8 pt-6 border-t border-black/5 flex flex-wrap items-center gap-3 justify-between">
      <div className="text-sm text-ink-700/65 max-w-md">
        Send this week's full schedule to Liezel — she gets the same
        summary you see, addresses included.
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={() => setTapped(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe57] text-white px-4 py-2.5 text-sm font-semibold active:scale-[0.97] transition"
      >
        {tapped ? '✓ ' : ''}Send weekly summary to Liezel
      </a>
    </div>
  );
}
