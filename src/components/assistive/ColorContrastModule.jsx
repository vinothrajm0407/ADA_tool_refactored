import { CheckCircle } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colorHex(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (s.startsWith('#') && (s.length === 4 || s.length === 7)) return s;
  const m = s.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

// ─── Stat item ────────────────────────────────────────────────────────────────

function StatItem({ label, value, sub, color = 'default' }) {
  const colors = { sage: 'text-sage', coral: 'text-coral', amber: 'text-amber', teal: 'text-teal', default: 'text-ink dark:text-white' };
  return (
    <div className="text-center">
      <p className={`font-heading font-bold text-2xl ${colors[color]}`}>{value ?? '—'}</p>
      <p className="text-xs text-body dark:text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-body dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Violation row ────────────────────────────────────────────────────────────

function ViolationRow({ item }) {
  const current = item.ratio?.current;
  const required = item.ratio?.required ?? 4.5;
  const passes = typeof current === 'number' ? current >= required : false;
  const displayRatio = typeof current === 'number' ? `${current.toFixed(2)}:1` : '—';

  const fg = colorHex(item.fgColor);
  const bg = colorHex(item.bgColor);
  const hasColors = fg && bg;

  return (
    <div className="py-4 border-b border-gray-50 dark:border-white/[0.04] last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-body dark:text-gray-400 truncate mb-1.5" title={item.target}>
            {item.target}
          </p>

          {/* Color swatches */}
          {hasColors && (
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-4 h-4 rounded border border-black/10 dark:border-white/10 shrink-0"
                  style={{ backgroundColor: fg }}
                  title={`Text: ${fg}`}
                />
                <span className="text-[10px] font-mono text-body dark:text-gray-500">{fg}</span>
              </div>
              <span className="text-[10px] text-body dark:text-gray-500">on</span>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-4 h-4 rounded border border-black/10 dark:border-white/10 shrink-0"
                  style={{ backgroundColor: bg }}
                  title={`Background: ${bg}`}
                />
                <span className="text-[10px] font-mono text-body dark:text-gray-500">{bg}</span>
              </div>
              {/* Live preview */}
              <span
                className="ml-1 text-[11px] font-medium px-2 py-0.5 rounded"
                style={{ color: fg, backgroundColor: bg }}
              >
                Aa
              </span>
            </div>
          )}

          {item.count > 1 && (
            <span className="text-[10px] bg-amber/10 text-amber px-1.5 py-0.5 rounded-md font-medium">
              {item.count} occurrences
            </span>
          )}
          {item.summary && (
            <p className="text-xs text-body dark:text-gray-500 mt-1 line-clamp-2">{item.summary}</p>
          )}
        </div>

        <div className="text-right shrink-0 ml-2">
          <p className={`font-heading font-bold text-lg leading-tight ${passes ? 'text-sage' : 'text-coral'}`}>
            {displayRatio}
          </p>
          <p className="text-[10px] text-body dark:text-gray-500">needs {required}:1</p>
          <span className={`mt-1 inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            passes ? 'bg-sage/10 text-sage' : 'bg-coral/10 text-coral'
          }`}>
            {passes ? 'AA Pass' : 'AA Fail'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ColorContrastModule({ result }) {
  const raw = result?.metadata ?? result;

  const passed  = raw?.passed ?? false;
  const overview = raw?.ratioOverview ?? {};
  const items    = raw?.groupedTargets ?? raw?.affectedSamples ?? [];
  const total    = raw?.totalAffectedElements ?? items.length;
  const rules    = raw?.totalContrastRules ?? 0;

  if (passed || (rules === 0 && items.length === 0)) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3">
        <CheckCircle className="w-10 h-10 text-sage" />
        <p className="font-heading font-bold text-base text-ink dark:text-white">
          No contrast violations found
        </p>
        <p className="text-sm text-body dark:text-gray-400 text-center max-w-sm">
          All text elements on this page meet WCAG 2.2 AA contrast requirements (4.5:1 minimum).
        </p>
      </div>
    );
  }

  const lowestRatio = overview.lowestFound;
  const avgRatio    = overview.averageFound;

  return (
    <div className="space-y-4">

      {/* Summary */}
      <div className="card p-6">
        <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-4">
          Color Contrast Summary
        </h3>
        <div className="flex gap-8 flex-wrap">
          <StatItem
            label="Violations"
            value={rules}
            color={rules > 0 ? 'coral' : 'sage'}
          />
          <StatItem
            label="Affected Elements"
            value={total}
            color={total > 0 ? 'amber' : 'sage'}
          />
          <StatItem
            label="Lowest Ratio"
            value={lowestRatio != null ? `${lowestRatio}:1` : '—'}
            sub={`Required: ${overview.requiredAA ?? 4.5}:1`}
            color={lowestRatio != null && lowestRatio < (overview.requiredAA ?? 4.5) ? 'coral' : 'teal'}
          />
          <StatItem
            label="Avg Ratio"
            value={avgRatio != null ? `${avgRatio}:1` : '—'}
          />
        </div>
      </div>

      {/* Violations list */}
      {items.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-heading font-bold text-base text-ink dark:text-white">
              Failing Elements
            </h3>
            <span className="bg-coral/10 text-coral text-xs font-semibold px-2.5 py-0.5 rounded-full">
              {items.length} unique selector{items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-body dark:text-gray-500 mb-3">
            Sorted by number of occurrences
          </p>
          <div>
            {items.map((item, i) => (
              <ViolationRow key={i} item={item} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
