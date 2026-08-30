'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface ScanSummary {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  target: string;
  createdAt: number;
}

const STATUS: Record<ScanSummary['status'], { label: string; className: string }> = {
  queued: { label: 'Đang chờ', className: 'border-slate-600 bg-slate-800/80 text-slate-300' },
  running: { label: 'Đang quét', className: 'animate-pulse border-sky-500/40 bg-sky-500/10 text-sky-300' },
  done: { label: 'Hoàn tất', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  error: { label: 'Lỗi', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

/** Lịch sử các lần scan (đọc từ GET /api/scans — job lưu SQLite nên còn sau khi restart). */
export function RecentScans() {
  const [scans, setScans] = useState<ScanSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/scans')
      .then((res) => res.json() as Promise<{ scans?: ScanSummary[] }>)
      .then((data) => {
        if (!cancelled) setScans(data.scans ?? []);
      })
      .catch(() => {
        // chưa có lịch sử hoặc API lỗi — ẩn khối này
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (scans.length === 0) return null;

  return (
    <section className="mt-6 w-full">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Lịch sử scan
      </h2>
      <ul className="space-y-2">
        {scans.map((s) => {
          const badge = STATUS[s.status];
          return (
            <li key={s.id}>
              <Link
                href={`/scan/${s.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 transition hover:border-sky-500/40 hover:bg-slate-900"
              >
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{s.target}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {new Date(s.createdAt).toLocaleString('vi-VN', { hour12: false })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
