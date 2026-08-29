import { Octokit } from 'octokit';
import type { FixSuggestion, PRResult } from '../types.js';

export interface CreatePROptions {
  /** "owner/name" */
  repo: string;
  token: string;
  baseBranch?: string;
  title: string;
  fixes: FixSuggestion[];
  /** Tóm tắt findings để đưa vào body PR. */
  bodyMarkdown: string;
}

// Các response fields thực sự dùng — khai báo tối thiểu, octokit.request trả về JSON gốc
interface RepoResponse {
  default_branch: string;
  permissions?: { push?: boolean };
}
interface RefResponse {
  object: { sha: string };
}
interface BlobResponse {
  sha: string;
}
interface TreeResponse {
  sha: string;
}
interface CommitResponse {
  sha: string;
}
interface PullResponse {
  html_url: string;
  number: number;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/').map((s) => s.trim());
  if (!owner || !name) throw new Error(`Repo phải dạng "owner/name", nhận được: "${repo}"`);
  return { owner, name };
}

/** Bọc lời gọi API để lỗi luôn nói rõ bước nào fail; ẩn message rỗng kiểu "Not Found" của Octokit. */
async function withStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const raw = (e.message ?? String(err)).replace(/ - https:\/\/docs\.github\.com\S*$/, '');
    const detail = raw.startsWith('Not Found') ? '' : ` — ${raw}`;
    const status = e.status ? ` (HTTP ${e.status})` : '';
    throw new Error(`Bước "${step}" thất bại${status}${detail}`);
  }
}

/** Tạo branch + 1 commit chứa mọi fix + mở Pull Request. */
export async function createFixPR(options: CreatePROptions): Promise<PRResult> {
  const { owner, name } = splitRepo(options.repo);
  const octokit = new Octokit({ auth: options.token });

  const repoData = (
    await withStep('Đọc thông tin repo (404 = repo không tồn tại hoặc token không được truy cập repo này)', () =>
      octokit.request('GET /repos/{owner}/{repo}', { owner, repo: name }),
    )
  ).data as RepoResponse;
  if (repoData.permissions && !repoData.permissions.push) {
    throw new Error('Token không có quyền push lên repo này.');
  }
  const base = options.baseBranch?.trim() || repoData.default_branch;

  let baseSha: string;
  try {
    baseSha = (
      await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo: name,
        ref: `heads/${base}`,
      })
    ).data.object.sha as string;
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      throw new Error(
        `Không đọc được branch gốc "${base}" (404). Kiểm tra: (1) branch này có tồn tại trên repo không — xoá trống ô "Branch gốc" để dùng default branch (${repoData.default_branch}); (2) token fine-grained phải cấp "Contents: Read and write" và repo này phải nằm trong "Repository access" của token — GitHub trả 404 thay vì 403 khi token không đủ quyền đọc refs.`,
      );
    }
    throw err;
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let branch = `wpsa/audit-fix-${stamp}`;
  let branchExists = false;
  try {
    await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo: name,
      ref: `heads/${branch}`,
    });
    branchExists = true;
  } catch {
    // chưa tồn tại — điều tốt
  }
  if (branchExists) branch = `${branch}-${Date.now().toString(36).slice(-4)}`;

  // Tạo blob cho từng file fix rồi dựng tree từ base
  const treeItems: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (const fix of options.fixes) {
    const blob = (
      await withStep(`Tạo blob cho ${fix.file}`, () =>
        octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
          owner,
          repo: name,
          content: Buffer.from(fix.content, 'utf8').toString('base64'),
          encoding: 'base64',
        }),
      )
    ).data as BlobResponse;
    treeItems.push({ path: fix.file, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = (
    await withStep('Tạo tree', () =>
      octokit.request('POST /repos/{owner}/{repo}/git/trees', {
        owner,
        repo: name,
        base_tree: baseSha,
        tree: treeItems,
      }),
    )
  ).data as TreeResponse;

  const commit = (
    await withStep('Tạo commit', () =>
      octokit.request('POST /repos/{owner}/{repo}/git/commits', {
        owner,
        repo: name,
        message: `wpsa: auto-fix performance & security findings (${options.fixes.length} file)`,
        tree: tree.sha,
        parents: [baseSha],
      }),
    )
  ).data as CommitResponse;

  await withStep(`Tạo branch ${branch} (403 = token thiếu quyền ghi Contents)`, () =>
    octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo: name,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    }),
  );

  const pr = (
    await withStep('Mở Pull Request', () =>
      octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo: name,
        title: options.title,
        head: branch,
        base,
        body: options.bodyMarkdown,
      }),
    )
  ).data as PullResponse;

  return {
    prUrl: pr.html_url,
    branch,
    commitSha: commit.sha,
    filesChanged: options.fixes.length,
  };
}

/** Đánh máy body PR: tóm tắt findings + các file đã sửa. */
export function buildPrBody(input: { summary: string; fixes: FixSuggestion[]; reportUrl?: string }): string {
  const lines: string[] = [];
  lines.push('## 🛠 WPSA Auto-fix PR');
  lines.push('');
  if (input.summary) lines.push(input.summary, '');
  lines.push('### Các thay đổi');
  for (const fix of input.fixes) {
    lines.push(`- **\`${fix.file}\`** — ${fix.rationale || 'sửa theo finding'}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('> Được sinh tự động bởi **WPSA (Web Performance & Security Audit AI)**. Hãy review kỹ trước khi merge — đặc biệt các thay đổi liên quan tới logic render.');
  if (input.reportUrl) {
    lines.push('');
    lines.push(`Báo cáo scan: ${input.reportUrl}`);
  }
  return lines.join('\n');
}
