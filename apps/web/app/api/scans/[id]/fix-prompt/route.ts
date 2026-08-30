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
  if (job.report.findings.length === 0) {
    return NextResponse.json({ error: 'Scan không có finding nào để đưa vào prompt' }, { status: 422 });
  }

  let findingIds: string[] | undefined;
  let includeFiles = true;
  try {
    const body = (await req.json()) as { findingIds?: string[]; includeFiles?: boolean };
    findingIds = body.findingIds;
    if (typeof body.includeFiles === 'boolean') includeFiles = body.includeFiles;
  } catch {
    // body rỗng — dùng tất cả finding, kèm file nguồn nếu scan có source
  }

  const findings = findingIds
    ? job.report.findings.filter((f) => findingIds!.includes(f.id))
    : job.report.findings;
  if (findings.length === 0) {
    return NextResponse.json({ error: 'Không có finding nào khớp danh sách đã chọn' }, { status: 422 });
  }

  const hasSource = !!job.report.sourceDir;
  try {
    const { buildFixPrompt } = loadEngine();
    const result = await buildFixPrompt(findings, {
      projectDir: job.report.sourceDir,
      includeFiles,
      repo: job.report.repo,
      liveUrl: job.report.url,
      cwv: job.report.cwv,
    });
    return NextResponse.json({ ...result, includeFiles: hasSource && includeFiles });
  } catch (err) {
    return NextResponse.json(
      { error: `Sinh prompt thất bại: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
