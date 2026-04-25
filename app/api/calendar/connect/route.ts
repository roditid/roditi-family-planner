import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/permissions';
import { oauthClient, GOOGLE_SCOPES } from '@/lib/google/calendar';

// Step 1 of Google OAuth for calendar connection. Kicks the admin to Google.
// The callback (/api/calendar/connect/callback) stores the tokens.
export async function GET() {
  try {
    await requireAdmin();
    const client = oauthClient();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',        // force refresh_token return
      scope: GOOGLE_SCOPES,
    });
    return NextResponse.redirect(url);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
}
