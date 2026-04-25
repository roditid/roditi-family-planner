/**
 * Notification abstraction. v1 uses Resend for email. Adding a Twilio or
 * WhatsApp channel later means implementing the same `NotifyProvider`
 * interface and swapping the default export. The cron job doesn't care
 * which provider is in use.
 */
import { Resend } from 'resend';
import type { SlotView } from './types';

export interface NotifyMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface NotifyProvider {
  channel: 'email' | 'sms';
  send(msg: NotifyMessage): Promise<{ id: string | null; error: string | null }>;
}

export const emailProvider: NotifyProvider = {
  channel: 'email',
  async send({ to, subject, body, html }) {
    if (!process.env.RESEND_API_KEY) {
      return { id: null, error: 'RESEND_API_KEY not configured' };
    }
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.REMINDER_FROM_EMAIL || 'Pickup Planner <onboarding@resend.dev>',
      to,
      subject,
      text: body,
      html: html ?? `<pre style="font:16px/1.5 system-ui">${escapeHtml(body)}</pre>`,
    });
    if (error) return { id: null, error: String(error.message ?? error) };
    return { id: data?.id ?? null, error: null };
  },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Render the reminder copy for a slot. One line for the subject, a tidy
 * multi-line body — optimized for quick glanceability on a phone.
 */
export function renderReminder(slot: SlotView) {
  const pickup = slot.pickup_location?.label ?? slot.pickup_location_text ?? 'location TBD';
  const pickupAddr = [slot.pickup_location?.street, slot.pickup_location?.city].filter(Boolean).join(', ');
  const dest = slot.destination_location?.label ?? slot.destination_text;
  const destAddr = [slot.destination_location?.street, slot.destination_location?.city].filter(Boolean).join(', ');

  const lines: string[] = [];
  lines.push(`Today's pickup: ${slot.child.name} at ${slot.pickup_time.slice(0, 5)}`);
  lines.push('');
  lines.push(`Pick up from: ${pickup}${pickupAddr ? ` (${pickupAddr})` : ''}`);
  if (dest) lines.push(`Drop off at: ${dest}${destAddr ? ` (${destAddr})` : ''}`);
  if (slot.notes) lines.push(`Note: ${slot.notes}`);
  lines.push('');
  lines.push('— Pickup Planner');

  return {
    subject: `Today: pick up ${slot.child.name} at ${slot.pickup_time.slice(0, 5)} from ${pickup}`,
    body: lines.join('\n'),
  };
}

/**
 * Render a "you've claimed this pickup" confirmation. Includes EVERY stop
 * (pickup → via → destination) with addresses, door codes, ganenet phones,
 * and the stroller note when Yali is in the trip. Designed so the helper
 * can read the email on their phone in lieu of the screenshot.
 */
export function renderClaimConfirmation(slot: SlotView, helperName: string | null) {
  const allKids = [slot.child, ...(slot.additional_children ?? [])];
  const kidNames = allKids.map((k) => k.name).join(' → ');
  const time = slot.pickup_time.slice(0, 5);
  const dateLabel = (() => {
    const d = new Date(slot.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  const stopBlocks: string[] = [];
  // Just NAME + ADDRESS per stop — no door codes, no ganenet, no hours.
  // Those are accessible inside the app (the modal shows them); the email
  // stays clean and screenshot-friendly.
  const fmtStop = (label: string, loc: any) => {
    if (!loc) return null;
    const addr = [loc.street, loc.city].filter(Boolean).join(', ');
    const parts: string[] = [`${label}`, loc.label];
    if (addr) parts.push(addr);
    return parts.join('\n');
  };
  const pickup = fmtStop('PICK UP FROM', slot.pickup_location);
  // Combined-sibling stops between primary's Gan and the via/destination
  const additionalStops: string[] = [];
  for (const k of slot.additional_children ?? []) {
    const sl = (k as any).school_location;
    const block = sl ? fmtStop(`THEN PICK UP ${k.name.toUpperCase()}`, sl) : null;
    if (block) additionalStops.push(block);
  }
  const hasMidStops = additionalStops.length > 0 || !!slot.via_location;
  const via = slot.via_location ? fmtStop('THEN GO TO', slot.via_location) : null;
  const dest = fmtStop(hasMidStops ? 'THEN DROP OFF AT' : 'DROP OFF AT', slot.destination_location);
  if (pickup) stopBlocks.push(pickup);
  for (const s of additionalStops) stopBlocks.push(s);
  if (via) stopBlocks.push(via);
  if (dest) stopBlocks.push(dest);

  const yaliInTrip = allKids.some((k) => k.name.toLowerCase() === 'yali');

  const lines: string[] = [];
  lines.push(`✓ You're on this pickup, ${(helperName ?? '').split(' ')[0] || 'thanks'}!`);
  lines.push('');
  lines.push(`${kidNames} — ${slot.title}`);
  lines.push(`${dateLabel} at ${time}`);
  lines.push('');
  for (const block of stopBlocks) {
    lines.push(block);
    lines.push('');
  }
  if (yaliInTrip) {
    lines.push('STROLLER');
    lines.push('Yali needs a stroller. Please check with Dani whether the stroller is at the Gan.');
    lines.push('');
  }
  if (slot.notes) {
    lines.push('NOTE');
    lines.push(slot.notes);
    lines.push('');
  }
  lines.push('— Pickup Planner');

  return {
    subject: `Pickup confirmed: ${kidNames} on ${dateLabel} at ${time}`,
    body: lines.join('\n').trim(),
  };
}
