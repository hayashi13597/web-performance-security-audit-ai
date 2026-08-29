import { randomUUID } from 'node:crypto';
import type {
  FixPlan,
  ScanRequest,
  ScanReport,
  ScanStage,
  StageState,
} from '@wpsa/engine';
import { loadEngine } from '@/lib/engine';

export interface ScanJob {
  id: string;
  request: ScanRequest;
  status: 'queued' | 'running' | 'done' | 'error';
  stages: Partial<Record<ScanStage, StageState>>;
  report?: ScanReport;
  error?: string;
  /** Báo lỗi AI chưa cấu hình ngay từ đầu (vẫn cho scan). */
  aiConfigured: boolean;
  /** Plan fix gần nhất (từ /fix-preview) — dùng khi tạo PR mà client không gửi lại fixes. */
  lastFixPlan?: FixPlan;
  createdAt: number;
}

// Map gắn trên globalThis để sống sót qua Next.js hot-reload ở môi trường dev
const globalStore = globalThis as unknown as { __wpsaJobs?: Map<string, ScanJob> };
const jobs: Map<string, ScanJob> = globalStore.__wpsaJobs ?? new Map();
globalStore.__wpsaJobs = jobs;

export function createScanJob(request: ScanRequest): ScanJob {
  const id = randomUUID().slice(0, 8);
  const { aiConfigFromEnv, runScan } = loadEngine();
  const job: ScanJob = {
    id,
    request,
    status: 'queued',
    stages: {},
    aiConfigured: aiConfigFromEnv() !== null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  const progress = (stage: ScanStage, status: StageState['status'], message?: string) => {
    job.stages[stage] = { status, message };
    job.status = 'running';
  };

  void runScan(request, id, progress)
    .then((report) => {
      job.report = report;
      job.status = 'done';
    })
    .catch((err: unknown) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    });

  return job;
}

export function getScanJob(id: string): ScanJob | undefined {
  return jobs.get(id);
}

/** Dọn job cũ hơn 6 tiếng (job chứa report + sourceDir tạm, không để phình vô hạn). */
export function pruneOldJobs(): void {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}
