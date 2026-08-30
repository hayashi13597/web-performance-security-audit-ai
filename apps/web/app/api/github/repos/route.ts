import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { GITHUB_SESSION_COOKIE, fetchUserRepos, getSession } from '@/lib/github-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Danh sách repo GitHub của phiên đã đăng nhập (cho picker trên trang chủ). */
export async function GET(req: Request): Promise<NextResponse> {
  const session = getSession((await cookies()).get(GITHUB_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: 'Chưa đăng nhập GitHub — bấm "Đăng nhập với GitHub" ở trang chủ.' },
      { status: 401 },
    );
  }

  const page = Number(new URL(req.url).searchParams.get('page')) > 0
    ? Number(new URL(req.url).searchParams.get('page'))
    : 1;

  try {
    const repos = await fetchUserRepos(fetch, session.token, page);
    return NextResponse.json({ page, repos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /\b401\b/.test(msg) ? ' — phiên đã hết hạn, hãy đăng nhập lại.' : '';
    return NextResponse.json({ error: `Lấy danh sách repo thất bại: ${msg}${hint}` }, { status: 502 });
  }
}
