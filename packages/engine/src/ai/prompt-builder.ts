import type { Finding, RepoInfo } from '../types.js';
import { CATEGORY_LABELS } from '../types.js';
import { readProjectFiles } from '../scanners/repo-scanner.js';
import { collectRelevantPaths } from './fix-generator.js';

export interface FixPromptResult {
  prompt: string;
  /** Các file nguồn thực sự được đính kèm vào prompt (rỗng khi includeFiles=false hoặc không đọc được file nào). */
  includedFiles: string[];
}

export interface BuildFixPromptOptions {
  /** Mặc định true — đính kèm nội dung các file liên quan đọc từ projectDir. */
  includeFiles?: boolean;
  repo?: RepoInfo;
  liveUrl?: string;
}

const PRIORITY: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_VI: Record<string, string> = { critical: 'Nghiêm trọng', warning: 'Cảnh báo', info: 'Gợi ý' };

/** Thư mục build output / dependency — không đính kèm vào prompt (AI sửa source, không sửa artifact). */
const BUILD_OUTPUT_DIR = /(^|\/)(dist|build|out|\.next|\.output|\.svelte-kit|node_modules|coverage)\//i;
/** Dòng dài hơn ngưỡng này ⇒ gần như chắc chắn là file minified/bundle — bỏ thay vì phình prompt. */
const MINIFIED_LINE_THRESHOLD = 1000;
/** Giới hạn ký tự mỗi file đính kèm. */
const MAX_CHARS_PER_FILE = 10_000;

function isMinified(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    if (line.length > MINIFIED_LINE_THRESHOLD) return true;
  }
  return false;
}

/** Sinh prompt (markdown, tiếng Việt) mô tả các finding để người dùng dán vào AI coding tool tự sửa tại source. */
export async function buildFixPrompt(
  findings: Finding[],
  projectDir: string,
  opts: BuildFixPromptOptions = {},
): Promise<FixPromptResult> {
  const includeFiles = opts.includeFiles !== false;
  const sorted = [...findings].sort((a, b) => (PRIORITY[a.severity] ?? 3) - (PRIORITY[b.severity] ?? 3));

  const candidatePaths =
    includeFiles && sorted.length > 0
      ? (await collectRelevantPaths(projectDir, sorted)).filter((p) => !BUILD_OUTPUT_DIR.test(p))
      : [];
  const rawFiles = candidatePaths.length > 0
    ? await readProjectFiles(projectDir, candidatePaths, { maxFiles: 10, maxLinesPerFile: 350 })
    : {};
  const files: Record<string, string> = {};
  for (const [p, content] of Object.entries(rawFiles)) {
    if (isMinified(content)) continue;
    files[p] =
      content.length > MAX_CHARS_PER_FILE
        ? `${content.slice(0, MAX_CHARS_PER_FILE)}\n/* … (cắt bớt, còn lại ${content.length - MAX_CHARS_PER_FILE} ký tự) */`
        : content;
  }
  const includedFiles = Object.keys(files);

  const sections: string[] = [];

  sections.push(`# Nhiệm vụ: sửa các vấn đề hiệu năng / bảo mật / SEO trong source code

Bạn là kỹ sư frontend senior. Dưới đây là kết quả audit (Web Performance & Security Audit) của project đang mở trong thư mục làm việc này.
Hãy đọc kỹ từng finding và **sửa trực tiếp trong source code**.`);

  const contextLines: string[] = [];
  if (opts.repo) contextLines.push(`- Repo: ${opts.repo.owner}/${opts.repo.name} (branch: ${opts.repo.branch})`);
  if (opts.liveUrl) contextLines.push(`- URL đang chạy (để kiểm chứng sau khi fix): ${opts.liveUrl}`);
  if (contextLines.length > 0) sections.push(`## Ngữ cảnh\n\n${contextLines.join('\n')}`);

  sections.push(renderFindings(sorted));

  sections.push(`## Yêu cầu

- Sửa đúng root cause của từng finding ở trên, không dùng giải pháp tạm thời (workaround).
- Giữ nguyên hành vi (behavior) hiện tại của app; chỉ thay đổi những gì cần thiết.
- Giữ nguyên code style, thứ tự import và formatting hiện có của từng file.
- Không thêm npm dependency mới — ưu tiên API built-in hoặc package đã có trong package.json.
- Nếu một finding không thể sửa được vì thiếu ngữ cảnh, ghi rõ lý do thay vì bỏ qua im lặng.
- Sau khi sửa xong, tóm tắt danh sách file đã thay đổi kèm lý do (tiếng Việt).`);

  if (includedFiles.length > 0) {
    const filesText = Object.entries(files)
      .map(([p, content]) => `----- FILE: ${p} -----\n${content}`)
      .join('\n\n');
    sections.push(`## Nội dung nguồn các file liên quan (chụp tại thời điểm quét — có thể đã lỗi nhẹ so với bản hiện tại)

${filesText}`);
  }

  return { prompt: sections.join('\n\n'), includedFiles };
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return '## Findings cần sửa\n\nKhông có finding nào.';
  }
  const blocks = findings.map((f, i) => {
    const lines: string[] = [];
    lines.push(`### ${i + 1}. [${SEVERITY_VI[f.severity] ?? f.severity}] ${f.title}`);
    lines.push(`- Mã finding: \`${f.id}\` · Nhóm: ${CATEGORY_LABELS[f.category] ?? f.category} (${f.category}) · Detector: ${f.detector}`);
    lines.push(`- Mô tả: ${f.detail}`);
    if (f.files && f.files.length > 0) {
      lines.push('- File liên quan:');
      for (const file of f.files) {
        lines.push(`  - \`${file.path}${file.line ? `:${file.line}` : ''}\``);
        if (file.snippet) lines.push(`    \`\`\`\n    ${file.snippet.trim()}\n    \`\`\``);
      }
    }
    if (f.impact) lines.push(`- Tác động: ${f.impact}`);
    if (f.fixHint) lines.push(`- Gợi ý fix: ${f.fixHint}`);
    const metrics = Object.entries(f.metrics ?? {});
    if (metrics.length > 0) {
      lines.push(`- Số liệu: ${metrics.map(([k, v]) => `${k}=${String(v)}`).join(', ')}`);
    }
    return lines.join('\n');
  });
  return `## Findings cần sửa (${findings.length} finding)\n\n${blocks.join('\n\n')}`;
}
