import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { GITHUB_SESSION_COOKIE, deleteSession } from '@/lib/github-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  deleteSession(jar.get(GITHUB_SESSION_COOKIE)?.value);
  jar.delete(GITHUB_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
