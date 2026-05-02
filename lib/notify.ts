/**
 * Notification abstraction. v1 uses Resend for email. Adding a Twilio or
 * WhatsApp channel later means implementing the same `NotifyProvider`
 * interface and swapping the default export. The cron job doesn't care
 * which provider is in use.
 */
import { Resend } from 'resend';
import { formatAddress } from '@/lib/maps';
import type { SlotView } from './types';

export interface NotifyAttachment {
  filename: string;
  content: string;       // utf-8 string (resend will handle base64 internally)
  contentType?: string;  // e.g. "text/calendar; method=REQUEST"
}

export interface NotifyMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: NotifyAttachment[];
}

export interface NotifyProvider {
  channel: 'email' | 'sms';
  send(msg: NotifyMessage): Promise<{ id: string | null; error: string | null }>;
}

export const emailProvider: NotifyProvider = {
  channel: 'email',
  async send({ to, subject, body, html, attachments }) {
    if (!process.env.RESEND_API_KEY) {
      return { id: null, error: 'RESEND_API_KEY not configured' };
    }
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.REMINDER_FROM_EMAIL || 'Roditi Family Planner <onboarding@resend.dev>',
      to,
      subject,
      text: body,
      html: html ?? `<pre style="font:16px/1.5 system-ui">${escapeHtml(body)}</pre>`,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content).toString('base64'),
        // Resend uses the filename extension to infer content type if
        // not specified; .ics files render as Add-to-Calendar buttons
        // in Gmail / Apple Mail / Outlook automatically.
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
    });
    if (error) return { id: null, error: String(error.message ?? error) };
    return { id: data?.id ?? null, error: null };
  },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Render the reminder copy for a slot. Now matches the slot detail
 * modal — every stop with door codes / contact phones / notes, stroller
 * WhatsApp button when Yali is in the trip, and an HTML version so
 * the email looks like a tidy card.
 */
export function renderReminder(slot: SlotView) {
  const pickup = slot.pickup_location?.label ?? slot.pickup_location_text ?? 'location TBD';
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' → ');
  const subject = `Today: ${kidNames} — ${slot.title} at ${slot.pickup_time.slice(0, 5)}`;
  const { body, html } = renderSlotDetailEmail(slot, {
    headline: `Today's pickup`,
    intro: `Quick reminder — you've got this one this afternoon. Tap below to message Dani if Yali's stroller comes up, otherwise see you at pickup.`,
    isReminder: true,
  });
  return { subject, body, html };
}

/**
 * Render a "you've claimed this pickup" confirmation. Now mirrors the
 * slot detail modal: every stop with addresses, door codes, ganenet
 * phones, hours, plus the stroller WhatsApp button when Yali is in
 * the trip. Same body/html shape as the morning reminder so the helper
 * sees consistent info both times.
 */
export function renderClaimConfirmation(slot: SlotView, helperName: string | null) {
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' → ');
  const time = slot.pickup_time.slice(0, 5);
  const dateLabel = (() => {
    const d = new Date(slot.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();
  const subject = `Pickup confirmed: ${kidNames} on ${dateLabel} at ${time}`;
  const helperFirst = (helperName ?? '').split(' ')[0] || 'thanks';
  const { body, html } = renderSlotDetailEmail(slot, {
    headline: `✓ You're on this pickup, ${helperFirst}!`,
    intro: `Here's everything you need for the day. Save this email or screenshot it — door codes, ganenet contacts, and the full route are all below.`,
    isReminder: false,
  });
  // Attach an .ics file so the helper's email client (Gmail/Apple Mail/
  // Outlook) shows an "Add to calendar" button — they tap once and the
  // pickup lands in their personal calendar with native reminders.
  // We do NOT add them as attendees on the source Google Calendar event
  // anymore; that was triggering "event updated" notifications to Paula
  // (the calendar owner) on every claim.
  const ics = renderIcsForSlot(slot, kidNames);
  return {
    subject,
    body,
    html,
    attachments: [
      { filename: 'pickup.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
    ],
  };
}

/**
 * Build a minimal valid .ics calendar invite for a slot. Designed to
 * be detected by major email clients (Gmail/Apple Mail/Outlook) so they
 * surface a one-tap "Add to calendar" button on the message.
 */
function renderIcsForSlot(slot: SlotView, kidNames: string): string {
  // Compose start/end Date objects from slot.date + pickup_time/end_time
  // in the household's timezone (defaulting to Israel for now). We emit
  // local-time date-times tagged with TZID so calendar clients land them
  // at the right moment regardless of the helper's own timezone.
  const tz = 'Asia/Jerusalem';
  const startTime = slot.pickup_time.slice(0, 5);
  const endTime = (slot as any).end_time?.slice?.(0, 5)
    ?? (slot as any).activity_start_time?.slice?.(0, 5)
    ?? add60Min(startTime); // sensible default if event has no end
  const dtStart = `${slot.date.replace(/-/g, '')}T${startTime.replace(':', '')}00`;
  const dtEnd = `${slot.date.replace(/-/g, '')}T${endTime.replace(':', '')}00`;

  const summary = `${kidNames} — ${slot.title}`;
  const locationParts: string[] = [];
  const pickup = slot.pickup_location?.label ?? slot.pickup_location_text;
  const via = slot.via_location?.label ?? (slot as any).via_location_text;
  const dest = slot.destination_location?.label ?? (slot as any).destination_text;
  if (pickup) locationParts.push(pickup);
  if (via) locationParts.push(via);
  if (dest) locationParts.push(dest);
  const location = locationParts.join(' → ');

  // Description body — include each stop's address so the helper has
  // everything in their calendar event without needing the email.
  const descLines: string[] = [];
  if (pickup) {
    const addr = formatAddress(slot.pickup_location);
    descLines.push(`Pick up: ${pickup}${addr ? ` (${addr})` : ''}`);
  }
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    if (sl) {
      const addr = formatAddress(sl);
      descLines.push(`Then ${k.name}: ${sl.label}${addr ? ` (${addr})` : ''}`);
    }
  }
  if (via) {
    const addr = formatAddress(slot.via_location);
    descLines.push(`Activity: ${via}${addr ? ` (${addr})` : ''}`);
  }
  if (dest) {
    const addr = formatAddress(slot.destination_location);
    descLines.push(`Drop off: ${dest}${addr ? ` (${addr})` : ''}`);
  }
  if (slot.notes) descLines.push(`Notes: ${slot.notes}`);
  const description = descLines.join('\\n');

  const uid = `pickup-${slot.id}@roditi.ch`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roditi Family Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=${tz}:${dtStart}`,
    `DTEND;TZID=${tz}:${dtEnd}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    location ? `LOCATION:${icsEscape(location)}` : '',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Pickup in 30 min`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function icsEscape(s: string): string {
  return (s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function add60Min(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + 60;
  const h2 = Math.floor(total / 60) % 24;
  const m2 = total % 60;
  return `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
}

// ─── Shared slot-detail renderer ───────────────────────────────────────
// Both the claim confirmation and the morning reminder render the same
// shape: headline + kids/title/date/time + every stop with all known
// metadata + stroller block (when Yali) + slot notes.

interface RenderOpts {
  headline: string;   // top-of-email banner
  intro: string;      // single sentence sub-heading
  isReminder: boolean;
}

function renderSlotDetailEmail(slot: SlotView, opts: RenderOpts): { body: string; html: string } {
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' → ');
  const time = slot.pickup_time.slice(0, 5);
  const aStart = (slot as any).activity_start_time as string | null;
  const aEnd = (slot as any).end_time as string | null;
  const dateLabel = (() => {
    const d = new Date(slot.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();
  const yaliInTrip = allKids.some((k) => k.name.toLowerCase() === 'yali');

  // Build the route stops in the same order the modal renders them.
  // Each stop carries label, location, optional "by" time, and full
  // location notes (door codes, contact, etc.) cleaned up.
  type StopBlock = { label: string; loc: any; byTime: string | null; endTime: string | null };
  const stops: StopBlock[] = [];
  if (slot.pickup_location) stops.push({ label: 'PICK UP FROM', loc: slot.pickup_location, byTime: time, endTime: null });
  else if (slot.pickup_location_text) stops.push({ label: 'PICK UP FROM', loc: { label: slot.pickup_location_text, street: null, city: null, notes: null }, byTime: time, endTime: null });
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    const dismissal = (k as any).gan_dismissal_time as string | null;
    const byTime = dismissal && aStart && aStart <= dismissal
      ? subtract15(aStart)
      : (dismissal ? dismissal.slice(0, 5) : null);
    if (sl) stops.push({ label: `THEN PICK UP ${k.name.toUpperCase()}`, loc: sl, byTime: byTime ? byTime.slice(0, 5) : null, endTime: null });
  }
  if (slot.via_location) stops.push({ label: 'THEN GO TO', loc: slot.via_location, byTime: aStart ? aStart.slice(0, 5) : null, endTime: aEnd ? aEnd.slice(0, 5) : null });
  else if (slot.via_location_text) stops.push({ label: 'THEN GO TO', loc: { label: slot.via_location_text, street: null, city: null, notes: null }, byTime: aStart ? aStart.slice(0, 5) : null, endTime: aEnd ? aEnd.slice(0, 5) : null });
  const hasMid = (slot.additional_children ?? []).length > 0 || !!slot.via_location || !!slot.via_location_text;
  if (slot.destination_location) stops.push({ label: hasMid ? 'THEN DROP OFF AT' : 'DROP OFF AT', loc: slot.destination_location, byTime: null, endTime: null });
  else if (slot.destination_text) stops.push({ label: hasMid ? 'THEN DROP OFF AT' : 'DROP OFF AT', loc: { label: slot.destination_text, street: null, city: null, notes: null }, byTime: null, endTime: null });

  // ── Plain text body
  const lines: string[] = [];
  lines.push(opts.headline);
  lines.push('');
  lines.push(`${kidNames} — ${slot.title}`);
  const timeRow = aStart && aStart !== slot.pickup_time
    ? `${dateLabel}  ·  Pick up ${time}  ·  Activity ${aStart.slice(0, 5)}${aEnd ? `–${aEnd.slice(0, 5)}` : ''}`
    : `${dateLabel}  ·  Pick up ${time}${aEnd ? ` (ends ${aEnd.slice(0, 5)})` : ''}`;
  lines.push(timeRow);
  lines.push('');
  for (const s of stops) {
    lines.push(s.label + (s.byTime ? `  (by ${s.byTime}${s.endTime ? `–${s.endTime}` : ''})` : ''));
    lines.push(s.loc.label);
    const addr = formatAddress(s.loc);
    if (addr) lines.push(addr);
    const notes = cleanLocNotes(s.loc.notes);
    for (const n of notes) lines.push(n);
    lines.push('');
  }
  if (yaliInTrip) {
    lines.push('STROLLER');
    lines.push('Yali needs a stroller. Tap to message Dani on WhatsApp:');
    lines.push(strollerWaHref());
    lines.push('');
  }
  if (slot.notes) {
    lines.push('NOTES');
    lines.push(slot.notes);
    lines.push('');
  }
  lines.push('— Roditi Family Planner');
  const body = lines.join('\n').trim();

  // ── HTML body — styled card with each stop as a tile
  const stopsHtml = stops.map((s) => {
    const byBadge = s.byTime
      ? `<span style="background:#fff;border:1px solid #e5e2da;border-radius:9999px;padding:2px 8px;font-size:12px;font-weight:700;color:#2a2a22;tabular-nums:1">by ${s.byTime}${s.endTime ? `–${s.endTime}` : ''}</span>`
      : '';
    const noteHtml = cleanLocNotes(s.loc.notes).map((n) => `<div style="font-size:13px;color:#5a5a4f">${escapeHtmlInline(n)}</div>`).join('');
    const addr = formatAddress(s.loc);
    return `<div style="background:#f6f3ec;border-radius:12px;padding:14px 16px;margin:0 0 10px 0">` +
      `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:1.2px;font-weight:700;color:#7a7868;text-transform:uppercase;margin-bottom:6px">` +
      `<span>${escapeHtmlInline(s.label)}</span>${byBadge}` +
      `</div>` +
      `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#2a2a22;line-height:1.15">${escapeHtmlInline(s.loc.label ?? '')}</div>` +
      (addr ? `<div style="font-size:13px;color:#5a5a4f;margin-top:2px">${escapeHtmlInline(addr)}</div>` : '') +
      noteHtml +
      `</div>`;
  }).join('');

  const strollerBlock = yaliInTrip
    ? `<div style="background:#fdebe0;border:1px solid #f3c5a8;border-radius:12px;padding:14px 16px;margin:18px 0">` +
      `<div style="font-size:10px;letter-spacing:1.2px;font-weight:700;color:#c45e36;text-transform:uppercase;margin-bottom:6px">★ Stroller</div>` +
      `<div style="color:#2a2a22;line-height:1.5;font-size:14px;margin-bottom:10px">Yali needs a stroller. Please check with Dani whether the stroller is at the Gan.</div>` +
      `<a href="${strollerWaHref()}" style="display:inline-block;background:#25D366;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700">Message Dani on WhatsApp →</a>` +
      `</div>`
    : '';

  const notesBlock = slot.notes
    ? `<div style="background:#fefbf3;border-left:3px solid #C5A462;padding:10px 14px;margin:18px 0;font-size:14px;color:#2a2a22"><b>Notes</b><br/>${escapeHtmlInline(slot.notes)}</div>`
    : '';

  const html = `<div style="font:15px/1.55 system-ui;color:#2a2a22;max-width:520px">` +
    `<div style="background:#5C7A5F;color:#FBF6EC;padding:18px 20px;border-radius:14px 14px 0 0">` +
    `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;line-height:1.2">${escapeHtmlInline(opts.headline)}</div>` +
    `<div style="font-size:13px;opacity:0.85;margin-top:4px">${escapeHtmlInline(opts.intro)}</div>` +
    `</div>` +
    `<div style="background:#fbf6ec;padding:18px 20px;border-radius:0 0 14px 14px">` +
    `<div style="font-size:11px;letter-spacing:1.2px;font-weight:700;color:#7a7868;text-transform:uppercase">${escapeHtmlInline(allKids.map((k) => k.name).join(' · '))}</div>` +
    `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;font-weight:600;line-height:1.15;margin-top:2px">${escapeHtmlInline(slot.title)}</div>` +
    `<div style="font-size:14px;color:#5a5a4f;margin-top:4px">${escapeHtmlInline(timeRow)}</div>` +
    `<div style="margin-top:14px">${stopsHtml}</div>` +
    strollerBlock +
    notesBlock +
    `<div style="font-size:11px;color:#9a9889;margin-top:20px">— Roditi Family Planner</div>` +
    `</div>` +
    `</div>`;

  return { body, html };
}

function strollerWaHref(): string {
  const daniPhone = (process.env.NEXT_PUBLIC_DANI_PHONE ?? '').replace(/[^\d]/g, '');
  const message = "Hi Dani, I'm picking up Yali today — is the stroller already at the Gan?";
  return daniPhone
    ? `https://wa.me/${daniPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Mirror SlotDetailModal's note cleanup: drop opening-hours lines,
 *  drop "Soccer pickup"-style descriptor labels, strip Ganenet:/Coach:
 *  prefixes, and trim trailing punctuation so each line displays clean. */
function cleanLocNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return notes
    .split(/\n+|(?<=[\.\!])\s+/)
    .map((s: string) => s.trim())
    .map((line: string) => line.replace(/[\.\s]+$/, ''))
    .filter(Boolean)
    .filter((line: string) => !/^(open|dismiss(?:es)?|closes?|hours?)\b/i.test(line))
    .filter((line: string) => !/^[\w\s'’\-]+\s+(pick\s*up|drop[\s-]*off|dropoff)$/i.test(line))
    .map((line: string) => line.replace(/^(ganenet|trainer|coach|teacher|guide|instructor|nanny|contact)\s*:\s*/i, ''));
}

function subtract15(t: string): string {
  const [h, m] = t.split(':').map(Number);
  let total = h * 60 + m - 15;
  if (total < 0) total = 0;
  const h2 = Math.floor(total / 60);
  const m2 = total % 60;
  return `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00`;
}

function escapeHtmlInline(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
