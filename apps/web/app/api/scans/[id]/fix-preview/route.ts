import { NextResponse } from 'next/server';
import type { FixPlan } from '@wpsa/engine';
import { loadEngine } from '@/lib/engine';
import { getScanJob, updateScanJob } from '@/lib/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const job = getScanJob(id);
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job scan' }, { status: 404 });
  if (job.status !== 'done' || !job.report) {
    return NextResponse.json({ error: 'Scan chưa hoàn tất' }, { status: 409 });
  }
  if (!job.report.sourceDir) {
    return NextResponse.json(
      { error: 'Scan này không có source code (chỉ quét URL) nên không sinh được code fix. Hãy scan theo repo/thư mục.' },
      { status: 422 },
    );
  }
  const { aiConfigFromEnv, generateFixPlan } = loadEngine();
  const config = aiConfigFromEnv();
  if (!config) {
    return NextResponse.json(
      { error: 'Chưa cấu hình AI. Đặt AI_BASE_URL, AI_API_KEY, AI_MODEL trong file .env rồi restart app.' },
      { status: 503 },
    );
  }

  let findingIds: string[] | undefined;
  try {
    const body = (await req.json()) as { findingIds?: string[] };
    findingIds = body.findingIds;
  } catch {
    // body rỗng — dùng tất cả finding aiFixable
  }

  const findings = job.report.findings.filter(
    (f) => f.aiFixable && (!findingIds || findingIds.includes(f.id)),
  );
  if (findings.length === 0) {
    return NextResponse.json({ error: 'Không có finding nào đủ điều kiện sinh fix' }, { status: 422 });
  }

  try {
    const plan: FixPlan = await generateFixPlan(findings, job.report.sourceDir, config);
    updateScanJob(id, { lastFixPlan: plan });
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json(
      { error: `Sinh fix thất bại: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
