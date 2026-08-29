'use client';

import type { ScanStage, StageState } from '@wpsa/engine';

const STAGE_LABELS: Record<ScanStage, string> = {
  'fetch-source': 'Tải source repo',
  bundle: 'Phân tích bundle (tĩnh)',
  security: 'Security headers + SEO',
  lighthouse: 'Lighthouse (CWV + hiệu năng)',
  rerender: 'Probe re-render (React)',
  memory: 'Probe memory leak (CDP)',
  done: 'Hoàn tất',
};

const ORDER: ScanStage[] = ['fetch-source', 'bundle', 'security', 'lighthouse', 'rerender', 'memory', 'done'];

const ICONS = {
  pending: '○',
  running: '◐',
  done: '●',
  error: '✕',
  skipped: '−',
} as const;

const STYLES = {
  pending: 'text-slate-600',
  running: 'text-sky-400 animate-pulse',
  done: 'text-emerald-400',
  error: 'text-red-400',
  skipped: 'text-slate-500',
} as const;

export function ScanProgress({ stages }: { stages: Partial<Record<ScanStage, StageState>> }) {
  const visible = ORDER.filter((s) => s !== 'done' && stages[s] !== undefined);
  return (
    <ul className="space-y-2.5">
      {visible.map((stage) => {
        const state = stages[stage]!;
        return (
          <li key={stage} className="flex items-start gap-3 text-sm">
            <span className={`mt-0.5 text-base ${STYLES[state.status]}`}>{ICONS[state.status]}</span>
            <div>
              <span className={state.status === 'pending' ? 'text-slate-500' : 'text-slate-200'}>
                {STAGE_LABELS[stage]}
              </span>
              {state.message && (
                <span className="block text-xs text-slate-500">
                  {state.status === 'error' ? `Lỗi: ${state.message}` : state.message}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
