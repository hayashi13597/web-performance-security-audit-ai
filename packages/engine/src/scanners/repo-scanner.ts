import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RepoInfo, RepoSource } from '../types.js';

const execFileAsync = promisify(execFile);

export function parseGitHubUrl(url: string): { owner: string; name: string; branch?: string } | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const m = cleaned.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^/\s]+))?/i);
  if (!m) return null;
  return { owner: m[1], name: m[2], branch: m[3] };
}

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Đưa source project về một thư mục trên đĩa.
 * - GitHub: tải tarball qua API (hỗ trợ token cho repo private), giải nén bằng tar.
 * - Local: trả về path gốc (dành cho dev chạy trên máy).
 */
export async function resolveSourceDir(source: RepoSource, workRoot: string): Promise<{ dir: string; repo?: RepoInfo }> {
  if (source.kind === 'local') {
    const abs = path.resolve(source.path);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Thư mục local không tồn tại: ${abs}`);
    }
    return { dir: abs };
  }

  const parsed = parseGitHubUrl(source.repoUrl);
  if (!parsed) {
    throw new Error(`Không parse được URL GitHub: ${source.repoUrl}. Dạng hỗ trợ: https://github.com/owner/repo[/tree/branch]`);
  }

  const branch = parsed.branch ?? 'HEAD';
  const dir = path.join(workRoot, `${parsed.owner}-${parsed.name}-${branch === 'HEAD' ? 'default' : branch}`);
  await fs.mkdir(dir, { recursive: true });

  const tarballUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.name}/tarball/${branch}`;
  const headers: Record<string, string> = {
    'user-agent': 'WPSA-Audit/0.1',
    accept: 'application/vnd.github+json',
  };
  if (source.token) headers.authorization = `Bearer ${source.token}`;

  const res = await fetch(tarballUrl, { headers, redirect: 'follow' });
  if (!res.ok) {
    const hint =
      res.status === 404
        ? ' — repo/branch không tồn tại hoặc là repo private mà không truyền token.'
        : res.status === 401 || res.status === 403
          ? ' — token không hợp lệ hoặc hết quota GitHub API.'
          : '';
    throw new Error(`Tải repo thất bại (HTTP ${res.status})${hint}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Repo quá lớn (>200MB tarball), không hỗ trợ ở bản MVP.');
  }
  // tarball gzip bắt đầu bằng magic 1f 8b; nếu không phải thì HTTP 200 trả về nội dung lạ (HTML/proxy...)
  if (buf.byteLength < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) {
    throw new Error('Nội dung tải về không phải tarball gzip — kiểm tra lại URL/repo hoặc proxy mạng.');
  }

  const tarPath = `${dir}.tgz`;
  await fs.writeFile(tarPath, buf);

  // Dọn kết quả cũ để lần chạy lại không trộn file từ lần giải nén trước
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  // GNU tar (Git for Windows) hiểu đường dẫn tuyệt đối "C:\..." là remote host:path,
  // nên chạy tar với cwd = dir và archive path tương đối để tương thích cả GNU tar lẫn bsdtar.
  await execFileAsync('tar', ['-xzf', `../${path.basename(tarPath)}`, '--strip-components=1'], { cwd: dir });
  await fs.rm(tarPath, { force: true });

  return {
    dir,
    repo: { owner: parsed.owner, name: parsed.name, branch: branch === 'HEAD' ? 'default' : branch },
  };
}

/** Đọc danh sách file (relative path) từ project dir, giới hạn dung lượng cho prompt AI. */
export async function readProjectFiles(
  projectDir: string,
  relPaths: string[],
  opts: { maxFiles?: number; maxLinesPerFile?: number } = {},
): Promise<Record<string, string>> {
  const maxFiles = opts.maxFiles ?? 10;
  const maxLines = opts.maxLinesPerFile ?? 350;
  const out: Record<string, string> = {};

  for (const rel of relPaths.slice(0, maxFiles)) {
    const normalized = rel.replace(/\\/g, '/');
    const abs = path.resolve(projectDir, normalized);
    // chống path traversal thoát khỏi project
    if (!abs.startsWith(path.resolve(projectDir))) continue;
    const content = await fs.readFile(abs, 'utf8').catch(() => null);
    if (content === null) continue;
    const lines = content.split(/\r?\n/);
    out[normalized] = lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n/* … truncated ${lines.length - maxLines} lines */` : content;
  }
  return out;
}
