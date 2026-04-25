import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { oauthClient } from '@/lib/google/calendar';

// Step 2: exchange the authorization code for tokens, persist on the
// household's connected_calendars row (one per household for v1).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const code = new URL(req.url).searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });

    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Figure out which Google account this is.
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();

    const sb = supabaseServer();
    await sb.from('connected_calendars').upsert({
      household_id: ctx.household!.id,
      owner_user_id: ctx.user.id,
      google_account_email: me.data.email!,
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      last_sync_status: 'connected — awaiting first sync',
    }, { onConflict: 'household_id' });

    return NextResponse.redirect(new URL('/admin/calendar?connected=1', req.url));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
