import { X, ArrowRight, Minus } from 'lucide-react';
import { nsComputeScore, nsScoreGradeInfo, nsBuildSeverityBreakdown } from './scanUtils';

function buildRuleMap(violations) {
  const map = {};
  for (const v of violations) {
    const id = v.id || 'unknown';
    if (!map[id]) map[id] = { id, title: v.help || v.description || id, count: 0 };
    map[id].count += (v.nodes?.length ?? 1);
  }
  return map;
}

function DeltaBadge({ value, goodDirection = 'down' }) {
  if (value === 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400"><Minus size={11} />no change</span>;
  }
  const improved = goodDirection === 'down' ? value < 0 : value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${improved ? 'bg-sage/10 text-sage' : 'bg-coral/10 text-coral'}`}>
      {value > 0 ? '+' : ''}{value}
    </span>
  );
}

function ScanSummaryCard({ label, session }) {
  const violations = session.result?.axeResult?.violations ?? [];
  const score = nsComputeScore(violations);
  const grade = nsScoreGradeInfo(score);
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-widest text-body mb-1">{label}</p>
      <p className="text-sm font-mono text-ink truncate"title={session.url}>{session.url}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-2xl font-heading font-bold ${grade.dialCls.split(' ')[0]}`}>{score}</span>
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${grade.badgeCls}`}>{grade.grade}</span>
      </div>
    </div>
  );
}

function labelFor(session) {
  if (session.name) return session.name;
  try {
    const u = new URL(session.url);
    const segment = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
    return segment || u.hostname || session.url;
  } catch { return session.url; }
}

export default function ScanComparisonView({ sessions, sessionA, sessionB, onChangeA, onChangeB, onClose }) {
  const violationsA = sessionA.result?.axeResult?.violations ?? [];
  const violationsB = sessionB.result?.axeResult?.violations ?? [];
  const passesA = sessionA.result?.axeResult?.passes ?? [];
  const passesB = sessionB.result?.axeResult?.passes ?? [];

  const scoreA = nsComputeScore(violationsA);
  const scoreB = nsComputeScore(violationsB);
  const sevA = nsBuildSeverityBreakdown(violationsA);
  const sevB = nsBuildSeverityBreakdown(violationsB);

  const mapA = buildRuleMap(violationsA);
  const mapB = buildRuleMap(violationsB);
  const allIds = Array.from(new Set([...Object.keys(mapA), ...Object.keys(mapB)]));

  const rows = allIds.map(id => {
    const a = mapA[id];
    const b = mapB[id];
    const status = a && !b ? 'onlyA' : b && !a ? 'onlyB' : 'both';
    return { id, title: (a ?? b).title, countA: a?.count ?? 0, countB: b?.count ?? 0, status };
  }).sort((x, y) => {
    const rank = { onlyA: 0, onlyB: 0, both: 1 };
    if (rank[x.status] !== rank[y.status]) return rank[x.status] - rank[y.status];
    return Math.max(y.countA, y.countB) - Math.max(x.countA, x.countB);
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <p className="font-heading font-bold text-lg text-ink">Compare Scans</p>
        <button type="button"onClick={onClose} className="text-gray-400 hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div className="flex items-center gap-3 px-5 pt-4">
        <select value={sessionA.id} onChange={(e) => onChangeA(e.target.value)}
          className="flex-1 text-[13px] font-medium bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-ink">
          {sessions.map(s => <option key={s.id} value={s.id}>{labelFor(s)}</option>)}
        </select>
        <ArrowRight size={14} className="text-gray-300 flex-shrink-0"/>
        <select value={sessionB.id} onChange={(e) => onChangeB(e.target.value)}
          className="flex-1 text-[13px] font-medium bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-ink">
          {sessions.map(s => <option key={s.id} value={s.id}>{labelFor(s)}</option>)}
        </select>
      </div>

      <div className="flex items-stretch gap-4 px-5 py-5 border-b border-gray-100">
        <ScanSummaryCard label="Scan A" session={sessionA} />
        <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0 px-2">
          <ArrowRight size={16} className="text-gray-300"/>
          <DeltaBadge value={scoreB - scoreA} goodDirection="up" />
        </div>
        <ScanSummaryCard label="Scan B" session={sessionB} />
      </div>

      <div className="grid grid-cols-3 gap-3 px-5 py-4 border-b border-gray-100">
        {[
          { label: 'Violations', a: violationsA.length, b: violationsB.length, good: 'down' },
          { label: 'Passes', a: passesA.length, b: passesB.length, good: 'up' },
        ].map(row => (
          <div key={row.label} className="col-span-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-body mb-1">{row.label}</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-ink">{row.a}</span>
              <ArrowRight size={12} className="text-gray-300" />
              <span className="text-sm font-mono text-ink">{row.b}</span>
              <DeltaBadge value={row.b - row.a} goodDirection={row.good} />
            </div>
          </div>
        ))}
        <div className="col-span-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-body mb-1">Critical + Serious</p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-ink">{sevA.critical + sevA.serious}</span>
            <ArrowRight size={12} className="text-gray-300" />
            <span className="text-sm font-mono text-ink">{sevB.critical + sevB.serious}</span>
            <DeltaBadge value={(sevB.critical + sevB.serious) - (sevA.critical + sevA.serious)} goodDirection="down" />
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-body mb-3">
          Rule-by-rule difference ({rows.length})
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-body">No violations in either scan.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink truncate">{r.title}</p>
                  <p className="text-[11px] font-mono text-body">{r.id}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-mono text-body w-14 text-right">A: {r.countA}</span>
                  <span className="text-[11px] font-mono text-body w-14 text-right">B: {r.countB}</span>
                  {r.status === 'onlyA' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber/10 text-amber whitespace-nowrap">Only in A</span>}
                  {r.status === 'onlyB' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber/10 text-amber whitespace-nowrap">Only in B</span>}
                  {r.status ==='both'&& <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 whitespace-nowrap">In both</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
