/**
 * Phone-number rendering. Detects numbers like "+972 52-253-2439" or
 * "050-895-3534" inside arbitrary text, and renders them as <a tel:>
 * tap-to-call links. Used in slot notes, location notes, and reminder
 * email templates (for the call-target part).
 */
import React from 'react';

// Match Israeli mobile + international phone formats. Loose enough to catch
// "+972 52-253-2439", "050-895-3534", "(972) 50-214-5770".
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?(\(?\d{2,3}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,4}/g;

export function tellable(input: string | null | undefined): React.ReactNode[] {
  if (!input) return [];
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(input))) {
    const match = m[0];
    // Skip false positives (must contain ≥7 digits to qualify as phone)
    const digits = match.replace(/[^\d]/g, '');
    if (digits.length < 7) continue;
    if (m.index > last) out.push(input.slice(last, m.index));
    out.push(
      React.createElement(
        'a',
        {
          key: `tel-${m.index}`,
          href: `tel:${digits.startsWith('972') ? '+' + digits : digits}`,
          className: 'underline font-semibold whitespace-nowrap',
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
        match
      )
    );
    last = m.index + match.length;
  }
  if (last < input.length) out.push(input.slice(last));
  return out.length ? out : [input];
}

/** Plain href for a single phone number. Used in WhatsApp button etc. */
export function telHref(phone: string) {
  const digits = phone.replace(/[^\d]/g, '');
  return `tel:${digits.startsWith('972') ? '+' + digits : digits}`;
}
