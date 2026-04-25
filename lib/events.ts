/**
 * One module that handles both:
 *   - logging slot events (admin activity feed)
 *   - notifying admins by email when something changes
 *
 * Both demo + real modes are routed through here.
 */
import { supabaseAdmin } from './supabase/admin';
import { demoMode } from './demo-session';
import * as demo from './demo-store';
import { emailProvider } from './notify';

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
  } else {
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
  // Fire admin notification (best-effort, don't block the action on email failure)
  notifyAdmins(e).catch((err) => console.error('admin notify failed:', err));
}

async function notifyAdmins(e: RecordedEvent) {
  if (!process.env.RESEND_API_KEY) return; // silent in dev/demo without keys

  // Resolve who, what, and the slot's child + time for the email body.
  const ctx = await loadContext(e);
  if (!ctx) return;

  const verb = verbFor(e.kind);
  const subject = `${ctx.actorName} ${verb} ${ctx.slotLabel}`;
  const lines: string[] = [];
  lines.push(subject);
  lines.push('');
  lines.push(`Slot: ${ctx.slotLabel}`);
  if (ctx.subjectName && e.kind !== 'released' && e.kind !== 'unassigned') {
    lines.push(`Now assigned to: ${ctx.subjectName}`);
  }
  if (e.kind === 'released' || e.kind === 'unassigned') {
    lines.push('Currently unclaimed.');
  }
  lines.push('');
  lines.push(`See the dashboard: ${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/admin`);

  for (const admin of ctx.admins) {
    if (!admin.email) continue;
    await emailProvider.send({ to: admin.email, subject, body: lines.join('\n') });
  }
}

async function loadContext(e: RecordedEvent) {
  if (demoMode()) {
    const slot = demo.slotById(e.slotId);
    if (!slot) return null;
    const child = demo.children().find((c) => c.id === slot.child_id);
    const actor = e.actorUserId ? demo.getUser(e.actorUserId) : null;
    const subject = e.subjectUserId ? demo.getUser(e.subjectUserId) : null;
    return {
      actorName: actor?.full_name ?? 'Someone',
      subjectName: subject?.full_name ?? null,
      slotLabel: `${child?.name ?? '?'} · ${slot.title} · ${slot.date} ${slot.pickup_time.slice(0,5)}`,
      admins: demo.allUsers().filter((u) => u.role === 'admin'),
    };
  }
  const sb = supabaseAdmin();
  const [{ data: slot }, { data: actor }, { data: subject }, { data: admins }] = await Promise.all([
    sb.from('pickup_slots').select('title, date, pickup_time, child:children(name)').eq('id', e.slotId).maybeSingle(),
    e.actorUserId ? sb.from('profiles').select('full_name, email').eq('id', e.actorUserId).maybeSingle() : Promise.resolve({ data: null }),
    e.subjectUserId ? sb.from('profiles').select('full_name, email').eq('id', e.subjectUserId).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('household_members').select('profiles:user_id(full_name, email)').eq('household_id', e.householdId).eq('role', 'admin'),
  ]);
  if (!slot) return null;
  return {
    actorName: (actor as any)?.full_name ?? 'Someone',
    subjectName: (subject as any)?.full_name ?? null,
    slotLabel: `${(slot as any).child?.name ?? '?'} · ${slot.title} · ${slot.date} ${slot.pickup_time.slice(0,5)}`,
    admins: (admins ?? []).map((a: any) => a.profiles).filter(Boolean),
  };
}

function verbFor(kind: EventKind) {
  switch (kind) {
    case 'claimed':    return 'claimed';
    case 'released':   return 'released';
    case 'reassigned': return 'was reassigned to';
    case 'unassigned': return 'unassigned';
    case 'created':    return 'added';
    case 'updated':    return 'updated';
  }
}
