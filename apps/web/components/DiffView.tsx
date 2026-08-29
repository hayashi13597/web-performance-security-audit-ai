'use client';

export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed">
      <code>
        {lines.map((line, i) => {
          let cls = 'text-slate-500';
          if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-emerald-500/10 text-emerald-300';
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-red-500/10 text-red-300';
          else if (line.startsWith('@@')) cls = 'text-sky-400';
          else if (line.startsWith('---') || line.startsWith('+++')) cls = 'text-slate-400 font-semibold';
          return (
            <div key={i} className={`px-1 ${cls}`}>
              {line || ' '}
            </div>
          );
        })}
      </code>
    </pre>
  );
}
