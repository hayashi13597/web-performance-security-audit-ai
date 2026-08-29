import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DirEntry {
  name: string;
  path: string;
}

async function listRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return ['/'];
  const roots: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`;
    try {
      await fs.access(drive);
      roots.push(drive);
    } catch {
      // Ổ đĩa không tồn tại — bỏ qua
    }
  }
  return roots;
}

// GET /api/fs                → { home, roots } (điểm xuất phát cho picker)
// GET /api/fs?path=<abs>     → { path, parent, entries: DirEntry[] } (chỉ thư mục con)
export async function GET(req: Request): Promise<NextResponse> {
  const raw = new URL(req.url).searchParams.get('path')?.trim();

  if (!raw) {
    return NextResponse.json({ home: os.homedir(), roots: await listRoots() });
  }

  const dir = path.resolve(raw);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return NextResponse.json({ error: `Thư mục không tồn tại hoặc không hợp lệ: ${dir}` }, { status: 400 });
  }

  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: `Không đọc được thư mục: ${dir}` }, { status: 400 });
  }

  const entries: DirEntry[] = dirents
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = path.dirname(dir);
  return NextResponse.json({
    path: dir,
    parent: parent === dir ? null : parent,
    entries,
  });
}
