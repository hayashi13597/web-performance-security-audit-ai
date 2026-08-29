import type { Finding } from '../types.js';
import { interactLikeUser, launchSession } from './runtime.js';

export interface RerenderScanOptions {
  formFactor: 'mobile' | 'desktop';
  /** Số vòng tương tác kích hoạt re-render. */
  rounds?: number;
  /** Thời gian chờ "idle" cuối phiên để bắt render-loop không do input. */
  idleMs?: number;
  /** Ngưỡng số render để flag một component. */
  commitThreshold?: number;
}

export interface RerenderScanResult {
  findings: Finding[];
  /** Tên component → số lần render (top 20, để hiển thị trên UI). */
  commitCounts: Record<string, number>;
  totalCommits: number;
  isReactApp: boolean;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `rr-${Date.now().toString(36)}-${counter}`;
}

/**
 * Init script chạy TRƯỚC mọi script của trang: cài React DevTools hook shim
 * để đếm component render qua flag PerformedWork trên fiber.
 */
const RERENDER_HOOK_SCRIPT = `
(() => {
  const state = { commits: {}, totalCommits: 0, rounds: [] };
  window.__WPSA_RERENDER__ = state;

  const hook = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {});
  if (hook.__wpsaPatched) return;
  hook.__wpsaPatched = true;
  hook.renderers = hook.renderers || new Map();
  hook.supportsFiber = true;

  const origInject = hook.inject ? hook.inject.bind(hook) : null;
  hook.inject = function (internals) {
    let id;
    try { id = origInject ? origInject(internals) : undefined; } catch (e) { id = undefined; }
    if (id === undefined) id = Math.max(0, ...hook.renderers.keys()) + 1;
    hook.renderers.set(id, internals);
    return id;
  };

  const nameOf = (type) => {
    if (!type || typeof type === 'string') return null;
    let t = type;
    for (let i = 0; i < 3 && t && typeof t !== 'string'; i++) {
      if (typeof t === 'function' && t.name && t.name !== 'Unknown') return t.name;
      if (t.displayName) return String(t.displayName);
      const next = t.type || t.WrappedComponent || t.render;
      if (!next) return t.name || null;
      t = next;
    }
    return null;
  };

  const walk = (fiber) => {
    while (fiber) {
      try {
        // PerformedWork = 1: fiber thực sự re-render trong commit này
        if (fiber.flags & 1) {
          const name = nameOf(fiber.type);
          if (name) {
            state.commits[name] = (state.commits[name] || 0) + 1;
            state.totalCommits += 1;
          }
        }
      } catch (e) { /* bỏ qua fiber lỗi */ }
      if (fiber.child) walk(fiber.child);
      fiber = fiber.sibling;
    }
  };

  const prev = hook.onCommitFiberRoot ? hook.onCommitFiberRoot.bind(hook) : null;
  hook.onCommitFiberRoot = function (rendererID, root) {
    try { if (root && root.current) walk(root.current); } catch (e) { /* ignore */ }
    if (prev) return prev(rendererID, root);
  };
})();
`;

interface CommitSnapshot {
  totalCommits: number;
  commits: Record<string, number>;
}

async function readCommits(page: import('playwright').Page): Promise<CommitSnapshot> {
  return (await page.evaluate(() => {
    const s = (window as unknown as { __WPSA_RERENDER__?: CommitSnapshot }).__WPSA_RERENDER__;
    if (!s) return { totalCommits: 0, commits: {} };
    return { totalCommits: s.totalCommits, commits: { ...s.commits } };
  })) as CommitSnapshot;
}

function topCommits(commits: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(commits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

/** Đếm re-render của các React component qua một phiên tương tác script. */
export async function runRerenderScan(url: string, options: RerenderScanOptions): Promise<RerenderScanResult> {
  const rounds = options.rounds ?? 4;
  const idleMs = options.idleMs ?? 3000;
  const commitThreshold = options.commitThreshold ?? 25;

  const session = await launchSession({ formFactor: options.formFactor, initScript: RERENDER_HOOK_SCRIPT });
  const findings: Finding[] = [];
  try {
    await session.page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await session.page.waitForTimeout(1500);

    const isReactApp = await session.page.evaluate(() => {
      const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, unknown> } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      return !!hook && !!hook.renderers && hook.renderers.size > 0;
    });
    if (!isReactApp) {
      return { findings, commitCounts: {}, totalCommits: 0, isReactApp: false };
    }

    let prevTotal = (await readCommits(session.page)).totalCommits;
    let lastCommits: Record<string, number> = {};

    for (let i = 0; i < rounds; i++) {
      await interactLikeUser(session.page);
      await session.page.waitForTimeout(400);
      const snap = await readCommits(session.page);
      lastCommits = snap.commits;
      prevTotal = snap.totalCommits;
    }

    // Pha idle: không có input nào — nếu render vẫn tăng mạnh thì khả năng cao là render loop
    const idleBefore = prevTotal;
    await session.page.waitForTimeout(idleMs);
    const idleSnap = await readCommits(session.page);
    const idleGrowth = idleSnap.totalCommits - idleBefore;
    lastCommits = idleSnap.commits;

    const top = topCommits(lastCommits, 20);
    const offenders = Object.entries(lastCommits)
      .filter(([, c]) => c > commitThreshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [name, count] of offenders) {
      findings.push({
        id: nextId(),
        category: 'rerender',
        detector: 'rerender-probe',
        title: `Component <${name}> render ${count} lần trong phiên test`,
        detail: `Trong ${rounds} vòng tương tác giả lập, <${name}> bị render ${count} lần — vượt ngưỡng ${commitThreshold}. Nguyên nhân thường gặp: props mới tạo mỗi lần cha render (object/array/arrow function inline), state không cần thiết đặt ở tầng cao, hoặc selector context/redux trả về tham chiếu mới.`,
        severity: count > commitThreshold * 3 ? 'critical' : 'warning',
        metrics: { component: name, renders: count, rounds },
        fixHint: 'Bọc component bằng React.memo, ổn định tham chiếu props bằng useMemo/useCallback, hoặc đẩy state xuống sát nơi dùng.',
        aiFixable: true,
      });
    }

    if (idleGrowth > 8) {
      const idleTop = Object.entries(topCommits(lastCommits, 20))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([n, c]) => `<${n}> (${c})`)
        .join(', ');
      findings.push({
        id: nextId(),
        category: 'rerender',
        detector: 'rerender-probe',
        title: `Render loop nghiêm trọng: +${idleGrowth} render khi trang idle`,
        detail: `Trong ${idleMs / 1000}s không có bất kỳ tương tác nào, app vẫn render liên tục (${idleTop}…). Đây là dấu hiệu kinh điển của setState chạy trong useEffect không có deps, hoặc subscribe tạo mới mỗi render.`,
        severity: 'critical',
        metrics: { idleGrowth, idleSeconds: idleMs / 1000 },
        fixHint: 'Kiểm tra useEffect thiếu mảng deps [] hoặc setState gọi vô điều kiện trong effect; thêm deps đúng hoặc dời logic sang event handler.',
        aiFixable: true,
      });
    }

    return { findings, commitCounts: top, totalCommits: idleSnap.totalCommits, isReactApp: true };
  } finally {
    await session.close();
  }
}
