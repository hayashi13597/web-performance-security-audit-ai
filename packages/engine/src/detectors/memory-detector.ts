import type { Finding } from '../types.js';
import { interactLikeUser, launchSession } from './runtime.js';

export interface MemoryScanOptions {
  formFactor: 'mobile' | 'desktop';
  /** Số vòng tương tác giữa các lần đo (mặc định 3). */
  rounds?: number;
  /** Ngưỡng tăng listener còn giữ lại sau GC để coi là leak. */
  listenerGrowthThreshold?: number;
  /** Ngưỡng tăng DOM node còn giữ lại sau GC. */
  nodeGrowthThreshold?: number;
}

export interface MemorySample {
  label: string;
  nodes: number;
  listeners: number;
  documents: number;
  heapMb: number;
}

export interface MemoryScanResult {
  findings: Finding[];
  samples: MemorySample[];
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `mem-${Date.now().toString(36)}-${counter}`;
}

const TRACKED_METRICS = new Set(['Nodes', 'JSEventListeners', 'Documents', 'JSHeapUsedSize']);

type MetricMap = Record<string, number>;

async function readMetrics(cdp: import('playwright').CDPSession): Promise<MetricMap> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const out: MetricMap = {};
  for (const m of metrics) {
    if (TRACKED_METRICS.has(m.name)) out[m.name] = m.value;
  }
  return out;
}

async function forceGc(cdp: import('playwright').CDPSession): Promise<void> {
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
  } catch {
    // GC bị từ chối thì vẫn dùng số liệu thô
  }
}

function toSample(label: string, m: MetricMap): MemorySample {
  return {
    label,
    nodes: Math.round(m['Nodes'] ?? 0),
    listeners: Math.round(m['JSEventListeners'] ?? 0),
    documents: Math.round(m['Documents'] ?? 0),
    heapMb: Math.round(((m['JSHeapUsedSize'] ?? 0) / 1024 / 1024) * 10) / 10,
  };
}

/** Kiểm tra trend đơn điệu tăng (≥ n/total mẫu tăng liên tục). */
function monotonicGrowth(values: number[], tolerance = 0): boolean {
  let increases = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1] + tolerance) increases += 1;
  }
  return increases >= values.length - 1;
}

/** Phát hiện memory leak bằng cách đo CDP metrics sau mỗi vòng tương tác + force GC. */
export async function runMemoryScan(url: string, options: MemoryScanOptions): Promise<MemoryScanResult> {
  const rounds = options.rounds ?? 3;
  const listenerThreshold = options.listenerGrowthThreshold ?? 25;
  const nodeThreshold = options.nodeGrowthThreshold ?? 150;

  const session = await launchSession({ formFactor: options.formFactor });
  const findings: Finding[] = [];
  const samples: MemorySample[] = [];
  try {
    await session.cdp.send('Performance.enable');
    await session.page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await session.page.waitForTimeout(1500);
    await forceGc(session.cdp);

    const baseline = await readMetrics(session.cdp);
    samples.push(toSample('baseline (sau GC)', baseline));

    const trend: Record<string, number[]> = {
      Nodes: [baseline['Nodes'] ?? 0],
      JSEventListeners: [baseline['JSEventListeners'] ?? 0],
      Documents: [baseline['Documents'] ?? 0],
      JSHeapUsedSize: [baseline['JSHeapUsedSize'] ?? 0],
    };

    for (let i = 1; i <= rounds; i++) {
      await interactLikeUser(session.page);
      await forceGc(session.cdp);
      const m = await readMetrics(session.cdp);
      samples.push(toSample(`vòng ${i} (sau GC)`, m));
      for (const key of Object.keys(trend)) trend[key].push(m[key] ?? 0);
    }

    const nodesGrowth = (trend.Nodes.at(-1) ?? 0) - (baseline['Nodes'] ?? 0);
    const listenersGrowth = (trend.JSEventListeners.at(-1) ?? 0) - (baseline['JSEventListeners'] ?? 0);
    const docsGrowth = (trend.Documents.at(-1) ?? 0) - (baseline['Documents'] ?? 0);
    const heapGrowthMb = ((trend.JSHeapUsedSize.at(-1) ?? 0) - (baseline['JSHeapUsedSize'] ?? 0)) / 1024 / 1024;

    const nodesLeaky = nodesGrowth > nodeThreshold;
    const listenersLeaky = listenersGrowth > listenerThreshold;
    const docsLeaky = docsGrowth > 2;
    const heapLeaky = heapGrowthMb > 5;

    if (nodesLeaky || listenersLeaky || docsLeaky || heapLeaky) {
      const causes: string[] = [];
      if (listenersLeaky) {
        causes.push(
          `+${listenersGrowth} event listener còn giữ lại sau GC — khả năng cao addEventListener trong effect/handler mà không removeEventListener khi unmount.`,
        );
      }
      if (nodesLeaky) {
        causes.push(
          `+${nodesGrowth} DOM node còn giữ lại sau GC — DOM bị tháo khỏi document nhưng vẫn được JS giữ tham chiếu (detached DOM).`,
        );
      }
      if (docsLeaky) causes.push(`+${docsGrowth} document chưa giải phóng (iframe/window leaked).`);
      if (heapLeaky) causes.push(`Heap tăng ${heapGrowthMb.toFixed(1)}MB sau GC — dữ liệu được giữ tham chiếu vô hạn (cache/mảng push không prune).`);

      const trendText = samples
        .map((s) => `${s.label}: nodes=${s.nodes}, listeners=${s.listeners}, heap=${s.heapMb}MB`)
        .join('; ');

      findings.push({
        id: nextId(),
        category: 'memory',
        detector: 'memory-probe',
        title: 'Nghi vấn rò rỉ bộ nhớ sau khi force GC',
        detail: `Sau ${rounds} vòng tương tác, số liệu vẫn tăng đơn điệu dù garbage collector đã chạy đầy đủ. ${causes.join(' ')}. Diễn biến theo vòng: ${trendText}.`,
        severity: listenersGrowth > listenerThreshold * 3 || nodesGrowth > nodeThreshold * 3 ? 'critical' : 'warning',
        metrics: {
          nodesGrowth,
          listenersGrowth,
          documentsGrowth: docsGrowth,
          heapGrowthMb: Math.round(heapGrowthMb * 10) / 10,
          rounds,
        },
        fixHint: 'Gỡ listener trong cleanup của useEffect, huỷ timer/subscription khi unmount, không push vào mảng/cache toàn cục không giới hạn.',
        aiFixable: true,
      });
    }

    return { findings, samples };
  } finally {
    await session.close();
  }
}
