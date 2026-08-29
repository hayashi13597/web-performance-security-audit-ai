import path from 'node:path';

export type EngineModule = typeof import('@wpsa/engine');

let cached: EngineModule | null = null;

/**
 * Load @wpsa/engine tại runtime (bypass webpack bundle).
 *
 * Lý do: Next.js bundle luôn workspace package được link bằng pnpm symlink
 * (bỏ qua serverExternalPackages), khiến lighthouse/playwright bị transpile sai
 * (import.meta.url -> undefined) và crash lúc import. Ngoài ra Next còn thay
 * biểu thức createRequire(...) bằng void 0 lúc build, nên phải lấy require CJS
 * thật của Node qua eval('require') — specifier nằm trong eval string thì
 * webpack không thấy và không thể bundle.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function nodeRequire(): any {
  // DIRECT eval (không (0,eval) — indirect eval chạy ở global scope và mất require):
  // trả về require CJS thật của file chunk đang chạy trên Node
  return eval('require');
}

export function loadEngine(): EngineModule {
  if (!cached) {
    try {
      cached = nodeRequire()('@wpsa/engine') as EngineModule;
    } catch {
      // fallback: createRequire từ cwd (apps/web) để resolve package
      const mod = nodeRequire()('node:module');
      const req = mod.createRequire(path.join(process.cwd(), 'package.json'));
      cached = req('@wpsa/engine') as EngineModule;
    }
  }
  return cached;
}
