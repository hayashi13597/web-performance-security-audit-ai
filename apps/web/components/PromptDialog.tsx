'use client';

import { useEffect, useRef, useState } from 'react';

export function PromptDialog({
  prompt,
  fileCount,
  includeFiles,
  busy,
  error,
  onToggleFiles,
  onClose,
}: {
  prompt: string;
  fileCount: number;
  includeFiles: boolean;
  busy: boolean;
  error: string | null;
  onToggleFiles: (include: boolean) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [prompt, busy]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // fallback cho môi trường không có Clipboard API (http không secure context)
      areaRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">📋 Prompt fix cho AI</h3>
            <p className="mt-1 text-xs text-slate-400">
              Copy prompt bên dưới rồi dán vào AI coding tool (Claude Code, Cursor, Copilot…) đang mở tại thư mục
              source của bạn — AI sẽ tự đọc code và sửa theo các finding.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Đóng">
            ✕
          </button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={includeFiles}
            disabled={busy}
            onChange={(e) => onToggleFiles(e.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          Kèm nội dung file nguồn
          {busy ? ' (đang đọc…)' : fileCount > 0 ? ` (${fileCount} file)` : ''}
          <span className="text-slate-500">— tắt nếu AI của bạn tự đọc được repo (Claude Code, Cursor…)</span>
        </label>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        <textarea
          ref={areaRef}
          readOnly
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 min-h-[38vh] flex-1 resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300 outline-none focus:border-sky-500"
        />

        <div className="mt-4 flex gap-2">
          <button
            onClick={copy}
            disabled={busy || prompt.length === 0}
            className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
          >
            {copied ? '✅ Đã copy!' : busy ? 'Đang sinh prompt…' : '📋 Copy prompt'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
