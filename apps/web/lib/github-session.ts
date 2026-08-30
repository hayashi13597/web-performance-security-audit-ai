import { randomBytes } from 'node:crypto';

/**
 * Phiên đăng nhập GitHub OAuth. Access token chỉ nằm trong RAM của process —
 * trình duyệt chỉ giữ HttpOnly cookie chứa session id, không secret nào xuống đĩa.
 * Server restart → mất session → người dùng đăng nhập lại (cookie cũ tự bị dọn).
 */

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Cấu hình OAuth từ .env; thiếu một trong hai biến = OAuth tắt (fallback PAT tay). */
export function oauthConfig(): GithubOAuthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export const GITHUB_SESSION_COOKIE = 'wpsa_gh_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 tiếng
const STATE_TTL_MS = 10 * 60 * 1000; // CSRF state chỉ sống 10 phút

export interface GithubSession {
  id: string;
  token: string;
  login: string;
  avatarUrl: string;
  expiresAt: number;
}

interface PendingState {
  next: string;
  expiresAt: number;
}

interface SessionStore {
  states: Map<string, PendingState>;
  sessions: Map<string, GithubSession>;
}

// Cache trên globalThis để sống sót hot-reload của Next dev (pattern của job-db.ts)
const globalStore = globalThis as unknown as { __wpsaGithubSessions?: SessionStore };

function evictExpired(now: number): void {
  const s = store();
  for (const [key, value] of s.states) if (value.expiresAt <= now) s.states.delete(key);
  for (const [key, value] of s.sessions) if (value.expiresAt <= now) s.sessions.delete(key);
}

function store(): SessionStore {
  if (!globalStore.__wpsaGithubSessions) {
    globalStore.__wpsaGithubSessions = { states: new Map(), sessions: new Map() };
  }
  return globalStore.__wpsaGithubSessions;
}

/** Sinh state CSRF cho luồng authorize — single-use, hết hạn sau 10 phút. */
export function createState(next: string, now = Date.now()): string {
  evictExpired(now);
  const state = randomBytes(16).toString('hex');
  store().states.set(state, { next, expiresAt: now + STATE_TTL_MS });
  return state;
}

/** Tiêu thụ state một lần: trả về redirect target gốc, hoặc null nếu sai/hết hạn. */
export function consumeState(state: string, now = Date.now()): string | null {
  evictExpired(now);
  const pending = store().states.get(state);
  if (!pending) return null;
  store().states.delete(state);
  return pending.next;
}

export function createSession(
  token: string,
  login: string,
  avatarUrl: string,
  now = Date.now(),
): GithubSession {
  evictExpired(now);
  const session: GithubSession = {
    id: randomBytes(24).toString('hex'),
    token,
    login,
    avatarUrl,
    expiresAt: now + SESSION_TTL_MS,
  };
  store().sessions.set(session.id, session);
  return session;
}

export function getSession(id: string | undefined, now = Date.now()): GithubSession | undefined {
  if (!id) return undefined;
  evictExpired(now);
  return store().sessions.get(id);
}

export function deleteSession(id: string | undefined): void {
  if (!id) return;
  store().sessions.delete(id);
}

/** Callback URL phải khớp với cái đã đăng ký trên GitHub OAuth App. */
export function callbackUrl(requestOrigin: string): string {
  const base = process.env.WPSA_PUBLIC_URL?.trim().replace(/\/+$/, '');
  return `${base || requestOrigin}/api/auth/github/callback`;
}

/** Đổi authorization code lấy access token (POST github.com/login/oauth/access_token). */
export async function exchangeCode(
  fetchImpl: typeof fetch,
  config: GithubOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub trả HTTP ${res.status} khi đổi access_token`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      data.error_description
        ? `GitHub từ chối authorization code: ${data.error_description}`
        : 'GitHub không trả về access_token — kiểm tra GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET',
    );
  }
  return data.access_token;
}

/** Đọc login + avatar từ /user để hiển thị trạng thái đăng nhập trên dashboard. */
export async function fetchGitHubUser(
  fetchImpl: typeof fetch,
  token: string,
): Promise<{ login: string; avatarUrl: string }> {
  const res = await fetchImpl('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'WPSA-Audit/0.1',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub trả HTTP ${res.status} khi đọc thông tin user`);
  }
  const data = (await res.json()) as { login?: string; avatar_url?: string };
  if (!data.login) throw new Error('GitHub không trả về login từ /user');
  return { login: data.login, avatarUrl: data.avatar_url ?? '' };
}

export interface GithubRepoInfo {
  /** "owner/name" */
  fullName: string;
  url: string;
  private: boolean;
  language?: string;
  defaultBranch?: string;
  pushedAt?: string;
  description?: string;
}

/** Danh sách repo của user đã đăng nhập (mới push trước) — dùng cho picker chọn repo. */
export async function fetchUserRepos(
  fetchImpl: typeof fetch,
  token: string,
  page = 1,
): Promise<GithubRepoInfo[]> {
  const params = new URLSearchParams({
    sort: 'pushed',
    direction: 'desc',
    per_page: '100',
    // repo của bản thân + được thêm làm collaborator + của org user thuộc về
    affiliation: 'owner,collaborator,organization_member',
    page: String(page),
  });
  const res = await fetchImpl(`https://api.github.com/user/repos?${params}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'WPSA-Audit/0.1',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub trả HTTP ${res.status} khi đọc danh sách repo`);
  }
  const data = (await res.json()) as Array<{
    full_name?: string;
    html_url?: string;
    private?: boolean;
    language?: string | null;
    default_branch?: string | null;
    pushed_at?: string | null;
    description?: string | null;
  }>;
  return data
    .filter((r) => r.full_name && r.html_url)
    .map((r) => ({
      fullName: r.full_name as string,
      url: r.html_url as string,
      private: r.private === true,
      language: r.language ?? undefined,
      defaultBranch: r.default_branch ?? undefined,
      pushedAt: r.pushed_at ?? undefined,
      description: r.description ?? undefined,
    }));
}
