'use client';

import { useEffect, useRef, useState } from 'react';

export function TokenDialog({
  defaultRepo,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  defaultRepo: string;
  busy: boolean;
  error: string | null;
  onSubmit: (repo: string, token: string, baseBranch: string) => void;
  onClose: () => void;
}) {
  const [repo, setRepo] = useState(defaultRepo);
  const [token, setToken] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [session, setSession] = useState<{ authenticated: boolean; login?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((d: { authenticated?: boolean; login?: string }) =>
        setSession({ authenticated: d.authenticated === true, login: d.login }),
      )
      .catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const signedIn = session?.authenticated === true;
  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Tạo Pull Request sửa lỗi</h3>
        <p className="mt-1 text-xs text-slate-400">
          Token chỉ dùng trong request này (không lưu). PAT cần quyền{' '}
          <span className="text-slate-300">Contents: Read and write</span> +{' '}
          <span className="text-slate-300">Pull requests: Read and write</span> (fine-grained), hoặc scope{' '}
          <span className="text-slate-300">repo</span> (classic).
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-300">Repo đích (owner/name)</span>
            <input ref={inputRef} className={inputClass} placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </label>

          {signedIn ? (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              ✓ Đang dùng phiên GitHub của <span className="font-semibold">{session?.login}</span> — không cần
              dán token. Muốn dùng PAT khác thì đăng xuất ở trang chủ.
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-300">GitHub token</span>
              <input className={inputClass} type="password" placeholder="github_pat_… / ghp_…" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-300">
              Branch gốc <span className="text-slate-500">(để trống = default branch)</span>
            </span>
            <input className={inputClass} placeholder="main" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40">
            Huỷ
          </button>
          <button
            onClick={() => onSubmit(repo.trim(), token.trim(), baseBranch.trim())}
            disabled={busy || !repo.trim() || (!signedIn && !token.trim())}
            className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
          >
            {busy ? 'Đang tạo PR…' : 'Tạo PR'}
          </button>
        </div>
      </div>
    </div>
  );
}
