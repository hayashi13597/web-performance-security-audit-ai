import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_SESSION_COOKIE,
  SESSION_TTL_MS,
  consumeState,
  createSession,
  createState,
  deleteSession,
  exchangeCode,
  fetchGitHubUser,
  fetchUserRepos,
  getSession,
  oauthConfig,
} from '@/lib/github-session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const MINUTE = 60 * 1000;

describe('OAuth state (CSRF)', () => {
  it('single-use: consume lần 1 trả về next, lần 2 trả về null', () => {
    const state = createState('/scan/abc123', 1_000_000);
    expect(consumeState(state, 1_000_000 + 1000)).toBe('/scan/abc123');
    expect(consumeState(state, 1_000_000 + 1000)).toBeNull();
  });

  it('hết hạn sau 10 phút', () => {
    const state = createState('/', 1_000_000);
    expect(consumeState(state, 1_000_000 + 9 * MINUTE)).not.toBeNull();
    const expired = createState('/', 1_000_000);
    expect(consumeState(expired, 1_000_000 + 11 * MINUTE)).toBeNull();
  });

  it('state lạ → null', () => {
    expect(consumeState('khong-ton-tai', Date.now())).toBeNull();
  });
});

describe('Phiên đăng nhập (RAM)', () => {
  it('tạo → đọc → xoá', () => {
    const session = createSession('gho_token', 'octocat', 'https://avatar', 1_000_000);
    const got = getSession(session.id, 1_000_000 + 1000);
    expect(got).toMatchObject({ token: 'gho_token', login: 'octocat', avatarUrl: 'https://avatar' });
    expect(got?.expiresAt).toBe(1_000_000 + SESSION_TTL_MS);
    deleteSession(session.id);
    expect(getSession(session.id, 1_000_000 + 1000)).toBeUndefined();
  });

  it('hết hạn TTL 8 giờ → getSession trả undefined', () => {
    const session = createSession('gho_token', 'octocat', '', 1_000_000);
    expect(getSession(session.id, 1_000_000 + SESSION_TTL_MS - 1)).not.toBeUndefined();
    expect(getSession(session.id, 1_000_000 + SESSION_TTL_MS)).toBeUndefined();
  });

  it('id cookie là hằng số ổn định', () => {
    expect(GITHUB_SESSION_COOKIE).toBe('wpsa_gh_session');
  });
});

describe('oauthConfig', () => {
  const originalId = process.env.GITHUB_CLIENT_ID;
  const originalSecret = process.env.GITHUB_CLIENT_SECRET;

  afterEach(() => {
    if (originalId === undefined) delete process.env.GITHUB_CLIENT_ID;
    else process.env.GITHUB_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
    else process.env.GITHUB_CLIENT_SECRET = originalSecret;
  });

  it('đủ 2 biến → cấu hình; thiếu → null', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(oauthConfig()).toBeNull();

    process.env.GITHUB_CLIENT_ID = '  iv1.abc  ';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    expect(oauthConfig()).toEqual({ clientId: 'iv1.abc', clientSecret: 'secret' });
  });
});

describe('exchangeCode', () => {
  const config = { clientId: 'cid', clientSecret: 'csecret' };

  it('thành công → access token', async () => {
    const fetchMock = (async () => jsonResponse(200, { access_token: 'gho_ok' })) as typeof fetch;
    await expect(exchangeCode(fetchMock, config, 'code', 'http://localhost:3000/cb')).resolves.toBe('gho_ok');
  });

  it('GitHub trả error payload → ném lỗi kèm error_description', async () => {
    const fetchMock = (async () =>
      jsonResponse(200, {
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired',
      })) as typeof fetch;
    await expect(exchangeCode(fetchMock, config, 'sai', 'http://localhost:3000/cb')).rejects.toThrow(
      /The code passed is incorrect or expired/,
    );
  });

  it('HTTP không phải 2xx → ném lỗi kèm status', async () => {
    const fetchMock = (async () => jsonResponse(500, {})) as typeof fetch;
    await expect(exchangeCode(fetchMock, config, 'code', 'http://localhost:3000/cb')).rejects.toThrow(
      /HTTP 500/,
    );
  });
});

describe('fetchGitHubUser', () => {
  it('thành công → login + avatarUrl', async () => {
    const fetchMock = (async () =>
      jsonResponse(200, { login: 'octocat', avatar_url: 'https://example.com/a.png' })) as typeof fetch;
    await expect(fetchGitHubUser(fetchMock, 't')).resolves.toEqual({
      login: 'octocat',
      avatarUrl: 'https://example.com/a.png',
    });
  });

  it('thiếu login / HTTP lỗi → ném lỗi', async () => {
    const noLogin = (async () => jsonResponse(200, {})) as typeof fetch;
    await expect(fetchGitHubUser(noLogin, 't')).rejects.toThrow(/login/);
    const unauthorized = (async () => jsonResponse(401, { message: 'Bad credentials' })) as typeof fetch;
    await expect(fetchGitHubUser(unauthorized, 't')).rejects.toThrow(/HTTP 401/);
  });
});

describe('fetchUserRepos', () => {
  it('thành công → map đủ trường, bỏ entry thiếu full_name', async () => {
    const fetchMock = (async () =>
      jsonResponse(200, [
        {
          full_name: 'octocat/hello-world',
          html_url: 'https://github.com/octocat/hello-world',
          private: false,
          language: 'TypeScript',
          default_branch: 'main',
          pushed_at: '2026-08-01T00:00:00Z',
          description: 'demo repo',
        },
        { full_name: 'octocat/secret', html_url: 'https://github.com/octocat/secret', private: true },
        { html_url: 'https://github.com/broken' },
      ])) as typeof fetch;
    const repos = await fetchUserRepos(fetchMock, 't');
    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({
      fullName: 'octocat/hello-world',
      url: 'https://github.com/octocat/hello-world',
      private: false,
      language: 'TypeScript',
      defaultBranch: 'main',
      pushedAt: '2026-08-01T00:00:00Z',
      description: 'demo repo',
    });
    expect(repos[1]).toMatchObject({ fullName: 'octocat/secret', private: true, language: undefined });
  });

  it('truyền page → URL phân trang + sort=pushed', async () => {
    let requested = '';
    const fetchMock = (async (url: string | URL | Request) => {
      requested = String(url);
      return jsonResponse(200, []);
    }) as unknown as typeof fetch;
    await fetchUserRepos(fetchMock, 't', 2);
    expect(requested).toContain('page=2');
    expect(requested).toContain('sort=pushed');
    expect(requested).toContain('affiliation=owner%2Ccollaborator%2Corganization_member');
  });

  it('HTTP lỗi → ném lỗi kèm status', async () => {
    const fetchMock = (async () => jsonResponse(401, { message: 'Bad credentials' })) as typeof fetch;
    await expect(fetchUserRepos(fetchMock, 't')).rejects.toThrow(/HTTP 401/);
  });
});
