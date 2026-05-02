/**
 * Slot-event logging for /admin/activity. Used to ALSO email admins on
 * every event but that path was retired in favor of the dedicated
 * sendAdminClaimUpdate flow (lib/notify-admins.ts) — which carries the
 * full week summary, Liezel forward button, and respects the
 * Saturday→Sunday suppression window. Two systems were sending two
 * emails per change; only the new one remains.
 */
import { supabaseAdmin } from './supabase/admin';
import { demoMode } from './demo-session';
import * as demo from './demo-store';

type EventKind = 'created' | 'claimed' | 'released' | 'reassigned' | 'unassigned' | 'updated';

export interface RecordedEvent {
  householdId: string;
  slotId: string;
  actorUserId: string | null;       // who took the action
  subjectUserId?: string | null;    // who the slot was assigned to (if any)
  kind: EventKind;
  metadata?: Record<string, any>;
}

export async function recordEvent(e: RecordedEvent) {
  if (demoMode()) {
    demo.logEvent({
      kind: e.kind,
      slot_id: e.slotId,
      actor_user_id: e.actorUserId,
      subject_user_id: e.subjectUserId ?? null,
    });
    return;
  }
  const sb = supabaseAdmin();
  await sb.from('slot_events').insert({
    household_id: e.householdId,
    pickup_slot_id: e.slotId,
    actor_user_id: e.actorUserId,
    subject_user_id: e.subjectUserId ?? null,
    kind: e.kind,
    metadata: e.metadata ?? null,
  });
}
