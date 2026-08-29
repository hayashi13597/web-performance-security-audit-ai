'use client';

import { useCallback, useEffect, useState } from 'react';

interface DirEntry {
  name: string;
  path: string;
}

interface ListingResponse {
  path?: string | null;
  parent?: string | null;
  home?: string;
  roots?: string[];
  entries?: DirEntry[];
  error?: string;
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-sky-400" aria-hidden>
      <path
        fillRule="evenodd"
        d="M2 5a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586L10.414 5H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function FolderPickerDialog({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target?: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fs' + (target ? `?path=${encodeURIComponent(target)}` : ''));
      const data = (await res.json()) as ListingResponse;
      if (!res.ok) throw new Error(data.error ?? 'Không đọc được thư mục');
      setCwd(data.path ?? null);
      setParent(data.parent ?? null);
      setEntries(data.entries ?? []);
      if (data.home) setHome(data.home);
      if (data.roots) setRoots(data.roots);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/fs');
      const data = (await res.json()) as ListingResponse;
      if (res.ok) {
        if (data.home) setHome(data.home);
        if (data.roots) setRoots(data.roots);
      }
    } catch {
      // Quick links chỉ là tiện ích — bỏ qua lỗi
    }
  }, []);

  useEffect(() => {
    void loadLinks();
    if (initialPath) void load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const quickLinks = [home, ...roots].filter((p): p is string => !!p);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Chọn thư mục project</h3>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => parent && load(parent)}
            disabled={!parent || loading}
            title="Lên một cấp"
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↑
          </button>
          <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-300">
            {cwd ?? 'Chọn ổ đĩa hoặc thư mục home'}
          </div>
        </div>

        {quickLinks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quickLinks.map((p) => (
              <button
                key={p}
                onClick={() => load(p)}
                disabled={loading}
                title={p}
                className={`max-w-[220px] truncate rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40 ${
                  p === cwd
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        <div className="mt-3 max-h-72 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Đang tải…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {cwd ? 'Không có thư mục con nào' : 'Chọn một ổ đĩa ở trên để bắt đầu'}
            </p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => load(entry.path)}
                title={entry.path}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/60"
              >
                <FolderIcon />
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Huỷ
          </button>
          <button
            onClick={() => cwd && onSelect(cwd)}
            disabled={!cwd || loading}
            className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Chọn thư mục này
          </button>
        </div>
      </div>
    </div>
  );
}
