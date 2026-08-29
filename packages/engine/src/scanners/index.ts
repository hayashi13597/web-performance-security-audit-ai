import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBundleScan } from '../detectors/bundle-detector.js';
import { runLighthouseScan } from '../detectors/lighthouse-detector.js';
import { runMemoryScan } from '../detectors/memory-detector.js';
import { runRerenderScan } from '../detectors/rerender-detector.js';
import { runSecuritySeoScan } from '../detectors/security-detector.js';
import { resolveSourceDir } from './repo-scanner.js';
import type { CWVMetrics, Finding, RepoInfo, ScanReport, ScanRequest, ScanStage, StageState } from '../types.js';

export type ProgressFn = (stage: ScanStage, status: StageState['status'], message?: string) => void;

const AI_FIXABLE_CATEGORIES = new Set(['bundle', 'rerender', 'memory', 'seo', 'security']);

function workRoot(): string {
  return path.join(tmpdir(), 'wpsa-work');
}

async function guard(stage: ScanStage, onProgress: ProgressFn, job: () => Promise<void>): Promise<void> {
  onProgress(stage, 'running');
  try {
    await job();
    onProgress(stage, 'done');
  } catch (err) {
    onProgress(stage, 'error', err instanceof Error ? err.message : String(err));
  }
}

/** Chạy toàn bộ pipeline scan theo request. Không stage nào làm hỏng toàn bộ report — lỗi stage chỉ được ghi chú. */
export async function runScan(request: ScanRequest, id: string, onProgress: ProgressFn): Promise<ScanReport> {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  let cwv: CWVMetrics | undefined;
  let rerenderCommits: Record<string, number> | undefined;
  let url: string | undefined;
  let repo: RepoInfo | undefined;
  let sourceDir: string | undefined;

  const formFactor = request.formFactor;
  const memoryRounds = Math.min(Math.max(request.memoryRounds || 3, 1), 6);

  if (request.mode === 'url') {
    url = request.url;
  } else {
    await guard('fetch-source', onProgress, async () => {
      const resolved = await resolveSourceDir(request.source, workRoot());
      sourceDir = resolved.dir;
      repo = resolved.repo;
    });
    url = request.liveUrl;
  }

  // ===== Scan tĩnh từ source (bundle) =====
  if (sourceDir) {
    await guard('bundle', onProgress, async () => {
      const result = await runBundleScan(sourceDir!);
      findings.push(...result.findings);
    });
  }

  // ===== Scan runtime (cần URL live) =====
  if (url) {
    await guard('security', onProgress, async () => {
      findings.push(...(await runSecuritySeoScan(url!)));
    });

    await guard('lighthouse', onProgress, async () => {
      const result = await runLighthouseScan(url!, { formFactor });
      findings.push(...result.findings);
      cwv = result.cwv;
    });

    await guard('rerender', onProgress, async () => {
      const result = await runRerenderScan(url!, { formFactor });
      findings.push(...result.findings);
      rerenderCommits = result.commitCounts;
    });

    await guard('memory', onProgress, async () => {
      const result = await runMemoryScan(url!, { formFactor, rounds: memoryRounds });
      findings.push(...result.findings);
    });
  }

  // Có source → cho phép AI sinh fix cho các finding thuộc nhóm fix được
  if (sourceDir) {
    for (const f of findings) {
      if (AI_FIXABLE_CATEGORIES.has(f.category)) f.aiFixable = true;
    }
  }

  return {
    id,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    url,
    repo,
    sourceDir,
    cwv,
    findings,
    rerenderCommits,
  };
}
