'use client';

import type { CWVMetrics } from '@wpsa/engine';

interface MetricDef {
  key: keyof CWVMetrics;
  label: string;
  good: number;
  poor: number;
  format: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: 'lcp', label: 'LCP', good: 2500, poor: 4000, format: (v) => `${(v / 1000).toFixed(2)}s` },
  { key: 'cls', label: 'CLS', good: 0.1, poor: 0.25, format: (v) => v.toFixed(3) },
  { key: 'tbt', label: 'TBT', good: 200, poor: 600, format: (v) => `${Math.round(v)}ms` },
  { key: 'fcp', label: 'FCP', good: 1800, poor: 3000, format: (v) => `${(v / 1000).toFixed(2)}s` },
  { key: 'ttfb', label: 'TTFB', good: 800, poor: 1800, format: (v) => `${Math.round(v)}ms` },
  { key: 'speedIndex', label: 'Speed Index', good: 3400, poor: 5800, format: (v) => `${(v / 1000).toFixed(1)}s` },
];

function level(value: number, def: MetricDef): 'good' | 'avg' | 'poor' {
  if (value <= def.good) return 'good';
  if (value <= def.poor) return 'avg';
  return 'poor';
}

const LEVEL_STYLE = {
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  avg: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  poor: 'border-red-500/40 bg-red-500/10 text-red-300',
} as const;

const LEVEL_TEXT = { good: 'Tốt', avg: 'Trung bình', poor: 'Kém' } as const;

export function ScoreGauge({ label, score }: { label: string; score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = clamped >= 90 ? '#34d399' : clamped >= 50 ? '#fbbf24' : '#f87171';
  const circumference = 2 * Math.PI * 26;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r="26" fill="none" stroke="#1e293b" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r="26"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className="-mt-[52px] mb-[26px] text-center">
        <span className="text-lg font-bold text-white">{clamped}</span>
      </div>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

export function CWVCards({ cwv }: { cwv: CWVMetrics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {METRICS.map((def) => {
        const value = cwv[def.key];
        if (value === undefined || value === null) {
          return (
            <div key={def.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 opacity-40">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-400">{def.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-500">—</div>
            </div>
          );
        }
        const lv = level(value, def);
        return (
          <div key={def.key} className={`rounded-xl border p-4 ${LEVEL_STYLE[lv]}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold">{def.label}</span>
              <span className="text-[10px] uppercase tracking-wide opacity-75">{LEVEL_TEXT[lv]}</span>
            </div>
            <div className="mt-1 text-2xl font-bold">{def.format(value)}</div>
          </div>
        );
      })}
    </div>
  );
}
