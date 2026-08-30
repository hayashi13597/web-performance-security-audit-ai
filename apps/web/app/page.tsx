'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderPickerDialog } from '@/components/FolderPickerDialog';
import { GithubAuth, useGithubSession } from '@/components/GithubAuth';
import { RecentScans } from '@/components/RecentScans';

type Tab = 'url' | 'repo' | 'local';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'url', label: 'URL', hint: 'Quét runtime metrics (Lighthouse + Playwright) của một URL đã deploy' },
  { key: 'repo', label: 'GitHub repo', hint: 'Phân tích tĩnh source + (tuỳ chọn) quét runtime qua URL live' },
  { key: 'local', label: 'Thư mục local', hint: 'Phân tích tĩnh một thư mục trên máy này' },
];

const AUTH_ERROR_LABELS: Record<string, string> = {
  not_configured: 'OAuth chưa cấu hình — thêm GITHUB_CLIENT_ID và GITHUB_CLIENT_SECRET vào .env rồi restart app.',
  denied: 'Bạn đã từ chối uỷ quyền trên GitHub.',
  state_expired: 'Phiên đăng nhập đã hết hạn — bấm "Đăng nhập với GitHub" để thử lại.',
  invalid_callback: 'Callback từ GitHub thiếu code/state — thử đăng nhập lại.',
  exchange_failed: 'Đổi authorization code thất bại — kiểm tra GITHUB_CLIENT_SECRET và callback URL đã đăng ký trên GitHub OAuth App.',
};

export default function HomePage() {
  const router = useRouter();
  const { session, logout } = useGithubSession();
  const [tab, setTab] = useState<Tab>('url');
  const [url, setUrl] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveUrl, setLiveUrl] = useState('');
  const [formFactor, setFormFactor] = useState<'mobile' | 'desktop'>('mobile');
  const [memoryRounds, setMemoryRounds] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('auth_error');
    if (err) {
      setAuthError(AUTH_ERROR_LABELS[err] ?? 'Đăng nhập GitHub thất bại — thử lại nhé.');
      // Dọn query string để refresh/F5 không hiện lại banner
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        tab === 'url'
          ? { mode: 'url', url, formFactor, memoryRounds }
          : tab === 'repo'
            ? { mode: 'repo', repoUrl, token: token || undefined, liveUrl: liveUrl || undefined, formFactor, memoryRounds }
            : { mode: 'local', localPath, liveUrl: liveUrl || undefined, formFactor, memoryRounds };

      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? 'Không tạo được job scan');
      router.push(`/scan/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-12">
      <GithubAuth session={session} onLogout={logout} />

      {authError && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {authError}
        </div>
      )}

      <div className="mb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 text-xs font-medium text-sky-300">
          Frontend Optimization Toolkit
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Web Performance &amp; Security <span className="text-sky-400">Audit AI</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
          Phát hiện lãng phí re-render, bundle quá lớn, rò rỉ bộ nhớ, vi phạm chuẩn bảo mật/SEO —
          kèm code fix sẵn để tạo Pull Request chỉ với 1 click.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/30 backdrop-blur">
        <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-slate-800/70 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                tab === t.key ? 'bg-sky-500 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs text-slate-500">{TABS.find((t) => t.key === tab)?.hint}</p>

        <div className="space-y-4">
          {tab === 'url' && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">URL cần quét</span>
              <input
                className={inputClass}
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !submitting && submit()}
              />
            </label>
          )}

          {tab === 'repo' && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">GitHub repo URL</span>
                <input
                  className={inputClass}
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </label>
              {session.configured ? (
                <p className="text-xs text-slate-500">
                  {session.authenticated ? (
                    <>
                      Đang dùng phiên GitHub của{' '}
                      <span className="font-medium text-sky-300">{session.login}</span> — ô PAT bên dưới chỉ
                      để override nếu muốn dùng token khác.
                    </>
                  ) : (
                    <>Mẹo: bấm “Đăng nhập với GitHub” phía trên thay vì dán PAT tay.</>
                  )}
                </p>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">
                  GitHub token <span className="text-slate-500">(tuỳ chọn — cho repo private)</span>
                </span>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="ghp_… / github_pat_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            </>
          )}

          {tab === 'local' && (
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Đường dẫn thư mục project</span>
              <div className="flex gap-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  placeholder="D:\duong\dan\project"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="whitespace-nowrap rounded-lg border border-sky-500/40 bg-sky-500/10 px-3.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
                >
                  Chọn thư mục…
                </button>
              </div>
            </div>
          )}

          {tab !== 'url' && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">
                URL live <span className="text-slate-500">(tuỳ chọn — bật quét runtime: Lighthouse, re-render, memory)</span>
              </span>
              <input
                className={inputClass}
                placeholder="https://your-app.vercel.app"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Thiết bị mô phỏng</span>
              <select
                className={inputClass}
                value={formFactor}
                onChange={(e) => setFormFactor(e.target.value as 'mobile' | 'desktop')}
              >
                <option value="mobile">Mobile (throttling 4G)</option>
                <option value="desktop">Desktop</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Số vòng test memory</span>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={6}
                value={memoryRounds}
                onChange={(e) => setMemoryRounds(Math.min(6, Math.max(1, Number(e.target.value) || 3)))}
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting || (tab === 'url' ? !url : tab === 'repo' ? !repoUrl : !localPath)}
            className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Đang khởi tạo scan…' : 'Bắt đầu quét →'}
          </button>
        </div>
      </div>

      <RecentScans />

      <p className="mt-6 text-center text-xs text-slate-600">
        Scan mất ~1-3 phút (Lighthouse + phiên tương tác Playwright + đo memory nhiều vòng).
      </p>

      {pickerOpen && (
        <FolderPickerDialog
          initialPath={localPath}
          onSelect={(p) => {
            setLocalPath(p);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </main>
  );
}
