/**
 * Notification + system-event log helpers.
 *
 * `sendAndLog` wraps emailProvider.send so every outbound email gets a
 * row in notification_events automatically (with status + recipient).
 * `logNotification` is the bare insert for cases where the underlying
 * action isn't an email — calendar invites, WhatsApp link builds, etc.
 *
 * Both swallow logging failures so a flaky DB doesn't block the actual
 * notification.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { emailProvider } from './notify';

export type NotificationKind =
  | 'email_sent' | 'email_failed'
  | 'calendar_invite' | 'calendar_invite_failed'
  | 'calendar_title_updated' | 'calendar_title_failed'
  | 'wa_link_built' | 'wa_link_tapped';

export type NotificationChannel = 'email' | 'google_calendar' | 'whatsapp';

interface LogArgs {
  household_id: string;
  kind: NotificationKind;
  channel?: NotificationChannel;
  recipient?: string | null;
  subject?: string | null;
  slot_id?: string | null;
  actor_user_id?: string | null;
  status?: 'sent' | 'failed' | 'queued';
  error?: string | null;
}

export async function logNotification(sb: SupabaseClient, args: LogArgs) {
  try {
    await sb.from('notification_events').insert({
      household_id: args.household_id,
      kind: args.kind,
      channel: args.channel ?? null,
      recipient: args.recipient ?? null,
      subject: args.subject ?? null,
      slot_id: args.slot_id ?? null,
      actor_user_id: args.actor_user_id ?? null,
      status: args.status ?? (args.kind.endsWith('_failed') ? 'failed' : 'sent'),
      error: args.error ?? null,
    });
  } catch (e) {
    console.error('logNotification failed', e);
  }
}

interface SendArgs {
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
}

interface SendAndLogArgs extends SendArgs {
  household_id: string;
  slot_id?: string | null;
  actor_user_id?: string | null;
}

export async function sendAndLog(
  sb: SupabaseClient,
  args: SendAndLogArgs
): Promise<{ error?: any }> {
  const r = await emailProvider.send({
    to: args.to,
    subject: args.subject,
    body: args.body,
    html: args.html,
    attachments: args.attachments,
  });
  await logNotification(sb, {
    household_id: args.household_id,
    kind: r.error ? 'email_failed' : 'email_sent',
    channel: 'email',
    recipient: args.to,
    subject: args.subject,
    slot_id: args.slot_id ?? null,
    actor_user_id: args.actor_user_id ?? null,
    status: r.error ? 'failed' : 'sent',
    error: r.error ? String((r.error as any)?.message ?? r.error) : null,
  });
  return r;
}
