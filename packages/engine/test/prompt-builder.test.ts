import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixPrompt } from '../src/ai/prompt-builder.js';
import type { Finding } from '../src/types.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wpsa-prompt-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'dist'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app', dependencies: {} }));
  await writeFile(
    path.join(dir, 'src', 'app.tsx'),
    ["import _ from 'lodash';", 'export const App = () => null;', ''].join('\n'),
  );
  // file build output minified: 1 dòng cực dài
  await writeFile(path.join(dir, 'dist', 'bundle.js'), 'x'.repeat(5000));
  // file nguồn dài nhưng đọc được: 200 dòng x 100 ký tự (> 10KB để test cắt theo ký tự)
  const longLine = 'a'.repeat(99);
  await writeFile(
    path.join(dir, 'src', 'big.ts'),
    Array.from({ length: 200 }, (_, i) => `${longLine} ${i}`).join('\n'),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'bundle-1',
    category: 'bundle',
    detector: 'bundle-detector',
    title: 'Full import lodash',
    detail: 'Import toàn bộ lodash thay vì import theo hàm.',
    severity: 'warning',
    files: [{ path: 'src/app.tsx', line: 1, snippet: "import _ from 'lodash';" }],
    impact: 'tăng ~70KB gzip',
    fixHint: 'Import trực tiếp hàm cần dùng.',
    metrics: { totalGzipKB: 24 },
    aiFixable: true,
    ...over,
  };
}

describe('buildFixPrompt', () => {
  it('chứa thông tin finding: tiêu đề, file:dòng, gợi ý fix, số liệu', async () => {
    const { prompt } = await buildFixPrompt([makeFinding()], dir, { includeFiles: false });
    expect(prompt).toContain('Full import lodash');
    expect(prompt).toContain('`src/app.tsx:1`');
    expect(prompt).toContain('Import trực tiếp hàm cần dùng.');
    expect(prompt).toContain('totalGzipKB=24');
    expect(prompt).toContain('Cảnh báo');
  });

  it('kèm snippet của FileRef khi có', async () => {
    const { prompt } = await buildFixPrompt([makeFinding()], dir, { includeFiles: false });
    expect(prompt).toContain("import _ from 'lodash';");
  });

  it('sắp finding theo severity: critical trước warning', async () => {
    const { prompt } = await buildFixPrompt(
      [
        makeFinding({ id: 'w', severity: 'warning', title: 'Finding warning' }),
        makeFinding({ id: 'c', severity: 'critical', title: 'Finding critical' }),
      ],
      dir,
      { includeFiles: false },
    );
    expect(prompt.indexOf('Finding critical')).toBeLessThan(prompt.indexOf('Finding warning'));
  });

  it('kèm nội dung file nguồn khi includeFiles=true (mặc định)', async () => {
    const { prompt, includedFiles } = await buildFixPrompt([makeFinding()], dir);
    expect(includedFiles).toContain('src/app.tsx');
    expect(prompt).toContain('----- FILE: src/app.tsx -----');
    expect(prompt).toContain("import _ from 'lodash';");
  });

  it('không kèm file nguồn khi includeFiles=false', async () => {
    const { prompt, includedFiles } = await buildFixPrompt([makeFinding()], dir, { includeFiles: false });
    expect(includedFiles).toEqual([]);
    expect(prompt).not.toContain('----- FILE:');
  });

  it('ghi ngữ cảnh repo + liveUrl khi có', async () => {
    const { prompt } = await buildFixPrompt([makeFinding()], dir, {
      includeFiles: false,
      repo: { owner: 'acme', name: 'web', branch: 'main' },
      liveUrl: 'https://preview.example.com',
    });
    expect(prompt).toContain('acme/web');
    expect(prompt).toContain('branch: main');
    expect(prompt).toContain('https://preview.example.com');
  });

  it('file trong finding không tồn tại thì vẫn liệt kê nhưng bỏ qua khi đọc nội dung', async () => {
    const { prompt, includedFiles } = await buildFixPrompt(
      [makeFinding({ files: [{ path: 'src/missing.ts', line: 9 }] })],
      dir,
    );
    expect(prompt).toContain('`src/missing.ts:9`');
    expect(includedFiles).not.toContain('src/missing.ts');
  });

  it('không đính kèm file trong thư mục build output (dist/build/node_modules…)', async () => {
    const { prompt, includedFiles } = await buildFixPrompt(
      [makeFinding({ files: [{ path: 'dist/bundle.js' }] })],
      dir,
    );
    expect(includedFiles).not.toContain('dist/bundle.js');
    expect(prompt).not.toContain('----- FILE: dist/bundle.js -----');
    // finding vẫn được mô tả đầy đủ kèm đường dẫn
    expect(prompt).toContain('`dist/bundle.js`');
  });

  it('cắt bớt file nguồn quá dài theo ký tự, có ghi chú cắt', async () => {
    const { prompt, includedFiles } = await buildFixPrompt(
      [makeFinding({ files: [{ path: 'src/big.ts' }] })],
      dir,
    );
    expect(includedFiles).toContain('src/big.ts');
    expect(prompt).toContain('cắt bớt');
    const fileSection = prompt.split('----- FILE: src/big.ts -----')[1] ?? '';
    const fileContent = fileSection.split('----- FILE:')[0] ?? '';
    expect(fileContent.length).toBeLessThan(11_000);
  });
});
