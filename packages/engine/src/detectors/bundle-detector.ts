import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Category, Finding, Severity } from '../types.js';

// ===== Kiến trúc project phát hiện được =====
export interface DetectedStack {
  frameworks: string[];
  bundler: 'vite' | 'next' | 'webpack' | 'rollup' | 'unknown';
  configFiles: string[];
  hasBuildOutput: boolean;
  totalSourceFiles: number;
}

export interface BundleScanResult {
  stack: DetectedStack;
  findings: Finding[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue'];

/** Thư viện nặng: import nguyên khối gây phình bundle. */
const HEAVY_FULL_IMPORT: Record<string, { impact: string; fix: string; severity: Severity }> = {
  lodash: {
    impact: '~24KB gzip cho toàn bộ thay vì ~1-2KB khi import từng hàm',
    fix: "Chuyển sang `import debounce from 'lodash/debounce'` hoặc `lodash-es`, hoặc khai báo optimizePackageImports.",
    severity: 'warning',
  },
  moment: {
    impact: '~71KB gzip (kèm locale ~120KB)',
    fix: 'Thay bằng dayjs (~2KB) hoặc date-fns với import từng hàm.',
    severity: 'warning',
  },
  rxjs: {
    impact: '~30KB gzip nếu import từ gốc',
    fix: "Import từ subpath: `import { map } from 'rxjs/operators'`.",
    severity: 'info',
  },
};

/** Thư viện nặng nên được dynamic import (lazy-load) thay vì nằm trong bundle chính. */
const LAZY_CANDIDATES: Record<string, { impact: string; fix: string; severity: Severity }> = {
  recharts: { impact: '~90KB gzip', fix: "Dynamic import: `const Chart = lazy(() => import('./BigChart'))`.", severity: 'warning' },
  'chart.js': { impact: '~65KB gzip', fix: 'Dynamic import chart.js cùng component vẽ chart.', severity: 'warning' },
  three: { impact: '~150KB gzip', fix: 'Dynamic import bên trong component 3D.', severity: 'warning' },
  d3: { impact: '~90KB gzip nếu import từ gốc', fix: "Import subpath (d3-scale, d3-shape…) hoặc dynamic import.", severity: 'warning' },
  xlsx: { impact: '~120KB gzip', fix: 'Dynamic import khi người dùng bấm xuất/nhập file.', severity: 'warning' },
  pdfmake: { impact: '~200KB gzip', fix: 'Dynamic import khi cần sinh PDF.', severity: 'warning' },
};

const IMPORT_RE = /import\s+(?:type\s+)?(?:(\*\s+as\s+\w+)|(\w+)?\s*,?\s*(?:\{[^}]*\})?)\s*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

interface ImportRecord {
  pkg: string;
  file: string;
  line: number;
  snippet: string;
  isDynamic: boolean;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function makeFinding(
  category: Category,
  detector: string,
  title: string,
  detail: string,
  severity: Severity,
  extra: Partial<Finding> = {},
): Finding {
  return {
    id: nextId('bun'),
    category,
    detector,
    title,
    detail,
    severity,
    aiFixable: true,
    ...extra,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findFile(dir: string, base: string): Promise<string | null> {
  for (const ext of ['.ts', '.js', '.mjs', '.mts', '.cjs']) {
    const p = path.join(dir, base + ext);
    if (await exists(p)) return p;
  }
  return null;
}

async function readTextSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function detectStack(projectDir: string): Promise<DetectedStack> {
  const pkgRaw = await readTextSafe(path.join(projectDir, 'package.json'));
  const pkg = pkgRaw ? (JSON.parse(pkgRaw) as Record<string, Record<string, string>>) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const frameworks: string[] = [];
  for (const f of ['next', 'nuxt', 'svelte', '@sveltejs/kit', 'vue', 'react', 'astro', '@angular/core']) {
    if (deps[f]) frameworks.push(f.replace('@sveltejs/kit', 'sveltekit'));
  }

  let bundler: DetectedStack['bundler'] = 'unknown';
  const configFiles: string[] = [];

  const viteCfg = await findFile(projectDir, 'vite.config');
  const nextCfg = await findFile(projectDir, 'next.config');
  const webpackCfg = await findFile(projectDir, 'webpack.config');
  const rollupCfg = await findFile(projectDir, 'rollup.config');

  if (viteCfg) { bundler = 'vite'; configFiles.push(path.basename(viteCfg)); }
  else if (nextCfg || deps['next']) { bundler = 'next'; if (nextCfg) configFiles.push(path.basename(nextCfg)); }
  else if (webpackCfg || deps['webpack']) { bundler = 'webpack'; if (webpackCfg) configFiles.push(path.basename(webpackCfg)); }
  else if (rollupCfg) { bundler = 'rollup'; configFiles.push(path.basename(rollupCfg)); }
  else if (deps['vite']) { bundler = 'vite'; }

  const hasBuildOutput =
    (await exists(path.join(projectDir, 'dist'))) ||
    (await exists(path.join(projectDir, 'build'))) ||
    (await exists(path.join(projectDir, '.next')));

  return { frameworks, bundler, configFiles, hasBuildOutput, totalSourceFiles: 0 };
}

interface WalkResult {
  files: string[];
  total: number;
}

async function walkSourceFiles(dir: string, out: string[], root: string): Promise<WalkResult> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { files: out, total };
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = await walkSourceFiles(full, out, root);
      total += r.total;
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
      total += 1;
    }
  }
  return { files: out, total };
}

async function collectImports(projectDir: string): Promise<{ imports: ImportRecord[]; totalFiles: number }> {
  const files: string[] = [];
  await walkSourceFiles(projectDir, files, projectDir);
  const imports: ImportRecord[] = [];
  for (const file of files) {
    const content = await readTextSafe(file);
    if (!content) continue;
    const rel = path.relative(projectDir, file).replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_RE.exec(line)) !== null) {
        const pkg = m[3] ?? m[4] ?? m[5];
        if (!pkg) continue;
        imports.push({
          pkg,
          file: rel,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
          isDynamic: m[4] !== undefined,
        });
      }
    }
  }
  return { imports, totalFiles: files.length };
}

async function measureBuildOutput(projectDir: string): Promise<Finding[]> {
  const candidates = ['dist', 'build', path.join('.next', 'static')];
  const bigFiles: { file: string; rawKb: number; gzipKb: number }[] = [];
  let totalJsKb = 0;

  for (const dir of candidates) {
    const abs = path.join(projectDir, dir);
    if (!(await exists(abs))) continue;
    const files: string[] = [];
    await walkAllJs(abs, files);
    for (const f of files) {
      const stat = await fs.stat(f);
      const kb = stat.size / 1024;
      if (f.endsWith('.js') || f.endsWith('.mjs')) totalJsKb += kb;
      if (kb >= 200) {
        const buf = await fs.readFile(f);
        const gz = gzipSync(buf).length / 1024;
        bigFiles.push({ file: path.relative(projectDir, f).replace(/\\/g, '/'), rawKb: Math.round(kb), gzipKb: Math.round(gz) });
      }
    }
  }

  const findings: Finding[] = [];
  if (totalJsKb > 0) {
    bigFiles.sort((a, b) => b.gzipKb - a.gzipKb);
    const top = bigFiles.slice(0, 8);
    if (totalJsKb > 500) {
      findings.push(
        makeFinding('bundle', 'bundle-output', `Bundle JS output khá lớn (~${Math.round(totalJsKb / 1024)}MB)`, 
          `Tổng dung lượng JS trong build output vượt 500KB. Các file nặng nhất (gzip): ${top
            .map((t) => `${t.file} (~${t.gzipKb}KB gzip)`)
            .join(', ')}. Xem xét code-splitting theo route và tách vendor chunks.`,
          'warning',
          { metrics: { totalJsKb: Math.round(totalJsKb) }, aiFixable: false },
        ),
      );
    }
    for (const t of top.slice(0, 3)) {
      findings.push(
        makeFinding(
          'bundle',
          'bundle-output',
          `Chunk quá lớn: ${t.file} (${t.rawKb}KB raw / ${t.gzipKb}KB gzip)`,
          'Chunk vượt mốc 200KB raw. Trình duyệt phải parse toàn bộ trước khi interactive; nên tách nhỏ bằng manualChunks/splitChunks hoặc lazy-load phần ít dùng.',
          'warning',
          { metrics: { rawKb: t.rawKb, gzipKb: t.gzipKb }, files: [{ path: t.file }], aiFixable: false },
        ),
      );
    }
  }
  return findings;
}

async function walkAllJs(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkAllJs(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
}

function lineOf(content: string, needle: RegExp): { line: number; snippet: string } | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (needle.test(lines[i])) return { line: i + 1, snippet: lines[i].trim().slice(0, 200) };
  }
  return null;
}

/** Quét tĩnh bundle của một project trên đĩa. */
export async function runBundleScan(projectDir: string): Promise<BundleScanResult> {
  const stack = await detectStack(projectDir);
  const findings: Finding[] = [];
  const { imports, totalFiles } = await collectImports(projectDir);
  stack.totalSourceFiles = totalFiles;

  const pkgRaw = await readTextSafe(path.join(projectDir, 'package.json'));
  const pkgJson = pkgRaw ? (JSON.parse(pkgRaw) as Record<string, unknown>) : {};

  // 1) Import nguyên khối thư viện nặng
  const pkgOf = (p: string): string | null => {
    if (p.startsWith('@')) {
      const [scope, name] = p.split('/');
      return `${scope}/${name}`;
    }
    return p.split('/')[0];
  };

  for (const imp of imports) {
    if (imp.pkg.startsWith('.') || imp.pkg.startsWith('~') || imp.pkg.startsWith('/')) continue;
    const root = pkgOf(imp.pkg)!;
    const heavy = HEAVY_FULL_IMPORT[root];
    if (heavy && !imp.isDynamic) {
      const isSubpath = imp.pkg !== root;
      if (root === 'lodash' && isSubpath) continue;
      if (root === 'rxjs' && isSubpath) continue;
      findings.push(
        makeFinding('bundle', 'bundle-imports', `Import nguyên khối "${root}" trong ${imp.file}:${imp.line}`,
          `Câu lệnh \`${imp.snippet}\` kéo toàn bộ thư viện vào bundle. Ước lượng: ${heavy.impact}.`,
          heavy.severity,
          { files: [{ path: imp.file, line: imp.line, snippet: imp.snippet }], impact: heavy.impact, fixHint: heavy.fix },
        ),
      );
      continue;
    }
    const lazy = LAZY_CANDIDATES[root];
    if (lazy && !imp.isDynamic) {
      // Đếm xem pkg này đã được dynamic import ở chỗ nào chưa
      const hasDynamicSomewhere = imports.some((i) => i.pkg === imp.pkg && i.isDynamic);
      if (!hasDynamicSomewhere) {
        findings.push(
          makeFinding('bundle', 'bundle-imports', `"${root}" (${lazy.impact}) đang được import tĩnh`,
            `File ${imp.file}:${imp.line} import tĩnh \`${imp.snippet}\`. ${root} chỉ cần ở một vài tương tác, nên lazy-load để không chặn first paint.`,
            lazy.severity,
            { files: [{ path: imp.file, line: imp.line, snippet: imp.snippet }], impact: lazy.impact, fixHint: lazy.fix },
          ),
        );
      }
    }
  }

  // 2) Barrel file: import từ index re-export nhiều module
  const barrelCandidates = imports.filter((i) => /^\.{1,2}\//.test(i.pkg) && !/\.(ts|tsx|js|jsx|mjs|css|scss|svg|json)$/i.test(i.pkg));
  const checkedBarrels = new Set<string>();
  for (const imp of barrelCandidates.slice(0, 30)) {
    // import tương đối phải resolve từ thư mục của file import, không phải project root
    const abs = path.resolve(projectDir, path.dirname(imp.file), imp.pkg);
    const idx = await findFile(abs, 'index');
    if (!idx || checkedBarrels.has(idx)) continue;
    checkedBarrels.add(idx);
    const content = await readTextSafe(idx);
    if (!content) continue;
    const exportCount = (content.match(/^\s*export\s/gm) ?? []).length;
    if (exportCount > 20) {
      const barrelRel = path.relative(projectDir, idx).replace(/\\/g, '/');
      findings.push(
        makeFinding('bundle', 'bundle-barrel', `Barrel file "${barrelRel}" re-export ${exportCount} module`,
          `Import qua barrel file khiến bundler phải pull rất nhiều module (trừ khi tree-shaking hoạt động trọn vẹn với sideEffects: false). Ưu tiên import trực tiếp từ file cụ thể.`,
          'info',
          { files: [{ path: barrelRel }], metrics: { exportCount }, fixHint: 'Import trực tiếp từ file module, hoặc thêm "sideEffects": false vào package.json để bật tree-shaking mạnh.' },
        ),
      );
    }
  }

  // 3) sideEffects flag
  if (pkgJson.sideEffects === undefined && stack.bundler !== 'next') {
    findings.push(
      makeFinding('bundle', 'bundle-config', 'package.json thiếu field "sideEffects"',
        'Không khai báo sideEffects, bundler phải giả định mọi module đều có side effect và tree-shaking kém hiệu quả với các thư viện bên trong workspace.',
        'info',
        { files: [{ path: 'package.json', snippet: '"sideEffects": false' }], fixHint: 'Thêm "sideEffects": false (nếu code không có side effect khi import) hoặc liệt kê chính xác các file có side effect.' },
      ),
    );
  }

  // 4) Cấu hình code-splitting theo bundler
  const heavyDepsPresent = Object.keys({ ...(pkgJson.dependencies as object ?? {}) }).some(
    (d) => HEAVY_FULL_IMPORT[d] || LAZY_CANDIDATES[d] || ['react', 'react-dom'].includes(d),
  );
  if (stack.bundler === 'vite') {
    const cfgPath = await findFile(projectDir, 'vite.config');
    const cfg = cfgPath ? await readTextSafe(cfgPath) : null;
    if (cfg && heavyDepsPresent && !/manualChunks/i.test(cfg)) {
      const loc = lineOf(cfg, /export\s+default|defineConfig/);
      findings.push(
        makeFinding('bundle', 'bundle-config', 'Vite config chưa cấu hình manualChunks',
          'Khi bundle vượt vài trăm KB, tách vendor (react, react-dom, thư viện UI…) ra chunk riêng giúp cache lâu dài và first load nhanh hơn đáng kể.',
          'info',
          {
            files: cfgPath ? [{ path: path.relative(projectDir, cfgPath).replace(/\\/g, '/'), line: loc?.line, snippet: loc?.snippet }] : undefined,
            fixHint: "Thêm vào vite.config: build: { rollupOptions: { output: { manualChunks: { vendor: ['react','react-dom'] } } } }",
          },
        ),
      );
    }
  } else if (stack.bundler === 'webpack') {
    const cfgPath = await findFile(projectDir, 'webpack.config');
    const cfg = cfgPath ? await readTextSafe(cfgPath) : null;
    if (cfg && heavyDepsPresent && !/splitChunks/i.test(cfg)) {
      findings.push(
        makeFinding('bundle', 'bundle-config', 'Webpack config chưa cấu hình splitChunks',
          'Thiếu splitChunks, toàn bộ vendor nằm trong chunk chính, cache bị invalidate mỗi lần deploy.',
          'info',
          { fixHint: "Thêm: optimization: { splitChunks: { chunks: 'all' } }" },
        ),
      );
    }
  } else if (stack.bundler === 'next') {
    const cfgPath = await findFile(projectDir, 'next.config');
    const cfg = cfgPath ? await readTextSafe(cfgPath) : null;
    const usesHeavyImports = imports.some((i) => LAZY_CANDIDATES[pkgOf(i.pkg) ?? ''] || pkgOf(i.pkg ?? '') === 'lodash');
    if (cfg && usesHeavyImports && !/optimizePackageImports/i.test(cfg)) {
      findings.push(
        makeFinding('bundle', 'bundle-config', 'next.config chưa bật optimizePackageImports',
          'Với các import heavy (lodash, icon library…), optimizePackageImports giúp Next.js chỉ bundle phần thực sự dùng.',
          'info',
          {
            fixHint: "Thêm vào next.config: experimental: { optimizePackageImports: ['lodash', ...] }",
          },
        ),
      );
    }
  }

  // 5) Build output thực tế (nếu có)
  findings.push(...(await measureBuildOutput(projectDir)));

  return { stack, findings };
}
