import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBundleScan } from '../src/detectors/bundle-detector.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wpsa-bundle-'));
  await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
  await mkdir(path.join(dir, 'dist'), { recursive: true });

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      dependencies: { react: '^18.0.0', lodash: '^4.17.0', moment: '^2.29.0', recharts: '^2.0.0' },
    }),
  );

  await writeFile(
    path.join(dir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n`,
  );

  await writeFile(
    path.join(dir, 'src', 'app.tsx'),
    [
      "import _ from 'lodash';",
      "import moment from 'moment';",
      "import { LineChart } from 'recharts';",
      "import { Button } from './components';",
      "import * as React from 'react';",
      'export const App = () => null;',
    ].join('\n'),
  );

  // Barrel file với 25 re-exports
  const barrelLines = Array.from({ length: 25 }, (_, i) => `export * from './c${i}';`).join('\n');
  await writeFile(path.join(dir, 'src', 'components', 'index.ts'), barrelLines);
  for (let i = 0; i < 25; i++) {
    await writeFile(path.join(dir, 'src', 'components', `c${i}.ts`), `export const c${i} = ${i};`);
  }

  // Build output: một file 300KB
  await writeFile(path.join(dir, 'dist', 'big.js'), 'x'.repeat(300 * 1024));
  await writeFile(path.join(dir, 'dist', 'small.js'), 'x'.repeat(10 * 1024));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runBundleScan', () => {
  it('phát hiện stack vite + react', async () => {
    const { stack } = await runBundleScan(dir);
    expect(stack.bundler).toBe('vite');
    expect(stack.frameworks).toContain('react');
  });

  it('phát hiện import nguyên khối lodash/moment và recharts import tĩnh', async () => {
    const { findings } = await runBundleScan(dir);
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => t.includes('"lodash"'))).toBe(true);
    expect(titles.some((t) => t.includes('"moment"'))).toBe(true);
    expect(titles.some((t) => t.includes('"recharts"'))).toBe(true);
    const lodashFinding = findings.find((f) => f.title.includes('"lodash"'))!;
    expect(lodashFinding.files?.[0].path).toBe('src/app.tsx');
    expect(lodashFinding.files?.[0].line).toBe(1);
  });

  it('phát hiện barrel file nhiều re-exports', async () => {
    const { findings } = await runBundleScan(dir);
    expect(findings.some((f) => f.title.includes('re-export 25'))).toBe(true);
  });

  it('phát hiện thiếu manualChunks và thiếu sideEffects', async () => {
    const { findings } = await runBundleScan(dir);
    expect(findings.some((f) => f.title.includes('manualChunks'))).toBe(true);
    expect(findings.some((f) => f.title.includes('sideEffects'))).toBe(true);
  });

  it('phát hiện chunk 300KB trong dist', async () => {
    const { findings } = await runBundleScan(dir);
    const chunkFinding = findings.find((f) => f.title.includes('Chunk quá lớn'));
    expect(chunkFinding).toBeTruthy();
    expect(chunkFinding?.metrics?.['rawKb']).toBe(300);
  });
});
