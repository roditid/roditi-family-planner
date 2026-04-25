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
