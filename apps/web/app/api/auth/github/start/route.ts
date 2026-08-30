import { NextResponse } from 'next/server';
import { callbackUrl, createState, oauthConfig } from '@/lib/github-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bước 1 của OAuth: redirect người dùng sang GitHub để uỷ quyền. */
export async function GET(req: Request): Promise<NextResponse> {
  const config = oauthConfig();
  if (!config) {
    return NextResponse.redirect(new URL('/?auth_error=not_configured', req.url));
  }

  // Chỉ cho phép quay về path nội bộ sau đăng nhập (chặn open redirect)
  const rawNext = new URL(req.url).searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(new URL(req.url).origin),
    scope: 'repo read:user',
    state: createState(next),
  });
  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
