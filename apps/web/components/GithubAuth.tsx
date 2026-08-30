'use client';

import { useCallback, useEffect, useState } from 'react';

export interface GithubSessionState {
  loaded: boolean;
  configured: boolean;
  authenticated: boolean;
  login?: string;
  avatarUrl?: string;
}

const IDLE: GithubSessionState = { loaded: false, configured: false, authenticated: false };

/** Theo dõi trạng thái đăng nhập GitHub (OAuth) cho toàn trang — dùng cùng GithubAuth. */
export function useGithubSession(): {
  session: GithubSessionState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
} {
  const [session, setSession] = useState<GithubSessionState>(IDLE);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = (await res.json()) as {
        configured?: boolean;
        authenticated?: boolean;
        login?: string;
        avatarUrl?: string;
      };
      setSession({
        loaded: true,
        configured: data.configured === true,
        authenticated: data.authenticated === true,
        login: data.login,
        avatarUrl: data.avatarUrl,
      });
    } catch {
      setSession({ loaded: true, configured: false, authenticated: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/github/logout', { method: 'POST' });
    await refresh();
  }, [refresh]);

  return { session, refresh, logout };
}

/** Nút đăng nhập / chip trạng thái GitHub ở đầu trang chủ. Ẩn khi OAuth chưa cấu hình. */
export function GithubAuth({
  session,
  onLogout,
}: {
  session: GithubSessionState;
  onLogout: () => Promise<void>;
}) {
  if (!session.loaded || !session.configured) return null;

  if (!session.authenticated) {
    return (
      <div className="mb-6 flex justify-end">
        <a
          href="/api/auth/github/start"
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-1.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
        >
          Đăng nhập với GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="mb-6 flex justify-end">
      <div className="flex items-center gap-2.5 rounded-full border border-slate-700 bg-slate-900/80 py-1 pl-1.5 pr-4">
        {session.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
        )}
        <span className="text-xs text-slate-300">
          GitHub: <span className="font-semibold text-sky-300">{session.login}</span>
        </span>
        <button onClick={() => void onLogout()} className="text-xs text-slate-500 transition hover:text-slate-300">
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
