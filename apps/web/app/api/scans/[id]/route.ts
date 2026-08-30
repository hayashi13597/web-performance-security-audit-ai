import { NextResponse } from 'next/server';
import { getScanJob, jobTarget } from '@/lib/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const job = getScanJob(id);
  if (!job) {
    return NextResponse.json(
      { error: 'Không tìm thấy job scan (đã quá thời gian lưu trữ hoặc không tồn tại)' },
      { status: 404 },
    );
  }

  const target = jobTarget(job.request);

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
