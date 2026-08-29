import { NextResponse } from 'next/server';
import type { FixSuggestion } from '@wpsa/engine';
import { loadEngine } from '@/lib/engine';
import { getScanJob } from '@/lib/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  /** "owner/name" — bắt buộc nếu scan nguồn local (hoặc muốn PR sang repo khác). */
  repo?: string;
  token: string;
  baseBranch?: string;
  /** Fix đã xem preview từ /fix-preview. Nếu có, dùng trực tiếp. */
  fixes?: FixSuggestion[];
  /** Nếu không có fixes: sinh lại plan từ các finding này (mặc định: tất cả aiFixable). */
  findingIds?: string[];
}

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  if (!body.token?.trim()) {
    return NextResponse.json({ error: 'Thiếu GitHub token (PAT)' }, { status: 400 });
  }

  const targetRepo =
    body.repo?.trim() ||
    (job.report.repo ? `${job.report.repo.owner}/${job.report.repo.name}` : '');
  if (!targetRepo || !/^[\w.-]+\/[\w.-]+$/.test(targetRepo)) {
    return NextResponse.json(
      { error: 'Repo đích phải dạng "owner/name" (scan nguồn local cần khai báo repo GitHub)' },
      { status: 400 },
    );
  }

  let fixes: FixSuggestion[];
  const { aiConfigFromEnv, buildPrBody, createFixPR, generateFixPlan } = loadEngine();
  if (body.fixes && body.fixes.length > 0) {
    fixes = body.fixes;
  } else {
    if (!job.report.sourceDir) {
      return NextResponse.json(
        { error: 'Scan này không có source code nên không sinh được code fix.' },
        { status: 422 },
      );
    }
    const config = aiConfigFromEnv();
    if (!config) {
      return NextResponse.json(
        { error: 'Chưa cấu hình AI. Đặt AI_BASE_URL, AI_API_KEY, AI_MODEL trong .env rồi restart app.' },
        { status: 503 },
      );
    }
    const findings = job.report.findings.filter(
      (f) => f.aiFixable && (!body.findingIds || body.findingIds.includes(f.id)),
    );
    if (findings.length === 0) {
      return NextResponse.json({ error: 'Không có finding nào để fix' }, { status: 422 });
    }
    try {
      const plan = await generateFixPlan(findings, job.report.sourceDir, config);
      fixes = plan.fixes;
    } catch (err) {
      return NextResponse.json(
        { error: `Sinh fix thất bại: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  }

  if (fixes.length === 0) {
    return NextResponse.json({ error: 'AI không sinh được thay đổi nào đáng tin cậy — hãy thử lại.' }, { status: 422 });
  }

  try {
    const result = await createFixPR({
      repo: targetRepo,
      token: body.token.trim(),
      baseBranch: body.baseBranch,
      title: `wpsa: fix ${fixes.length} performance/security findings`,
      fixes,
      bodyMarkdown: buildPrBody({
        summary: job.lastFixPlan?.summary ?? '',
        fixes,
      }),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Tạo PR thất bại: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
