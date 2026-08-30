import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { GITHUB_SESSION_COOKIE, getSession, oauthConfig } from '@/lib/github-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trạng thái đăng nhập cho UI (không bao giờ trả access token). */
export async function GET(): Promise<NextResponse> {
  const config = oauthConfig();
  if (!config) {
    return NextResponse.json({ configured: false, authenticated: false });
  }
  const jar = await cookies();
  const session = getSession(jar.get(GITHUB_SESSION_COOKIE)?.value);
  if (!session) {
    // Cookie cũ (server đã restart giữa chừng) — báo chưa đăng nhập và dọn cookie
    const res = NextResponse.json({ configured: true, authenticated: false });
    res.cookies.delete(GITHUB_SESSION_COOKIE);
    return res;
  }
  return NextResponse.json({
    configured: true,
    authenticated: true,
    login: session.login,
    avatarUrl: session.avatarUrl,
  });
}
