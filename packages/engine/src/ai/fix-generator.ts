import { createTwoFilesPatch } from 'diff';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AiConfig } from './types.js';
import { chatJson } from './client.js';
import { FIX_SYSTEM_PROMPT, buildFixUserPrompt } from './prompts.js';
import { readProjectFiles } from '../scanners/repo-scanner.js';
import type { FixPlan, FixSuggestion, Finding } from '../types.js';

export { aiConfigFromEnv } from './client.js';
export type { AiConfig } from './types.js';

const MAX_FINDINGS_PER_CALL = 12;
const PRIORITY: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Gom các file liên quan: file trong findings + build configs + package.json. */
export async function collectRelevantPaths(projectDir: string, findings: Finding[]): Promise<string[]> {
  const paths = new Set<string>();
  for (const f of findings) {
    for (const file of f.files ?? []) paths.add(file.path);
  }
  for (const cfg of ['package.json', 'vite.config.ts', 'vite.config.js', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'webpack.config.js', 'index.html']) {
    paths.add(cfg);
  }
  // lọc theo file thực sự tồn tại
  const existing: string[] = [];
  for (const p of paths) {
    const stat = await fs.stat(path.resolve(projectDir, p)).catch(() => null);
    if (stat?.isFile()) existing.push(p);
  }
  return existing;
}

interface RawFix {
  findingId?: string;
  file?: string;
  action?: string;
  content?: string;
  rationale?: string;
}

/**
 * Sinh plan sửa lỗi bằng AI: findings + nội dung file → danh sách file mới (full content) + diff hiển thị.
 * findings cần có `files` trỏ tới source thực tế (repo scan) — ngược lại không sinh được fix có nghĩa.
 */
export async function generateFixPlan(
  findings: Finding[],
  projectDir: string,
  config: AiConfig,
): Promise<FixPlan> {
  const fixable = findings
    .filter((f) => f.aiFixable)
    .sort((a, b) => (PRIORITY[a.severity] ?? 3) - (PRIORITY[b.severity] ?? 3))
    .slice(0, MAX_FINDINGS_PER_CALL);

  if (fixable.length === 0) {
    return { fixes: [], summary: 'Không có finding nào có thể sinh code fix tự động.' };
  }

  const relevantPaths = await collectRelevantPaths(projectDir, fixable);
  const files = await readProjectFiles(projectDir, relevantPaths, { maxFiles: 10, maxLinesPerFile: 350 });

  const raw = (await chatJson(
    config,
    [
      { role: 'system', content: FIX_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildFixUserPrompt({
          findings: fixable,
          files,
          contextNote: `Bundler/framework được phát hiện trong project. Mọi fix phải giữ nguyên runtime hiện tại của app.`,
        }),
      },
    ],
    { maxTokens: 12000, temperature: 0.2 },
  )) as { summary?: string; fixes?: RawFix[] };

  const validIds = new Set(fixable.map((f) => f.id));
  const fixes: FixSuggestion[] = [];

  for (const fix of raw.fixes ?? []) {
    if (!fix.file || (fix.action !== 'create' && fix.action !== 'modify') || typeof fix.content !== 'string') continue;
    const findingId = fix.findingId && validIds.has(fix.findingId) ? fix.findingId : fixable[0]?.id ?? '';
    const normalizedFile = fix.file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalizedFile || normalizedFile.includes('..')) continue;

    const abs = path.resolve(projectDir, normalizedFile);
    if (!abs.startsWith(path.resolve(projectDir))) continue;
    const oldContent = await fs.readFile(abs, 'utf8').catch(() => null);
    if (oldContent === null && fix.action !== 'create') continue;
    if (oldContent === fix.content) continue; // AI trả về nội dung y hệt — bỏ

    const diff =
      oldContent !== null
        ? createTwoFilesPatch(`a/${normalizedFile}`, `b/${normalizedFile}`, oldContent, fix.content, undefined, undefined, { context: 3 })
        : createTwoFilesPatch('a/' + normalizedFile, 'b/' + normalizedFile, '', fix.content, undefined, undefined, { context: 3 });

    fixes.push({
      findingId,
      file: normalizedFile,
      action: oldContent === null ? 'create' : 'modify',
      content: fix.content,
      rationale: fix.rationale ?? '',
      diff,
    });
  }

  return {
    fixes,
    summary: raw.summary ?? '',
  };
}
