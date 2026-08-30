import { NextResponse } from 'next/server';
import {
  GITHUB_SESSION_COOKIE,
  SESSION_TTL_MS,
  callbackUrl,
  consumeState,
  createSession,
  exchangeCode,
  fetchGitHubUser,
  oauthConfig,
} from '@/lib/github-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(req: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/?auth_error=${code}`, req.url));
}

/** Bước 2 của OAuth: GitHub redirect về đây kèm code — đổi lấy token rồi tạo session. */
export async function GET(req: Request): Promise<NextResponse> {
  const config = oauthConfig();
  if (!config) return fail(req, 'not_configured');

  const url = new URL(req.url);
  // GitHub gửi ?error=access_denied nếu người dùng bấm Cancel
  if (url.searchParams.get('error')) return fail(req, 'denied');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail(req, 'invalid_callback');

  const next = consumeState(state);
  if (!next) return fail(req, 'state_expired');

  try {
    const token = await exchangeCode(fetch, config, code, callbackUrl(url.origin));
    const user = await fetchGitHubUser(fetch, token);
    const session = createSession(token, user.login, user.avatarUrl);
    const res = NextResponse.redirect(new URL(next, req.url));
    res.cookies.set(GITHUB_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch {
    return fail(req, 'exchange_failed');
  }
}
