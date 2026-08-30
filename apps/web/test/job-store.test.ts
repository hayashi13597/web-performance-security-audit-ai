import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanReport, ScanRequest } from '@wpsa/engine';
import { closeJobDb, getJobDb } from '@/lib/job-db';
import { createScanJob, getScanJob, listRecentScans, pruneOldJobs, updateScanJob } from '@/lib/job-store';

const mocks = vi.hoisted(() => ({
  aiConfigFromEnv: vi.fn(() => null),
  runScan: vi.fn(),
}));

vi.mock('@/lib/engine', () => ({
  loadEngine: () => mocks,
}));

// Mỗi test dùng file DB riêng để không ảnh hưởng nhau
const tmpRoot = mkdtempSync(join(tmpdir(), 'wpsa-job-store-'));

beforeEach(() => {
  closeJobDb();
  process.env.WPSA_DB_PATH = join(tmpRoot, `${randomUUID()}.db`);
});

afterAll(() => {
  closeJobDb();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const urlRequest: ScanRequest = {
  mode: 'url',
  url: 'https://example.com',
  formFactor: 'mobile',
  memoryRounds: 3,
};

const repoRequest: ScanRequest = {
  mode: 'repo',
  source: { kind: 'github', repoUrl: 'https://github.com/owner/repo', token: 'ghp_secret_token' },
  formFactor: 'mobile',
  memoryRounds: 3,
};

const report: ScanReport = {
  id: 'report-1',
  scannedAt: new Date().toISOString(),
  durationMs: 1234,
  findings: [],
};

describe('job-store (SQLite)', () => {
  it('tạo job và đọc lại được từ DB', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const job = createScanJob(urlRequest);

    expect(getScanJob(job.id)).toMatchObject({
      id: job.id,
      status: 'queued',
      aiConfigured: false,
      request: { mode: 'url', url: 'https://example.com' },
      stages: {},
    });
  });

  it('redact GitHub token trước khi lưu DB nhưng vẫn chạy scan với request gốc', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const job = createScanJob(repoRequest);

    expect(getScanJob(job.id)?.request).toEqual({
      mode: 'repo',
      source: { kind: 'github', repoUrl: 'https://github.com/owner/repo' },
      formFactor: 'mobile',
      memoryRounds: 3,
    });
    expect(mocks.runScan).toHaveBeenCalledWith(repoRequest, job.id, expect.any(Function));
  });

  it('progress từng stage và report cuối cùng được ghi xuống DB', async () => {
    mocks.runScan.mockImplementation(async (_request, _id, onProgress) => {
      onProgress('lighthouse', 'running');
      onProgress('lighthouse', 'done', 'score 90');
      onProgress('security', 'done');
      return report;
    });
    const job = createScanJob(urlRequest);

    await vi.waitFor(() => expect(getScanJob(job.id)?.status).toBe('done'));
    const stored = getScanJob(job.id)!;
    expect(stored.report).toEqual(report);
    expect(stored.stages.lighthouse).toEqual({ status: 'done', message: 'score 90' });
    expect(stored.stages.security).toEqual({ status: 'done' });
  });

  it('scan lỗi → status error kèm message', async () => {
    mocks.runScan.mockImplementation(async () => {
      throw new Error('boom');
    });
    const job = createScanJob(urlRequest);

    await vi.waitFor(() => expect(getScanJob(job.id)?.status).toBe('error'));
    expect(getScanJob(job.id)?.error).toBe('boom');
  });

  it('updateScanJob lưu lastFixPlan (dùng bởi /fix-preview)', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const job = createScanJob(urlRequest);

    updateScanJob(job.id, { lastFixPlan: { fixes: [], summary: 'plan-1' } });
    expect(getScanJob(job.id)?.lastFixPlan?.summary).toBe('plan-1');
  });

  it('pruneOldJobs chỉ xóa job hết hạn', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const oldJob = createScanJob(urlRequest);
    const freshJob = createScanJob(urlRequest);
    getJobDb()
      .prepare('UPDATE jobs SET created_at = ? WHERE id = ?')
      .run(Date.now() - 7 * 60 * 60 * 1000, oldJob.id);

    pruneOldJobs();

    expect(getScanJob(oldJob.id)).toBeUndefined();
    expect(getScanJob(freshJob.id)).toBeDefined();
  });

  it('job sống qua restart; job của process đã chết bị đánh dấu lỗi khi mở lại', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const doneJob = createScanJob(urlRequest);
    updateScanJob(doneJob.id, { status: 'done' });
    const runningJob = createScanJob(urlRequest);
    updateScanJob(runningJob.id, { status: 'running' });
    // Giả lập chủ job là process đã tắt (pid của child đã exit ngay khi spawnSync trả về)
    const { pid: deadPid } = spawnSync(process.execPath, ['-e', '']);
    getJobDb().prepare('UPDATE jobs SET owner_pid = ? WHERE id = ?').run(deadPid, runningJob.id);

    closeJobDb(); // mô phỏng restart — lần get tiếp theo mở lại cùng file DB

    expect(getScanJob(doneJob.id)?.status).toBe('done');
    const reopened = getScanJob(runningJob.id);
    expect(reopened?.status).toBe('error');
    expect(reopened?.error).toContain('restart');
  });

  it('job của process hiện tại không bị đánh dấu lỗi khi mở lại DB', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const runningJob = createScanJob(urlRequest);
    updateScanJob(runningJob.id, { status: 'running' }); // owner_pid = process đang chạy test

    closeJobDb();

    expect(getScanJob(runningJob.id)?.status).toBe('running');
  });

  it('job của process khác đang sống giữ nguyên khi mở lại DB', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const runningJob = createScanJob(urlRequest);
    updateScanJob(runningJob.id, { status: 'running' });
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)']);
    if (owner.pid === undefined) throw new Error('Không spawn được process giả lập');
    getJobDb().prepare('UPDATE jobs SET owner_pid = ? WHERE id = ?').run(owner.pid, runningJob.id);

    try {
      closeJobDb();
      expect(getScanJob(runningJob.id)?.status).toBe('running');
    } finally {
      owner.kill();
    }
  });

  it('job cũ không có owner_pid (DB trước khi có cột) vẫn bị đánh dấu lỗi', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const runningJob = createScanJob(urlRequest);
    updateScanJob(runningJob.id, { status: 'running' });
    getJobDb().prepare('UPDATE jobs SET owner_pid = NULL WHERE id = ?').run(runningJob.id);

    closeJobDb();

    const reopened = getScanJob(runningJob.id);
    expect(reopened?.status).toBe('error');
    expect(reopened?.error).toContain('restart');
  });

  it('listRecentScans trả job mới nhất trước và không nạp report', () => {
    mocks.runScan.mockImplementation(() => new Promise(() => {}));
    const first = createScanJob(urlRequest);
    const second = createScanJob(repoRequest);
    // Đảm bảo thứ tự thời gian khác nhau dù Date.now() cùng ms
    getJobDb()
      .prepare('UPDATE jobs SET created_at = ? WHERE id = ?')
      .run(first.createdAt + 1000, second.id);

    const list = listRecentScans(10);

    expect(list.map((j) => j.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ status: 'queued', createdAt: first.createdAt + 1000 });
    expect(list[0].request).toEqual({
      mode: 'repo',
      source: { kind: 'github', repoUrl: 'https://github.com/owner/repo' },
      formFactor: 'mobile',
      memoryRounds: 3,
    });
  });

  it('getScanJob với id lạ trả undefined', () => {
    expect(getScanJob('khong-ton-tai')).toBeUndefined();
  });
});
