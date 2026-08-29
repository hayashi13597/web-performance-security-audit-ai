import { NextResponse } from 'next/server';
import { createScanJob, pruneOldJobs } from '@/lib/job-store';
import type { ScanRequest } from '@wpsa/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  mode?: string;
  url?: string;
  repoUrl?: string;
  token?: string;
  localPath?: string;
  liveUrl?: string;
  formFactor?: string;
  memoryRounds?: number;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function POST(req: Request): Promise<NextResponse> {
  pruneOldJobs();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }

  const formFactor = body.formFactor === 'desktop' ? 'desktop' : 'mobile';
  const memoryRounds = Number(body.memoryRounds) > 0 ? Number(body.memoryRounds) : 3;

  let request: ScanRequest;
  if (body.mode === 'url') {
    const url = normalizeUrl(body.url ?? '');
    if (!url || !/^https?:\/\/[^\s$.?#].\S*$/i.test(url)) {
      return NextResponse.json({ error: 'URL không hợp lệ' }, { status: 400 });
    }
    request = { mode: 'url', url, formFactor, memoryRounds };
  } else if (body.mode === 'repo') {
    const repoUrl = (body.repoUrl ?? '').trim();
    if (!repoUrl) {
      return NextResponse.json({ error: 'Thiếu URL GitHub repo' }, { status: 400 });
    }
    request = {
      mode: 'repo',
      source: { kind: 'github', repoUrl, token: body.token?.trim() || undefined },
      liveUrl: body.liveUrl ? normalizeUrl(body.liveUrl) : undefined,
      formFactor,
      memoryRounds,
    };
  } else if (body.mode === 'local') {
    const localPath = (body.localPath ?? '').trim();
    if (!localPath) {
      return NextResponse.json({ error: 'Thiếu đường dẫn thư mục' }, { status: 400 });
    }
    request = {
      mode: 'repo',
      source: { kind: 'local', path: localPath },
      liveUrl: body.liveUrl ? normalizeUrl(body.liveUrl) : undefined,
      formFactor,
      memoryRounds,
    };
  } else {
    return NextResponse.json({ error: 'mode phải là "url" | "repo" | "local"' }, { status: 400 });
  }

  const job = createScanJob(request);
  return NextResponse.json({ id: job.id }, { status: 201 });
}
