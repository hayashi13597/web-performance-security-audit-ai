// Lớp SQLite cho job store — dùng node:sqlite built-in (cần Node >= 22.13).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ScanJob } from './job-store';

// Gắn kết nối trên globalThis để sống sót qua Next.js hot-reload ở môi trường dev
const globalStore = globalThis as unknown as { __wpsaJobDb?: DatabaseSync };

export function getJobDb(): DatabaseSync {
  if (globalStore.__wpsaJobDb) return globalStore.__wpsaJobDb;

  const dbPath = process.env.WPSA_DB_PATH || resolve(process.cwd(), '.data', 'wpsa-jobs.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      request       TEXT NOT NULL,
      status        TEXT NOT NULL,
      stages        TEXT NOT NULL,
      report        TEXT,
      error         TEXT,
      ai_configured INTEGER NOT NULL,
      last_fix_plan TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_created_at ON jobs (created_at);
  `);

  // Job đang chạy khi process tắt lần trước không thể chạy tiếp — đánh dấu lỗi rõ ràng.
  db.exec(
    "UPDATE jobs SET status = 'error', error = 'Server đã restart giữa chừng scan' WHERE status IN ('queued', 'running')",
  );

  globalStore.__wpsaJobDb = db;
  return db;
}

/** Đóng kết nối (test dùng để mô phỏng restart; chưa mở thì no-op). */
export function closeJobDb(): void {
  const db = globalStore.__wpsaJobDb;
  globalStore.__wpsaJobDb = undefined;
  if (db) {
    try {
      db.close();
    } catch {
      // đã đóng rồi — bỏ qua
    }
  }
}

export interface JobPatch {
  status?: ScanJob['status'];
  stages?: ScanJob['stages'];
  report?: ScanJob['report'];
  error?: ScanJob['error'];
  lastFixPlan?: ScanJob['lastFixPlan'];
}

export function saveJob(job: ScanJob): void {
  getJobDb()
    .prepare(
      `INSERT INTO jobs (id, request, status, stages, report, error, ai_configured, last_fix_plan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      JSON.stringify(job.request),
      job.status,
      JSON.stringify(job.stages),
      job.report ? JSON.stringify(job.report) : null,
      job.error ?? null,
      job.aiConfigured ? 1 : 0,
      job.lastFixPlan ? JSON.stringify(job.lastFixPlan) : null,
      job.createdAt,
    );
}

export function readJob(id: string): ScanJob | undefined {
  const row = getJobDb()
    .prepare('SELECT * FROM jobs WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: row.id as string,
    request: JSON.parse(row.request as string) as ScanJob['request'],
    status: row.status as ScanJob['status'],
    stages: JSON.parse(row.stages as string) as ScanJob['stages'],
    report: row.report ? (JSON.parse(row.report as string) as ScanJob['report']) : undefined,
    error: (row.error as string | null) ?? undefined,
    aiConfigured: Number(row.ai_configured) === 1,
    lastFixPlan: row.last_fix_plan
      ? (JSON.parse(row.last_fix_plan as string) as ScanJob['lastFixPlan'])
      : undefined,
    createdAt: Number(row.created_at),
  };
}

export function updateJobFields(id: string, patch: JobPatch): void {
  const cols: Array<[string, string | number | null]> = [];
  if (patch.status !== undefined) cols.push(['status', patch.status]);
  if (patch.stages !== undefined) cols.push(['stages', JSON.stringify(patch.stages)]);
  if (patch.report !== undefined) cols.push(['report', JSON.stringify(patch.report)]);
  if (patch.error !== undefined) cols.push(['error', patch.error]);
  if (patch.lastFixPlan !== undefined) cols.push(['last_fix_plan', JSON.stringify(patch.lastFixPlan)]);
  if (cols.length === 0) return;

  const sql = `UPDATE jobs SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`;
  getJobDb()
    .prepare(sql)
    .run(...cols.map(([, v]) => v), id);
}

export function deleteJobsOlderThan(cutoffMs: number): void {
  getJobDb()
    .prepare('DELETE FROM jobs WHERE created_at < ?')
    .run(cutoffMs);
}

/** Job rút gọn cho trang lịch sử — không nạp report/stages (nặng). */
export interface JobSummary {
  id: string;
  status: ScanJob['status'];
  request: ScanJob['request'];
  aiConfigured: boolean;
  createdAt: number;
}

export function listRecentJobs(limit: number): JobSummary[] {
  const rows = getJobDb()
    .prepare('SELECT id, request, status, ai_configured, created_at FROM jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id as string,
    status: row.status as ScanJob['status'],
    request: JSON.parse(row.request as string) as ScanJob['request'],
    aiConfigured: Number(row.ai_configured) === 1,
    createdAt: Number(row.created_at),
  }));
}
