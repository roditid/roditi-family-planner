/**
 * Dev-only endpoint: serves the combined migration SQL with permissive
 * CORS so the Supabase dashboard tab can fetch it and inject into the
 * Monaco editor. Disabled in production.
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('not available in production', { status: 404 });
  }
  const file = path.join(process.cwd(), 'supabase', 'migrations', '_combined.sql');
  const sql = await fs.readFile(file, 'utf8');
  return new NextResponse(sql, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}
