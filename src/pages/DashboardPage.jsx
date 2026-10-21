import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import {
  AlertCircle, AlertTriangle, FileText, Wrench, ScanLine, History, ArrowRight,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { formatUrl, formatShortDate } from '../utils/format';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useApp } from '../context/AppContext';
import ScoreRing from '../components/ui/ScoreRing';

const SEVERITIES = [
  { key: 'critical', label: 'Critical', hint: 'Blocks users — fix first', bar: 'bg-coral' },
  { key: 'serious',  label: 'Serious',  hint: 'Major barrier',            bar: 'bg-amber' },
  { key: 'moderate', label: 'Moderate', hint: 'Causes difficulty',        bar: 'bg-brand-blue' },
  { key: 'minor',    label: 'Minor',    hint: 'Small annoyance',          bar: 'bg-gray-400' },
];

// Plain-English names for the most common axe rule ids; anything else is prettified.
const RULE_NAMES = {
  'color-contrast': 'Text is hard to read (low contrast)',
  'image-alt': 'Images missing alt text',
  'label': 'Form fields without labels',
  'button-name': 'Buttons without a name',
  'link-name': 'Links without a name',
  'input-button-name': 'Input buttons without a name',
  'document-title': 'Page has no title',
  'html-has-lang': 'Page language not set',
  'frame-title': 'Frames without a title',
  'target-size': 'Click targets too small',
  'aria-hidden-focus': 'Hidden content can still be focused',
  'duplicate-id': 'Duplicate element IDs',
  'heading-order': 'Headings skip levels',
  'landmark-one-main': 'Page missing a main area',
  'region': 'Content outside page landmarks',
};
const ruleName = (id) => RULE_NAMES[id]
  ?? (id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '));

const WCAG_NAMES = {
  wcag2a: 'WCAG 2.0 · Level A', wcag2aa: 'WCAG 2.0 · Level AA',
  wcag21a: 'WCAG 2.1 · Level A', wcag21aa: 'WCAG 2.1 · Level AA',
  wcag22aa: 'WCAG 2.2 · Level AA',
};
const wcagName = (tag) => {
  if (WCAG_NAMES[tag]) return WCAG_NAMES[tag];
  const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
  return m ? `Criterion ${m[1]}.${m[2]}.${m[3]}` : tag;
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const scoreVerdict = (s) => (s == null
  ? { label: 'No scans yet', text: 'Run your first audit to see your score.' }
  : s >= 80 ? { label: 'Good', text: 'Most checks pass. Keep an eye on new pages.' }
  : s >= 65 ? { label: 'Fair', text: 'Some real barriers remain — start with critical issues.' }
  : { label: 'Needs work', text: 'Many checks fail. Fix critical issues first.' });

const TREND_RANGES = [
  { days: 15, label: 'Last 15 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 45, label: 'Last 45 days' },
  { days: 90, label: 'Last 90 days' },
];

const TREND_METRICS = {
  total_violations: { label: 'Total issues', color: '#1a7a6a' },
  critical:          { label: 'Critical',    color: '#dc2626' },
  serious:           { label: 'Serious',     color: '#ea580c' },
  moderate:          { label: 'Moderate',    color: '#2563eb' },
  minor:             { label: 'Minor',       color: '#6b7280' },
};

/* ─── page ─── */
export default function DashboardPage() {
  const { navigate, user } = useApp();
  const [historyItems, setHistoryItems] = useState([]);
  const [trendData, setTrendData]       = useState([]);
  const [trendSummary, setTrendSummary] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [trendAvail, setTrendAvail]     = useState(true);
  const [severityBreakdown, setSeverityBreakdown] = useState(null);
  const [wcagBreakdown, setWcagBreakdown] = useState(null);
  const [topIssueTypes, setTopIssueTypes] = useState([]);
  const [intelLoading, setIntelLoading] = useState(true);
  const [fixesApplied, setFixesApplied] = useState(0);
  const [trendDays, setTrendDays] = useState(30);
  const [trendLoading, setTrendLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const fallback = { ok: false };
        const safeJson = (res) => res.json().catch(() => fallback);
        const histJson = await apiFetch('/api/history').then(safeJson).catch(() => fallback);
        if (histJson.ok && Array.isArray(histJson.items)) {
          setHistoryItems(histJson.items);
        }
      } catch {
        // network failure — all states remain at empty defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrendLoading(true);
      try {
        const fallback = { ok: false };
        const trendJson = await apiFetch(`/api/trends?days=${trendDays}`).then(res => res.json()).catch(() => fallback);
        if (cancelled) return;
        if (trendJson.ok && trendJson.available && Array.isArray(trendJson.data)) {
          setTrendData(trendJson.data);
          setTrendSummary(trendJson.summary ?? null);
          setTrendAvail(true);
        } else {
          setTrendData([]);
          setTrendAvail(false);
        }
      } catch {
        if (!cancelled) setTrendAvail(false);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trendDays]);

  useEffect(() => {
    (async () => {
      setIntelLoading(true);
      try {
        const res  = await apiFetch('/api/violations/summary?limit=25');
        const json = await res.json().catch(() => ({ ok: false }));
        if (json.ok && json.available) {
          setSeverityBreakdown(json.severity_breakdown ?? null);
          setWcagBreakdown(json.wcag_breakdown ?? null);
          setTopIssueTypes(Array.isArray(json.top_issue_types) ? json.top_issue_types.slice(0, 6) : []);
        }
      } catch {
        // leave at defaults
      } finally {
        setIntelLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/fixes?limit=200')
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.ok || !Array.isArray(data.fixes)) return;
        setFixesApplied(data.fixes.filter(f => f.merged).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* ── base metrics ── */
  const totalScans      = historyItems.length;

  const avgPassRate = trendSummary?.avg_pass_rate != null
    ? Math.round(trendSummary.avg_pass_rate)
    : historyItems.length > 0
      ? Math.round(historyItems.reduce((s, i) => s + (i.passRate ?? 0), 0) / historyItems.length)
      : null;

  const recentAudits = [...historyItems]
    .sort((a, b) => new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0))
    .slice(0, 5);


  const getStatusValue = (item) => (item.passRate ?? 0) >= 70 ? 'Passed' : 'Needs review';

  /* ── derived display values ── */
  const verdict = scoreVerdict(avgPassRate);
  const lastTwo = recentAudits.slice(0, 2).map(i => i.passRate);
  const delta = lastTwo.length === 2 && lastTwo[0] != null && lastTwo[1] != null ? lastTwo[0] - lastTwo[1] : null;
  const sev = severityBreakdown ?? {};
  const sevTotal = SEVERITIES.reduce((s, { key }) => s + (sev[key] ?? 0), 0);
  const urgent = (sev.critical ?? 0) + (sev.serious ?? 0);
  const maxRule = Math.max(1, ...topIssueTypes.map(t => t.count));
  const maxWcag = Math.max(1, ...(wcagBreakdown ?? []).slice(0, 6).map(t => t.count));

  const STAT_CARDS = [
    {
      label: 'Critical issues', icon: AlertCircle, tone: 'bg-coral/10 text-coral-700',
      value: sev.critical ?? 0, sub: (sev.critical ?? 0) > 0 ? 'Fix these first' : 'None found — great', loading: intelLoading, page: 'scan-history',
    },
    {
      label: 'Serious issues', icon: AlertTriangle, tone: 'bg-amber/10 text-amber-800',
      value: sev.serious ?? 0, sub: (sev.serious ?? 0) > 0 ? 'Address soon' : 'None found — great', loading: intelLoading, page: 'scan-history',
    },
    {
      label: 'Audits run', icon: FileText, tone: 'bg-brand-blue/10 text-brand-blue-700',
      value: totalScans, sub: 'View scan history', loading, page: 'scan-history',
    },
    {
      label: 'Fixes merged', icon: Wrench, tone: 'bg-sage/10 text-sage-700',
      value: fixesApplied, sub: 'Auto-Fix pull requests', loading: false, page: 'fix-history',
    },
  ];

  const trendKeys = Object.entries(TREND_METRICS).filter(([key]) => key !== 'total_violations');
  const isFirstRun = !loading && historyItems.length === 0;

  /* ─── render ─── */
  return (
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── HEADER ── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading font-bold text-2xl text-ink">
              {greeting()}{user?.firstName ? `, ${user.firstName}` : ''}
            </h1>
            <p className="text-sm text-body mt-1">Here&apos;s how accessible your websites are right now.</p>
          </div>
          <button onClick={() => navigate('new-scan')} className="btn-primary">
            <ScanLine size={15} /> Run new audit
          </button>
        </div>

        {isFirstRun && (
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-teal/10 flex items-center justify-center mx-auto mb-4">
              <ScanLine size={22} className="text-teal" />
            </div>
            <h2 className="font-heading font-semibold text-lg text-ink">Run your first audit</h2>
            <p className="text-sm text-body mt-1 mb-5 max-w-md mx-auto">
              Enter a website address and we&apos;ll check it against WCAG, then show you what to fix and how.
            </p>
            <button onClick={() => navigate('new-scan')} className="btn-primary">
              Start an audit <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* ── HERO: SCORE + SEVERITY ── */}
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-4">
          <section aria-label="Accessibility score" className="rounded-2xl p-6 text-white bg-gradient-to-br from-teal to-teal-900 shadow-glow">
            <p className="text-sm font-medium text-white/80">Accessibility score</p>
            <div className="mt-4 flex items-center gap-6 flex-wrap">
              {loading ? <div className="w-36 h-36 rounded-full bg-white/15 animate-pulse" /> : <ScoreRing value={avgPassRate} className="w-36 h-36" />}
              <div className="min-w-0 flex-1">
                <p className="font-heading text-2xl font-bold">{verdict.label}</p>
                <p className="text-sm text-white/80 mt-1">{verdict.text}</p>
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium bg-white/15 rounded-full px-3 py-1">
                  {delta == null ? <Minus size={12} /> : delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {delta == null ? 'Run another audit to see change'
                    : delta === 0 ? 'No change since last audit'
                    : `${delta > 0 ? '+' : ''}${delta} pts since last audit`}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-white/60 mt-4">Average share of accessibility checks that pass across your recent audits.</p>
          </section>

          <section aria-label="Issues by severity" className="card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-heading font-semibold text-base text-ink">Issues by severity</h2>
                <p className="text-xs text-body mt-0.5">Across your recent audits</p>
              </div>
              {!intelLoading && sevTotal > 0 && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${urgent > 0 ? 'bg-coral/10 text-coral-700' : 'bg-sage/10 text-sage-700'}`}>
                  {urgent > 0 ? `${urgent} need attention` : 'Nothing urgent'}
                </span>
              )}
            </div>
            {intelLoading ? (
              <div className="h-32 mt-5 bg-gray-50 rounded-xl animate-pulse" />
            ) : sevTotal === 0 ? (
              <p className="text-sm text-body py-10 text-center">No issues recorded yet.</p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden mt-5 bg-gray-100" role="img"
                  aria-label={SEVERITIES.map(({ key, label }) => `${label} ${sev[key] ?? 0}`).join(', ')}>
                  {SEVERITIES.map(({ key, bar }) => (sev[key] ?? 0) > 0 && (
                    <div key={key} className={bar} style={{ width: `${((sev[key] ?? 0) / sevTotal) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-5 space-y-3">
                  {SEVERITIES.map(({ key, label, hint, bar }) => (
                    <li key={key} className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full ${bar} shrink-0`} />
                      <span className="text-sm font-medium text-ink w-20">{label}</span>
                      <span className="text-xs text-body flex-1 truncate">{hint}</span>
                      <span className="text-sm font-bold text-ink tabular-nums">{sev[key] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* ── STAT CARDS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STAT_CARDS.map((s) => (
            <button
              key={s.label}
              onClick={() => navigate(s.page)}
              className="card p-4 text-left hover:shadow-soft hover:border-teal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.tone}`}>
                <s.icon size={18} />
              </div>
              {s.loading
                ? <div className="h-8 w-12 bg-gray-100 rounded animate-pulse mt-3" />
                : <p className="font-heading text-3xl font-bold text-ink mt-3 tabular-nums">{s.value}</p>}
              <p className="text-sm font-medium text-ink mt-0.5">{s.label}</p>
              <p className="text-xs text-body mt-0.5">{s.sub}</p>
            </button>
          ))}
        </div>

        {/* ── TREND + TOP ISSUES ── */}
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <section aria-label="Issue trend" className="card p-6">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div>
                <h2 className="font-heading font-semibold text-base text-ink">Issue trend</h2>
                <p className="text-xs text-body mt-0.5">Are things getting better? Lines going down is good.</p>
              </div>
              <select
                aria-label="Trend period"
                className="select-base !w-auto !py-1.5 text-xs"
                value={trendDays}
                onChange={(e) => setTrendDays(Number(e.target.value))}
              >
                {TREND_RANGES.map(({ days, label }) => <option key={days} value={days}>{label}</option>)}
              </select>
            </div>
            <div className="mt-4">
              {trendLoading ? (
                <div className="h-[220px] bg-gray-50 rounded-xl animate-pulse" />
              ) : !trendAvail || trendData.length === 0 ? (
                <div className="h-[220px] flex flex-col items-center justify-center text-center text-sm text-body">
                  <TrendingUp size={22} className="text-gray-300 mb-2" />
                  No scans in this period yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11, fill: '#6B7280' }} stroke="#e5e7eb" tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} stroke="#e5e7eb" tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,.08)' }} />
                    {trendKeys.map(([key, { label, color }]) => (
                      <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex gap-4 mt-3 flex-wrap">
              {trendKeys.map(([key, { label, color }]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-body">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                  {label}
                </span>
              ))}
            </div>
          </section>

          <section aria-label="Most common issues" className="card p-6">
            <h2 className="font-heading font-semibold text-base text-ink">Most common issues</h2>
            <p className="text-xs text-body mt-0.5 mb-4">Fixing these removes the most problems</p>
            {intelLoading ? (
              <div className="h-[220px] bg-gray-50 rounded-xl animate-pulse" />
            ) : topIssueTypes.length === 0 ? (
              <p className="text-sm text-body py-10 text-center">No issues recorded yet.</p>
            ) : (
              <ul className="space-y-3.5">
                {topIssueTypes.map(({ rule_id, count }) => (
                  <li key={rule_id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink truncate" title={rule_id}>{ruleName(rule_id)}</span>
                      <span className="font-semibold text-ink tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-teal" style={{ width: `${(count / maxRule) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── RECENT AUDITS + WCAG ── */}
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <section aria-label="Recent audits" className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-heading font-semibold text-base text-ink">Recent audits</h2>
                <p className="text-xs text-body mt-0.5">Score of 70+ counts as passed</p>
              </div>
              <button onClick={() => navigate('scan-history')} className="btn-ghost !px-3 !py-1.5 text-xs text-teal">
                View all <ArrowRight size={12} />
              </button>
            </div>
            {loading ? (
              <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}</div>
            ) : recentAudits.length === 0 ? (
              <div className="py-10 text-center">
                <History size={22} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-body">Your audits will show up here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>{['Website', 'Score', 'Issues', 'Status', 'Date'].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {recentAudits.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium max-w-[220px] truncate" title={item.url}>{formatUrl(item.url ?? '')}</td>
                        <td>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md tabular-nums ${
                            (item.passRate ?? 0) >= 80 ? 'bg-sage/15 text-sage-700'
                            : (item.passRate ?? 0) >= 65 ? 'bg-amber/15 text-amber-800'
                            : 'bg-coral/15 text-coral-700'
                          }`}>{item.passRate ?? '—'}</span>
                        </td>
                        <td className="text-body tabular-nums">{item.violations ?? 0}</td>
                        <td><StatusBadge status={getStatusValue(item)} /></td>
                        <td className="text-body whitespace-nowrap">{item.timestamp ? formatShortDate(item.timestamp) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="WCAG standards" className="card p-6">
            <h2 className="font-heading font-semibold text-base text-ink">By WCAG standard</h2>
            <p className="text-xs text-body mt-0.5 mb-4">Which accessibility rules are failing</p>
            {intelLoading ? (
              <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
            ) : !wcagBreakdown || wcagBreakdown.length === 0 ? (
              <p className="text-sm text-body py-10 text-center">No data yet.</p>
            ) : (
              <ul className="space-y-3.5">
                {wcagBreakdown.slice(0, 6).map(({ tag, count }) => (
                  <li key={tag}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink truncate" title={tag}>{wcagName(tag)}</span>
                      <span className="font-semibold text-ink tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-blue" style={{ width: `${(count / maxWcag) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}
