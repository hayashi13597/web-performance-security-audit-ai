'use client';

import { useState } from 'react';
import type { Finding } from '@wpsa/engine';

const SEVERITY_BADGE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
} as const;

const SEVERITY_LABEL = { critical: 'Nghiêm trọng', warning: 'Cảnh báo', info: 'Gợi ý' } as const;

export function FindingCard({
  finding,
  selected,
  onToggle,
  disabled = false,
}: {
  finding: Finding;
  selected: boolean;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const metrics = Object.entries(finding.metrics ?? {});

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-700">
      <div className="flex items-start gap-3 p-4">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={() => onToggle(finding.id)}
          title="Đưa vào prompt / PR sửa lỗi"
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-sky-500"
        />
        <button onClick={() => setOpen(!open)} className="flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE[finding.severity]}`}>
              {SEVERITY_LABEL[finding.severity]}
            </span>
            <span className="text-sm font-medium text-slate-100">{finding.title}</span>
          </div>
          {!open && finding.detail && (
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{finding.detail}</p>
          )}
        </button>
        <button onClick={() => setOpen(!open)} className="mt-0.5 text-xs text-slate-500 hover:text-slate-300">
          {open ? '▲' : '▼'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-800 px-4 py-3 text-sm">
          <p className="leading-relaxed text-slate-300">{finding.detail}</p>

          {metrics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {metrics.map(([k, v]) => (
                <span key={k} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  {k}: <span className="font-semibold text-white">{String(v)}</span>
                </span>
              ))}
            </div>
          )}

          {finding.files && finding.files.length > 0 && (
            <div className="mt-3 space-y-1">
              {finding.files.map((f) => (
                <div key={f.path} className="rounded-md bg-slate-950/80 px-3 py-1.5 font-mono text-xs text-slate-400">
                  {f.path}
                  {f.line ? `:${f.line}` : ''}
                </div>
              ))}
            </div>
          )}

          {finding.impact && (
            <p className="mt-3 text-xs text-emerald-300">💡 Tác động: {finding.impact}</p>
          )}

          {finding.fixHint && (
            <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
              <p className="text-xs font-semibold text-sky-300">Gợi ý fix</p>
              <p className="mt-0.5 text-xs text-slate-300">{finding.fixHint}</p>
            </div>
          )}

          <p className="mt-3 text-[10px] text-slate-600">Detector: {finding.detector}</p>
        </div>
      )}
    </div>
  );
}
