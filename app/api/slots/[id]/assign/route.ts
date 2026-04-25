import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/permissions';

// Admin override — force-assign a slot to a specific helper, releasing any
// existing active assignment.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAdmin();
    const sb = supabaseServer();
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    // Release whatever's active
    await sb
      .from('slot_assignments')
      .update({ status: 'overridden', released_at: new Date().toISOString() })
      .eq('pickup_slot_id', params.id)
      .eq('status', 'active');

    await sb.from('slot_assignments').insert({
      pickup_slot_id: params.id,
      assigned_to_user_id: userId,
      assigned_by_user_id: ctx.user.id,
      status: 'active',
    });
    await sb.from('pickup_slots').update({ status: 'claimed' }).eq('id', params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
}
