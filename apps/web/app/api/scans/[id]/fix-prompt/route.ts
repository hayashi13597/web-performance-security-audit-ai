import { NextResponse } from 'next/server';
import { loadEngine } from '@/lib/engine';
import { getScanJob } from '@/lib/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      { error: 'Scan này không có source code (chỉ quét URL) nên không sinh được prompt fix. Hãy scan theo repo/thư mục.' },
      { status: 422 },
    );
  }

  let findingIds: string[] | undefined;
  let includeFiles = true;
  try {
    const body = (await req.json()) as { findingIds?: string[]; includeFiles?: boolean };
    findingIds = body.findingIds;
    if (typeof body.includeFiles === 'boolean') includeFiles = body.includeFiles;
  } catch {
    // body rỗng — dùng tất cả finding aiFixable, kèm file nguồn
  }

  const findings = job.report.findings.filter(
    (f) => f.aiFixable && (!findingIds || findingIds.includes(f.id)),
  );
  if (findings.length === 0) {
    return NextResponse.json({ error: 'Không có finding nào đủ điều kiện sinh prompt' }, { status: 422 });
  }

  try {
    const { buildFixPrompt } = loadEngine();
    const result = await buildFixPrompt(findings, job.report.sourceDir, {
      includeFiles,
      repo: job.report.repo,
      liveUrl: job.report.url,
    });
    return NextResponse.json({ ...result, includeFiles });
  } catch (err) {
    return NextResponse.json(
      { error: `Sinh prompt thất bại: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
