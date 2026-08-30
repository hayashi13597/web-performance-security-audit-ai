'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FixPlan,
  FixSuggestion,
  PRResult,
  ScanReport,
  ScanStage,
  Severity,
  StageState,
} from '@wpsa/engine';
import { CWVCards, ScoreGauge } from '@/components/CWVCards';
import { DiffView } from '@/components/DiffView';
import { FindingCard } from '@/components/FindingCard';
import { PromptDialog } from '@/components/PromptDialog';
import { ScanProgress } from '@/components/ScanProgress';
import { TokenDialog } from '@/components/TokenDialog';

// Nhãn nhóm finding — khai báo local (không import từ engine để tránh bundle deps server vào client)
const CATEGORY_LABELS: Record<string, string> = {
  performance: 'Hiệu năng',
  bundle: 'Bundle size',
  rerender: 'Re-render lãng phí',
  memory: 'Rò rỉ bộ nhớ',
  security: 'Bảo mật',
  seo: 'SEO',
};

interface JobResponse {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  stages: Partial<Record<ScanStage, StageState>>;
  aiConfigured: boolean;
  error?: string;
  report?: ScanReport;
  mode: string;
  target: string;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<JobResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [category, setCategory] = useState<string>('all');

  // ===== Flow sinh fix + tạo PR =====
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [selectedFixes, setSelectedFixes] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<PRResult | null>(null);

  // ===== Flow sinh prompt copy sang AI của người dùng =====
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptData, setPromptData] = useState<{ prompt: string; includedFiles: string[] } | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptIncludeFiles, setPromptIncludeFiles] = useState(true);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/scans/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    const json = (await res.json()) as JobResponse;
    setData(json);
    return json;
  }, [id]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const job = await poll();
      if (!active) return;
      if (job && (job.status === 'done' || job.status === 'error')) return;
      timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [poll]);

  const report = data?.report;

  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());

  // Default chọn các finding nghiêm trọng (mọi loại scan đều tạo được prompt) khi có report
  const defaultSelection = useRef(false);
  useEffect(() => {
    if (!report || defaultSelection.current) return;
    defaultSelection.current = true;
    const ids = new Set(report.findings.filter((f) => f.severity !== 'info').map((f) => f.id));
    setSelectedFindingIds(ids);
  }, [report]);

  const categories = useMemo(() => {
    if (!report) return [];
    return [...new Set(report.findings.map((f) => f.category))];
  }, [report]);

  const visibleFindings = useMemo(() => {
    if (!report) return [];
    return [...report.findings]
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
      .filter((f) => category === 'all' || f.category === category);
  }, [report, category]);

  const counts = useMemo(() => {
    const by: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const f of report?.findings ?? []) by[f.severity] += 1;
    return by;
  }, [report]);

  async function generatePreview() {
    setGenerating(true);
    setFlowError(null);
    try {
      const res = await fetch(`/api/scans/${id}/fix-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingIds: [...selectedFindingIds] }),
      });
      const json = (await res.json()) as FixPlan & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Sinh fix thất bại');
      setPlan(json);
      setSelectedFixes(new Set(json.fixes.map((_, i) => i)));
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function generatePrompt(includeFiles: boolean) {
    setPromptIncludeFiles(includeFiles);
    setPromptBusy(true);
    setFlowError(null);
    try {
      const res = await fetch(`/api/scans/${id}/fix-prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingIds: [...selectedFindingIds], includeFiles }),
      });
      const json = (await res.json()) as { prompt: string; includedFiles: string[] } & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Sinh prompt thất bại');
      setPromptData({ prompt: json.prompt, includedFiles: json.includedFiles });
      setPromptOpen(true);
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromptBusy(false);
    }
  }

  async function createPR(repo: string, token: string, baseBranch: string) {
    setPrBusy(true);
    setFlowError(null);
    try {
      const fixes: FixSuggestion[] = plan
        ? plan.fixes.filter((_, i) => selectedFixes.has(i))
        : [];
      const res = await fetch(`/api/scans/${id}/pull-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo,
          token,
          baseBranch: baseBranch || undefined,
          fixes: fixes.length > 0 ? fixes : undefined,
          findingIds: fixes.length > 0 ? undefined : [...selectedFindingIds],
        }),
      });
      const json = (await res.json()) as PRResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Tạo PR thất bại');
      setPrResult(json);
      setDialogOpen(false);
      setPlan(null);
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-white">Không tìm thấy job scan</h1>
        <p className="mt-2 text-sm text-slate-400">Job có thể đã bị xoá hoặc server đã restart.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">
          ← Quét lại
        </Link>
      </main>
    );
  }

  if (!data) {
    return <main className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-slate-400">Đang tải…</main>;
  }

  // ===== Đang scan =====
  if (data.status === 'queued' || data.status === 'running') {
    return (
      <main className="mx-auto max-w-xl px-4 py-20">
        <h1 className="text-xl font-semibold text-white">Đang quét…</h1>
        <p className="mt-1 text-xs text-slate-500">Đối tượng: {data.target}</p>
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <ScanProgress stages={data.stages} />
        </div>
        <p className="mt-4 text-center text-xs text-slate-600">Trang tự cập nhật mỗi 1.5 giây — không cần refresh.</p>
      </main>
    );
  }

  // ===== Scan lỗi toàn phần =====
  if (data.status === 'error') {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-red-300">Scan thất bại</h1>
        <p className="mt-2 text-sm text-slate-400">{data.error}</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">
          ← Quét lại
        </Link>
      </main>
    );
  }

  const totalFindings = report?.findings.length ?? 0;
  const defaultRepo = report?.repo ? `${report.repo.owner}/${report.repo.name}` : '';

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-sky-400 hover:text-sky-300">
            ← Quét đối tượng khác
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">{data.target}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {report?.url && <>URL live: {report.url} · </>}
            {report?.repo && <>repo {report.repo.owner}/{report.repo.name} (branch {report.repo.branch}) · </>}
            Hoàn tất trong {(report!.durationMs / 1000).toFixed(0)}s · {report!.findings.length} findings
            {' '}(<span className="text-red-300">{counts.critical} nghiêm trọng</span>,{' '}
            <span className="text-amber-300">{counts.warning} cảnh báo</span>,{' '}
            <span className="text-sky-300">{counts.info} gợi ý</span>)
          </p>
        </div>
      </div>

      {prResult && (
        <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-300">✅ Đã tạo Pull Request thành công!</p>
          <a href={prResult.prUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-emerald-200 underline">
            {prResult.prUrl}
          </a>
          <p className="mt-1 text-xs text-emerald-400/70">
            Branch {prResult.branch} · {prResult.filesChanged} file thay đổi · review &amp; merge trên GitHub
          </p>
        </div>
      )}

      {!data.aiConfigured && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          ⚠️ Chưa cấu hình AI (AI_API_KEY) — không sinh được preview fix tự động và tạo PR. Với mọi loại scan, bạn vẫn có
          thể <span className="font-semibold">tạo prompt để copy sang AI của bạn</span> ở panel bên dưới. Đặt biến môi
          trường theo <code className="rounded bg-black/30 px-1">.env.example</code> rồi restart để bật đầy đủ tính năng.
        </div>
      )}

      {/* Scores + CWV */}
      {report?.cwv && (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <ScoreGauge label="Hiệu năng" score={report.cwv.performanceScore ?? 0} />
            <ScoreGauge label="SEO" score={report.cwv.seoScore ?? 0} />
            <ScoreGauge label="Best Practices" score={report.cwv.bestPracticesScore ?? 0} />
            <div className="flex-1 text-xs text-slate-500">
              <p className="mb-1 font-medium text-slate-300">Core Web Vitals (lab data)</p>
              <p>
                LCP/CLS/TBT đo trực tiếp trong phiên headless. TBT là proxy lab cho FID/INP — số liệu field (CrUX) sẽ khác nhẹ
                tuỳ người dùng thật.
              </p>
            </div>
          </div>
          <CWVCards cwv={report.cwv} />
        </>
      )}

      {/* Bảng re-render */}
      {report?.rerenderCommits && Object.keys(report.rerenderCommits).length > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Số lần render theo component (phiên tương tác giả lập)
          </h2>
          <div className="space-y-1.5">
            {Object.entries(report.rerenderCommits)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([name, count]) => {
                const max = Math.max(...Object.values(report.rerenderCommits!));
                return (
                  <div key={name} className="flex items-center gap-3 text-xs">
                    <span className="w-56 truncate font-mono text-slate-300">{name}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${count > 25 ? 'bg-red-400' : 'bg-sky-500'}`}
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className={`w-10 text-right font-semibold ${count > 25 ? 'text-red-300' : 'text-slate-400'}`}>{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Findings */}
      <div className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Findings</h2>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategory('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${category === 'all' ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Tất cả ({report!.findings.length})
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${category === c ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {CATEGORY_LABELS[c]} ({report!.findings.filter((f) => f.category === c).length})
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {visibleFindings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              selected={selectedFindingIds.has(f.id)}
              onToggle={(fid) =>
                setSelectedFindingIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(fid)) next.delete(fid);
                  else next.add(fid);
                  return next;
                })
              }
            />
          ))}
          {visibleFindings.length === 0 && (
            <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
              Không có finding nào trong nhóm này 🎉
            </p>
          )}
        </div>
      </div>

      {/* Flow sinh fix + PR + prompt copy — prompt tạo được cho mọi loại scan */}
      {totalFindings > 0 && (
        <div className="sticky bottom-4 mt-10 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/50 backdrop-blur">
          {flowError && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{flowError}</div>
          )}
          {plan ? (
            <div>
              {plan.summary && <p className="mb-3 text-sm text-slate-300">{plan.summary}</p>}
              <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                {plan.fixes.map((fix, i) => (
                  <div key={i} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedFixes.has(i)}
                        onChange={() =>
                          setSelectedFixes((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-sky-500"
                      />
                      <span className="font-mono text-xs text-white">{fix.file}</span>
                      <span className="text-[10px] uppercase text-slate-500">{fix.action}</span>
                    </label>
                    {fix.rationale && <p className="mt-1 pl-6 text-xs text-slate-400">{fix.rationale}</p>}
                    <details className="mt-2 pl-6">
                      <summary className="cursor-pointer text-xs text-sky-400">Xem diff</summary>
                      <div className="mt-2">
                        <DiffView diff={fix.diff ?? ''} />
                      </div>
                    </details>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setPlan(null)} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800">
                  ← Quay lại
                </button>
                <button
                  onClick={() => setDialogOpen(true)}
                  disabled={selectedFixes.size === 0}
                  className="flex-1 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-40"
                >
                  Tạo Pull Request với {selectedFixes.size} file đã chọn →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-300">
                Đã chọn <span className="font-bold text-white">{selectedFindingIds.size}</span>/{totalFindings} finding để
                đưa vào prompt / PR.
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSelectedFindingIds(new Set(report!.findings.map((f) => f.id)))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
                  Chọn tất cả
                </button>
                <button
                  onClick={() => generatePrompt(promptIncludeFiles)}
                  disabled={promptBusy || selectedFindingIds.size === 0}
                  className="rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-40"
                >
                  {promptBusy ? 'Đang sinh prompt…' : '📋 Tạo prompt để copy'}
                </button>
                <button
                  onClick={generatePreview}
                  disabled={generating || !data.aiConfigured || !report?.sourceDir || selectedFindingIds.size === 0}
                  title={
                    !data.aiConfigured
                      ? 'Cần cấu hình AI_BASE_URL, AI_API_KEY, AI_MODEL trong .env'
                      : !report?.sourceDir
                        ? 'Sinh preview fix cần source code (scan repo/thư mục). Với scan URL, dùng "Tạo prompt để copy".'
                        : undefined
                  }
                  className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
                >
                  {generating ? 'AI đang phân tích… (có thể mất ~1 phút)' : '🤖 Sinh preview fix bằng AI'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {dialogOpen && (
        <TokenDialog
          defaultRepo={defaultRepo}
          busy={prBusy}
          error={flowError}
          onSubmit={createPR}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {promptOpen && promptData && (
        <PromptDialog
          prompt={promptData.prompt}
          fileCount={promptData.includedFiles.length}
          includeFiles={promptIncludeFiles}
          canIncludeFiles={!!report?.sourceDir}
          busy={promptBusy}
          error={flowError}
          onToggleFiles={generatePrompt}
          onClose={() => setPromptOpen(false)}
        />
      )}
    </main>
  );
}
