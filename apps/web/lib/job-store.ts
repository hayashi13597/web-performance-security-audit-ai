import { randomUUID } from 'node:crypto';
import type {
  FixPlan,
  ScanRequest,
  ScanReport,
  ScanStage,
  StageState,
} from '@wpsa/engine';
import { loadEngine } from '@/lib/engine';
import {
  deleteJobsOlderThan,
  listRecentJobs,
  readJob,
  saveJob,
  updateJobFields,
  type JobPatch,
  type JobSummary,
} from './job-db';

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

const configuredTtlHours = Number(process.env.WPSA_JOB_TTL_HOURS);

/** Bản request an toàn để lưu DB: bỏ GitHub token (secret không xuống đĩa). */
function redactRequest(request: ScanRequest): ScanRequest {
  if (request.mode !== 'repo' || request.source.kind !== 'github' || !request.source.token) {
    return request;
  }
  return { ...request, source: { kind: 'github', repoUrl: request.source.repoUrl } };
}

export function createScanJob(request: ScanRequest): ScanJob {
  const id = randomUUID().slice(0, 8);
  const { aiConfigFromEnv, runScan } = loadEngine();
  const job: ScanJob = {
    id,
    request: redactRequest(request),
    status: 'queued',
    stages: {},
    aiConfigured: aiConfigFromEnv() !== null,
    createdAt: Date.now(),
  };
  saveJob(job);

  // Tiến độ từng stage giữ trong closure rồi ghi xuống DB (progress chỉ bắn khi đổi stage).
  const stages: Partial<Record<ScanStage, StageState>> = {};
  const progress = (stage: ScanStage, status: StageState['status'], message?: string) => {
    stages[stage] = { status, message };
    updateJobFields(id, { stages: { ...stages }, status: 'running' });
  };

  // request gốc (có token) chỉ tồn tại trong RAM của process này, không được persist.
  void runScan(request, id, progress)
    .then((report) => {
      updateJobFields(id, { report, status: 'done' });
    })
    .catch((err: unknown) => {
      updateJobFields(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return job;
}

export function getScanJob(id: string): ScanJob | undefined {
  return readJob(id);
}

/** Ghi một phần trạng thái job xuống DB (dùng bởi progress callback và route /fix-preview). */
export function updateScanJob(id: string, patch: JobPatch): void {
  updateJobFields(id, patch);
}

/** Danh sách job gần nhất cho trang lịch sử (đã sắp mới nhất trước). */
export function listRecentScans(limit: number): JobSummary[] {
  return listRecentJobs(limit);
}

/** Nhãn đích scan để hiển thị (URL / repo / đường dẫn local). */
export function jobTarget(request: ScanRequest): string {
  if (request.mode === 'url') return request.url;
  return request.source.kind === 'github' ? request.source.repoUrl : request.source.path;
}

/** Dọn job cũ hơn TTL (mặc định 6 tiếng — job chứa report + sourceDir tạm, không để phình vô hạn). */
export function pruneOldJobs(): void {
  const hours = Number.isFinite(configuredTtlHours) && configuredTtlHours > 0 ? configuredTtlHours : 6;
  deleteJobsOlderThan(Date.now() - hours * 60 * 60 * 1000);
}
