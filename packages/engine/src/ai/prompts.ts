import type { Finding } from '../types.js';

export const FIX_SYSTEM_PROMPT = `You are a senior frontend performance engineer. You produce precise, minimal, production-ready code fixes for performance/security/SEO findings found in a web project.

Rules:
- Respond with JSON ONLY, no markdown fences, matching exactly:
{"summary": string, "fixes": [{"findingId": string, "file": string, "action": "modify"|"create", "content": string, "rationale": string}]}
- "content" must be the FULL new content of the file, ready to write to disk. Never output diffs, placeholders like "...", or "rest of file unchanged".
- Keep the existing code style, imports ordering and formatting of each file. Change ONLY what is needed to fix the listed findings.
- Do not invent new npm dependencies. Prefer built-in APIs or what is already in package.json.
- Fix each finding at its root cause (e.g. a render loop caused by useEffect without deps must be fixed by adding correct deps, not by removing the effect).
- If a finding cannot be fixed with the provided files, omit it from "fixes".
- All human-readable strings ("summary", "rationale") must be written in Vietnamese.`;

export function buildFixUserPrompt(input: {
  findings: Finding[];
  files: Record<string, string>;
  contextNote?: string;
}): string {
  const findingsJson = input.findings.map((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    metrics: f.metrics,
    relatedFiles: f.files?.map((x) => x.path),
    fixHint: f.fixHint,
  }));

  const filesText = Object.entries(input.files)
    .map(([path, content]) => `----- FILE: ${path} -----\n${content}`)
    .join('\n\n');

  return `Audit findings to fix (fix as many as possible):
${JSON.stringify(findingsJson, null, 2)}

${input.contextNote ? `Context: ${input.contextNote}\n` : ''}
Current content of relevant project files:
${filesText}

Produce the JSON fix plan now.`;
}
