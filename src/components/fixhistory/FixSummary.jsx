import { useMemo } from 'react';
import { summarize } from './fixHistoryUtils';

function Tile({ label, value, note, tone = 'text-ink' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-body truncate">{label}</p>
      <p className={`text-[26px] font-bold leading-tight ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-body truncate">{note}</p>}
    </div>
  );
}

export default function FixSummary({ fixes }) {
  const s = useMemo(() => summarize(fixes), [fixes]);
  const pct = n => (s.total ? `${Math.round((n / s.total) * 100)}% of all fixes` : '');
  return (
    <section aria-label="Fix summary" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      <Tile label="Total fixes" value={s.total} note="Auto-Fix attempts" />
      <Tile label="Verified" value={s.verified} note={pct(s.verified)} tone="text-sage" />
      <Tile label="Failed" value={s.failed} note={pct(s.failed)} tone={s.failed ? 'text-coral' : 'text-ink'} />
      <Tile label="Awaiting approval" value={s.awaiting} note="open pull requests" tone={s.awaiting ? 'text-amber' : 'text-ink'} />
      <Tile label="Approved" value={s.approved} note="by a reviewer" />
      <Tile label="Merged" value={s.merged} note={s.closed ? `${s.closed} closed unmerged` : 'into the repo'} tone="text-sage" />
      <Tile label="Avg days to merge" value={s.avgDaysToMerge === null ? '—' : s.avgDaysToMerge.toFixed(1)} note="fix → merged" />
    </section>
  );
}
