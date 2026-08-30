'use client';

import { useEffect, useMemo, useState } from 'react';

// Nhân bản phía client (giống CATEGORY_LABELS ở app/scan/[id]/page.tsx) —
// không import từ lib/github-session vì module đó dùng node:crypto (server-only).
interface GithubRepoInfo {
  fullName: string;
  url: string;
  private: boolean;
  language?: string;
  defaultBranch?: string;
  pushedAt?: string;
  description?: string;
}

function relativeDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days < 30) return `${days} ngày trước`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} tháng trước`;
  return `${Math.floor(months / 12)} năm trước`;
}

export function RepoPickerDialog({
  onSelect,
  onClose,
}: {
  onSelect: (repoUrl: string) => void;
  onClose: () => void;
}) {
  const [repos, setRepos] = useState<GithubRepoInfo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async (targetPage: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/github/repos?page=${targetPage}`);
      const data = (await res.json()) as { repos?: GithubRepoInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Không lấy được danh sách repo');
      setRepos((prev) => (append ? [...prev, ...(data.repos ?? [])] : data.repos ?? []));
      setPage(targetPage);
      setHasMore((data.repos ?? []).length === 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.language?.toLowerCase().includes(q),
    );
  }, [repos, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Chọn repo GitHub của bạn</h3>
        <p className="mt-1 text-xs text-slate-500">
          Sắp theo lần push gần nhất (tối đa 100 repo mỗi trang, gồm cả repo org bạn tham gia).
        </p>

        <input
          autoFocus
          className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
          placeholder="Tìm theo tên / mô tả / ngôn ngữ…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-3 max-h-72 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Đang tải repo…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {repos.length === 0 ? 'Tài khoản này chưa có repo nào' : 'Không có repo nào khớp từ khoá'}
            </p>
          ) : (
            filtered.map((repo) => {
              const pushed = relativeDate(repo.pushedAt);
              return (
                <button
                  key={repo.fullName}
                  onClick={() => onSelect(repo.url)}
                  title={repo.description ?? repo.fullName}
                  className="block w-full px-3 py-2 text-left transition hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">{repo.fullName}</span>
                    {repo.private && (
                      <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                        private
                      </span>
                    )}
                    {pushed && <span className="ml-auto shrink-0 text-[10px] text-slate-500">push {pushed}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    {repo.language && <span className="text-sky-400/80">{repo.language}</span>}
                    {repo.description && <span className="truncate">{repo.description}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {hasMore && !loading && (
          <button
            onClick={() => void load(page + 1, true)}
            className="mt-2 w-full rounded-lg border border-slate-700 px-4 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Tải thêm 100 repo nữa…
          </button>
        )}

        <div className="mt-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
