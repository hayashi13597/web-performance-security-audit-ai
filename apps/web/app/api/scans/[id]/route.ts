import { NextResponse } from 'next/server';
import { getScanJob } from '@/lib/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const job = getScanJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job scan (có thể server đã restart)' }, { status: 404 });
  }

  const target =
    job.request.mode === 'url'
      ? job.request.url
      : job.request.source.kind === 'github'
        ? job.request.source.repoUrl
        : job.request.source.path;

  return NextResponse.json({
    id: job.id,
    status: job.status,
    stages: job.stages,
    aiConfigured: job.aiConfigured,
    error: job.error,
    report: job.report,
    mode: job.request.mode,
    target,
  });
}
