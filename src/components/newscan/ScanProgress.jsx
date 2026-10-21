import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Indicative stages only — the backend reports no progress, so these advance by elapsed time.
const STAGES = [
  { label: 'Loading your page', until: 8 },
  { label: 'Running WCAG checks', until: 60 },
  { label: 'Building your report', until: Infinity },
];

export default function ScanProgress({ url, bare = false }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const current = STAGES.findIndex(s => elapsed < s.until);

  const inner = (
    <div className="p-8 flex flex-col items-center gap-6" role="status" aria-live="polite">
      <div className="scan-page" aria-hidden="true">
        <div className="bar dark" />
        <div className="bar" style={{ width: '90%' }} />
        <div className="row"><div className="block" /><div className="block" /><div className="block" /></div>
        <div className="bar" style={{ width: '75%' }} />
        <div className="bar" style={{ width: '40%' }} />
        <span className="flag" style={{ top: 58, left: 62, animationDelay: '0.5s' }} />
        <span className="flag" style={{ top: 92, left: 150, animationDelay: '1.2s' }} />
        <span className="flag" style={{ top: 30, left: 120, animationDelay: '0.1s' }} />
      </div>

      <div className="text-center">
        <p className="font-heading font-semibold text-ink text-xl m-0">Auditing your page</p>
        {url && (
          <p className="inline-block text-sm text-teal-800 bg-teal/10 rounded-full px-4 py-1 mt-3 mb-0 font-mono break-all max-w-lg">{url}</p>
        )}
      </div>

      <ol className="w-full max-w-xs space-y-3 list-none p-0 m-0">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className={`flex items-center gap-3 text-sm ${done || active ? 'text-ink' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-teal text-white' : active ? 'bg-teal/10 text-teal' : 'bg-gray-100'}`}>
                {done ? <Check size={13} strokeWidth={3} /> : active ? <Loader2 size={13} className="animate-spin" /> : null}
              </span>
              <span className={active ? 'font-semibold' : ''}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-body m-0 tabular-nums">Usually 1–2 minutes · Elapsed {fmt(elapsed)}</p>
    </div>
  );

  if (bare) return inner;

  return (
    <div className="bg-white rounded-2xl border border-gray-100">
      {inner}
    </div>
  );
}
