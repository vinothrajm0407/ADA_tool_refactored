import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import { Globe, BarChart2, TrendingUp, TrendingDown, Minus, Network, Activity, AlertTriangle } from 'lucide-react';
import { formatUrl, formatShortDate, formatDuration } from '../utils/format';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { StatusBadge } from '../components/ui/StatusBadge';

/* ─── module-level sub-components ─── */

function ScoreRing({ score, size = 60 }) {
  const sw = 6;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const s = Math.min(Math.max(score ?? 0, 0), 100);
  const offset = circ - (s / 100) * circ;
  const color = s >= 80 ? '#0F766E' : s >= 60 ? '#F59E0B' : '#F87171';
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ}`} strokeDashoffset={`${offset}`}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function KpiCard({ label, value, sub, color = 'text-ink dark:text-white', loading, delta, invertDelta = false, deltaLabel = 'vs prev 30d' }) {
  const isPositive = delta > 0;
  const isGood = invertDelta ? !isPositive : isPositive;
  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl p-5 border border-gray-100 dark:border-white/[0.06] shadow-soft flex flex-col justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">{label}</p>
      <div className="mt-3">
        {loading
          ? <div className="h-8 w-16 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
          : <p className={`font-heading font-bold text-3xl leading-none ${color}`}>{value ?? '—'}</p>
        }
        <p className="text-xs text-body dark:text-gray-500 mt-1.5">{sub}</p>
        <div className="h-6 mt-1.5">
          {!loading && delta != null && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              delta === 0
                ? 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]'
                : isGood
                  ? 'text-sage bg-sage/10'
                  : 'text-coral bg-coral/10'
            }`}>
              {delta === 0
                ? <Minus className="w-2.5 h-2.5" />
                : isGood
                  ? <TrendingUp className="w-2.5 h-2.5" />
                  : <TrendingDown className="w-2.5 h-2.5" />
              }
              {delta > 0 ? '+' : ''}{delta}% {deltaLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CrawlStatusChip({ status }) {
  const s = (status || '').toLowerCase();
  const styles = {
    completed: 'bg-teal/10 text-teal',
    running:   'bg-amber/10 text-amber',
    failed:    'bg-coral/10 text-coral',
    pending:   'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400',
  };
  return (
    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full capitalize flex-shrink-0 ${styles[s] ?? styles.pending}`}>
      {s || 'unknown'}
    </span>
  );
}

function ChartEmpty() {
  return (
    <div className="h-52 flex flex-col items-center justify-center text-body dark:text-gray-500">
      <BarChart2 className="w-8 h-8 mb-2 opacity-20" />
      <p className="text-sm">No data for this period</p>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-52 bg-gray-50 dark:bg-white/[0.02] rounded-xl animate-pulse" />;
}

const SEVERITY_CONFIG = [
  { key: 'critical', label: 'Critical', barClass: 'bg-coral',    textClass: 'text-coral' },
  { key: 'serious',  label: 'Serious',  barClass: 'bg-amber',    textClass: 'text-amber' },
  { key: 'moderate', label: 'Moderate', barClass: 'bg-blue-400', textClass: 'text-blue-400' },
  { key: 'minor',    label: 'Minor',    barClass: 'bg-gray-400', textClass: 'text-gray-400' },
];

const formatRuleId = (id) =>
  (id || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* ─── page ─── */
export default function DashboardPage() {
  const [historyItems, setHistoryItems] = useState([]);
  const [trendData, setTrendData]       = useState([]);
  const [trendSummary, setTrendSummary] = useState(null);
  const [weekSummary, setWeekSummary]   = useState(null);
  const [crawlItems, setCrawlItems]     = useState([]);
  const [sixtyDayData, setSixtyDayData] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [trendAvail, setTrendAvail]     = useState(true);
  const [violationIntel, setViolationIntel] = useState(null);
  const [intelAvail, setIntelAvail]         = useState(true);
  const [intelLoading, setIntelLoading]     = useState(true);

  /* ── main data: fast queries, no payload parsing ── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const fallback = { ok: false };
        const safeJson = (res) => res.json().catch(() => fallback);
        const [histJson, trendJson, weekJson, crawlJson, trend60Json] = await Promise.all([
          apiFetch('/api/history').then(safeJson).catch(() => fallback),
          apiFetch('/api/trends?days=30').then(safeJson).catch(() => fallback),
          apiFetch('/api/trends?days=7').then(safeJson).catch(() => fallback),
          apiFetch('/api/crawls').then(safeJson).catch(() => fallback),
          apiFetch('/api/trends?days=60').then(safeJson).catch(() => fallback),
        ]);

        if (histJson.ok && Array.isArray(histJson.items)) {
          setHistoryItems(histJson.items);
        }
        if (trendJson.ok && trendJson.available && Array.isArray(trendJson.data)) {
          setTrendData(trendJson.data);
          setTrendSummary(trendJson.summary ?? null);
          setTrendAvail(true);
        } else {
          setTrendAvail(false);
        }
        if (weekJson.ok && weekJson.available && weekJson.summary) {
          setWeekSummary(weekJson.summary);
        }
        if (crawlJson.ok && Array.isArray(crawlJson.items)) {
          setCrawlItems(crawlJson.items);
        }
        if (trend60Json.ok && trend60Json.available && Array.isArray(trend60Json.data)) {
          setSixtyDayData(trend60Json.data);
        }
      } catch {
        // network failure — all states remain at empty defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── violation intel: separate fetch, parses payloads, loads independently ── */
  useEffect(() => {
    (async () => {
      setIntelLoading(true);
      try {
        const res  = await apiFetch('/api/violations/summary?limit=25');
        const json = await res.json().catch(() => ({ ok: false }));
        if (json.ok && json.available) {
          setViolationIntel(json);
        } else {
          setIntelAvail(false);
        }
      } catch {
        setIntelAvail(false);
      } finally {
        setIntelLoading(false);
      }
    })();
  }, []);

  /* ── base metrics ── */
  const totalScans      = historyItems.length;
  const totalViolations = historyItems.reduce((s, i) => s + (i.violations ?? 0), 0);
  const scansThisWeek   = weekSummary?.total_scans ?? 0;
  const crawlsTotal     = crawlItems.length;

  const avgPassRate = trendSummary?.avg_pass_rate != null
    ? Math.round(trendSummary.avg_pass_rate)
    : historyItems.length > 0
      ? Math.round(historyItems.reduce((s, i) => s + (i.passRate ?? 0), 0) / historyItems.length)
      : null;

  /* ── period-over-period comparison (60d split) ── */
  const splitIdx   = Math.ceil(sixtyDayData.length / 2);
  const prevPeriod = sixtyDayData.slice(0, splitIdx);
  const currPeriod = sixtyDayData.slice(splitIdx);

  const weightedAvgPassRate = (arr) => {
    const n = arr.reduce((s, d) => s + d.scan_count, 0);
    if (!n) return null;
    return arr.reduce((s, d) => s + d.avg_pass_rate * d.scan_count, 0) / n;
  };

  const prevPassRate = weightedAvgPassRate(prevPeriod);
  const currPassRate = weightedAvgPassRate(currPeriod);
  const passRateDelta60 = (prevPassRate != null && currPassRate != null)
    ? Math.round((currPassRate - prevPassRate) * 10) / 10
    : null;

  const prevViols    = prevPeriod.reduce((s, d) => s + d.total_violations, 0);
  const currViols    = currPeriod.reduce((s, d) => s + d.total_violations, 0);
  const violationsDelta = (prevViols > 0 && currPeriod.length > 0)
    ? Math.round((currViols - prevViols) / prevViols * 1000) / 10
    : null;

  const prevScanActivity = prevPeriod.reduce((s, d) => s + d.scan_count, 0);
  const currScanActivity = currPeriod.reduce((s, d) => s + d.scan_count, 0);
  const scansDelta = (prevScanActivity > 0 && currPeriod.length > 0)
    ? Math.round((currScanActivity - prevScanActivity) / prevScanActivity * 1000) / 10
    : null;

  /* ── violation intelligence ── */
  const severityBreakdown = violationIntel?.severity_breakdown ?? null;
  const topIssueTypes     = violationIntel?.top_issue_types ?? [];
  const needsAttention    = violationIntel?.needs_attention ?? [];
  const maxSeverityCount  = severityBreakdown
    ? Math.max(...SEVERITY_CONFIG.map(c => severityBreakdown[c.key] ?? 0), 1)
    : 1;

  /* ── helpers ── */
  const topUrls = [...historyItems]
    .sort((a, b) => (b.violations ?? 0) - (a.violations ?? 0))
    .slice(0, 5);

  const getStatusValue = (item) => (item.passRate ?? 0) >= 70 ? 'Passed' : 'Needs review';

  /* ─── render ─── */
  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night">
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        {/* ── KPI ROW — 5 cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

          {/* Avg Pass Rate — compact stacked hero */}
          <div className="col-span-2 lg:col-span-1 bg-white dark:bg-charcoal rounded-2xl p-5 border border-gray-100 dark:border-white/[0.06] shadow-soft flex flex-col justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">
              Avg Pass Rate
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div className="relative flex-shrink-0 w-[60px] h-[60px]">
                {loading
                  ? <div className="w-full h-full rounded-full bg-gray-100 dark:bg-white/5 animate-pulse" />
                  : <ScoreRing score={avgPassRate ?? 0} size={60} />
                }
                {!loading && avgPassRate != null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-heading font-bold text-base text-ink dark:text-white leading-none">
                      {avgPassRate}
                    </span>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {loading
                  ? <div className="h-8 w-14 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
                  : <p className="font-heading font-bold text-3xl leading-none text-ink dark:text-white">
                      {avgPassRate != null ? `${avgPassRate}%` : '—'}
                    </p>
                }
              </div>
            </div>
            <div className="mt-2 h-6">
              {!loading && passRateDelta60 != null && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  passRateDelta60 > 0 ? 'text-sage bg-sage/10'
                  : passRateDelta60 < 0 ? 'text-coral bg-coral/10'
                  : 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]'
                }`}>
                  {passRateDelta60 > 0
                    ? <TrendingUp className="w-2.5 h-2.5" />
                    : passRateDelta60 < 0
                      ? <TrendingDown className="w-2.5 h-2.5" />
                      : <Minus className="w-2.5 h-2.5" />
                  }
                  {passRateDelta60 > 0 ? '+' : ''}{passRateDelta60} pts vs prev 30d
                </span>
              )}
              {!loading && passRateDelta60 == null && (
                <span className="text-[10px] text-gray-400 dark:text-gray-600">Not enough data</span>
              )}
            </div>
          </div>

          <KpiCard
            label="Total Scans"
            value={totalScans}
            sub="all time"
            loading={loading}
            delta={scansDelta}
            deltaLabel="vs prev 30d"
          />
          <KpiCard
            label="Total Violations"
            value={totalViolations}
            sub="across all scans"
            color="text-coral"
            loading={loading}
            delta={violationsDelta}
            invertDelta
            deltaLabel="vs prev 30d"
          />
          <KpiCard
            label="Scans This Week"
            value={scansThisWeek}
            sub="last 7 days"
            color="text-teal"
            loading={loading}
          />
          <KpiCard
            label="Crawls Run"
            value={crawlsTotal}
            sub="all time"
            color="text-ink dark:text-white"
            loading={loading}
          />
        </div>

        {/* ── TREND CHARTS ── */}
        <div className="grid lg:grid-cols-2 gap-5">

          {/* Pass Rate Trend */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <div className="mb-5">
              <p className="font-heading font-bold text-base text-ink dark:text-white">Pass Rate Trend</p>
              <p className="text-xs text-body dark:text-gray-500 mt-0.5">Avg pass rate over the last 30 days</p>
            </div>
            {loading ? <ChartSkeleton /> : !trendAvail || trendData.length === 0 ? <ChartEmpty /> : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="passRateGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#0F766E" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#0F766E" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1F2937', border: 'none', borderRadius: 10, color: '#F8F6F1', fontSize: 12 }}
                      cursor={{ stroke: '#0F766E', strokeWidth: 1, strokeDasharray: '4 2' }}
                      formatter={(val) => [`${val}%`, 'Pass Rate']}
                    />
                    <Area
                      type="monotone" dataKey="avg_pass_rate"
                      stroke="#0F766E" strokeWidth={2}
                      fill="url(#passRateGrad)"
                      dot={false} activeDot={{ r: 4, fill: '#0F766E', strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Violations Trend */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <div className="mb-5">
              <p className="font-heading font-bold text-base text-ink dark:text-white">Violations Trend</p>
              <p className="text-xs text-body dark:text-gray-500 mt-0.5">Total violations per day over the last 30 days</p>
            </div>
            {loading ? <ChartSkeleton /> : !trendAvail || trendData.length === 0 ? <ChartEmpty /> : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1F2937', border: 'none', borderRadius: 10, color: '#F8F6F1', fontSize: 12 }}
                      cursor={{ fill: 'rgba(231,111,81,0.06)' }}
                      formatter={(val) => [val, 'Violations']}
                    />
                    <Bar dataKey="total_violations" fill="#E76F51" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* ── ACTIVITY ROW ── */}
        <div className="grid lg:grid-cols-3 gap-5">

          {/* Recent Scans */}
          <div className="lg:col-span-2 bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center justify-between">
              <span className="font-heading font-semibold text-base text-ink dark:text-white">Recent Scans</span>
              <span className="text-xs text-body dark:text-gray-500">{totalScans} total</span>
            </div>

            {loading ? (
              <div className="p-6 space-y-4">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-48" />
                      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-24" />
                    </div>
                    <div className="h-6 w-16 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : historyItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-body dark:text-gray-500">
                <Globe className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm">No scans yet. Go to New Scan to get started.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {historyItems.slice(0, 7).map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 px-6 py-4"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-heading font-bold text-sm ${
                      (item.passRate ?? 0) >= 80 ? 'bg-teal/10 text-teal'
                      : (item.passRate ?? 0) >= 50 ? 'bg-amber/10 text-amber'
                      : 'bg-coral/10 text-coral'
                    }`}>
                      {item.passRate != null ? item.passRate : '—'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink dark:text-white truncate">
                        {formatUrl(item.url ?? '')}
                      </p>
                      <p className="text-xs text-body dark:text-gray-500 mt-0.5">
                        {item.violations ?? 0} violation{(item.violations ?? 0) !== 1 ? 's' : ''}
                        {item.timestamp ? ` · ${formatShortDate(item.timestamp)}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={getStatusValue(item)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Violating URLs */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
              <p className="font-heading font-semibold text-base text-ink dark:text-white">Top Violating URLs</p>
              <p className="text-xs text-body dark:text-gray-500 mt-0.5">Sorted by violation count</p>
            </div>

            {loading ? (
              <div className="px-6 py-5 space-y-5">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between">
                      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-36" />
                      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-6" />
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : topUrls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-body dark:text-gray-500">
                <Globe className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm text-center px-4">No scan data yet.</p>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                {topUrls.map((item, idx) => {
                  const maxV = topUrls[0]?.violations ?? 1;
                  const pct = maxV > 0 ? Math.round(((item.violations ?? 0) / maxV) * 100) : 0;
                  return (
                    <div key={item.id ?? idx}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p
                          className="text-xs font-medium text-ink dark:text-white truncate max-w-[160px]"
                          title={item.url}
                        >
                          {formatUrl(item.url ?? '')}
                        </p>
                        <span className="text-xs font-semibold text-coral ml-2 flex-shrink-0">
                          {item.violations ?? 0}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-coral/50"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── VIOLATION INTELLIGENCE ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-body dark:text-gray-500" />
            <span className="font-heading font-semibold text-sm uppercase tracking-wider text-body dark:text-gray-400 leading-none">
              Violation Intelligence
            </span>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">

            {/* Severity Breakdown */}
            <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
                <p className="font-heading font-semibold text-base text-ink dark:text-white">Severity Breakdown</p>
                <p className="text-xs text-body dark:text-gray-500 mt-0.5">Node counts by impact level</p>
              </div>
              {intelLoading ? (
                <div className="px-6 py-5 space-y-5">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between">
                        <div className="h-3 w-20 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
                        <div className="h-3 w-6 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : !intelAvail || !severityBreakdown ? (
                <div className="flex items-center justify-center py-14">
                  <p className="text-sm text-body dark:text-gray-500">No violation data yet</p>
                </div>
              ) : (
                <div className="px-6 py-5 space-y-4">
                  {SEVERITY_CONFIG.map(cfg => {
                    const count = severityBreakdown[cfg.key] ?? 0;
                    const pct = Math.round((count / maxSeverityCount) * 100);
                    return (
                      <div key={cfg.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.barClass}`} />
                            <span className="text-xs font-medium text-ink dark:text-white">{cfg.label}</span>
                          </div>
                          <span className={`text-xs font-semibold ${count > 0 ? cfg.textClass : 'text-gray-400 dark:text-gray-600'}`}>
                            {count}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${cfg.barClass} opacity-70`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top Issue Types */}
            <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
                <p className="font-heading font-semibold text-base text-ink dark:text-white">Top Issue Types</p>
                <p className="text-xs text-body dark:text-gray-500 mt-0.5">Most common violations</p>
              </div>
              {intelLoading ? (
                <div className="px-6 py-5 space-y-5">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between">
                        <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-36" />
                        <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-6" />
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : !intelAvail || topIssueTypes.length === 0 ? (
                <div className="flex items-center justify-center py-14">
                  <p className="text-sm text-body dark:text-gray-500">No violation data yet</p>
                </div>
              ) : (
                <div className="px-6 py-5 space-y-4">
                  {topIssueTypes.slice(0, 5).map(item => {
                    const maxCount = topIssueTypes[0]?.count ?? 1;
                    const pct = maxCount > 0 ? Math.round((item.count / maxCount) * 100) : 0;
                    return (
                      <div key={item.rule_id}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p
                            className="text-xs font-medium text-ink dark:text-white truncate max-w-[160px]"
                            title={item.rule_id}
                          >
                            {formatRuleId(item.rule_id)}
                          </p>
                          <span className="text-xs font-semibold text-coral ml-2 flex-shrink-0">{item.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full bg-coral/50" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── NEEDS ATTENTION + RECENT CRAWLS ── */}
        <div className="grid lg:grid-cols-2 gap-5">

          {/* Needs Attention */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-coral flex-shrink-0" />
              <span className="font-heading font-semibold text-base text-ink dark:text-white leading-none">Needs Attention</span>
            </div>
            {intelLoading ? (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {[0, 1, 2].map(i => (
                  <div key={i} className="px-6 py-4 space-y-1.5">
                    <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-40" />
                    <div className="flex gap-2">
                      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-28" />
                      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse w-14 ml-auto" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !intelAvail ? (
              <div className="flex items-center justify-center py-14">
                <p className="text-sm text-body dark:text-gray-500">No data available</p>
              </div>
            ) : needsAttention.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-10 h-10 rounded-full bg-sage/10 flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-sage" />
                </div>
                <p className="text-sm font-medium text-ink dark:text-white">All URLs stable</p>
                <p className="text-xs text-body dark:text-gray-500 mt-1">No regressions detected in recent scans</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {needsAttention.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink dark:text-white truncate" title={item.url}>
                        {formatUrl(item.url)}
                      </p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-coral/10 text-coral flex-shrink-0 mt-0.5">
                        +{item.delta}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-sm font-semibold text-coral">{item.current_violations}</span>
                      <span className="text-xs text-body dark:text-gray-500">violations</span>
                      <span className="text-xs text-body dark:text-gray-500">·</span>
                      <span className="text-xs text-body dark:text-gray-500">was {item.previous_violations}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Crawls */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Network className="w-4 h-4 text-body dark:text-gray-500" />
                <span className="font-heading font-semibold text-base text-ink dark:text-white leading-none">Recent Crawls</span>
              </div>
              <span className="text-xs text-body dark:text-gray-500">{crawlsTotal} total</span>
            </div>

            {loading ? (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4">
                    <div className="h-5 w-20 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-52" />
                      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-28" />
                    </div>
                    <div className="space-y-1.5 text-right">
                      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-12" />
                      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : crawlItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-body dark:text-gray-500">
                <Network className="w-8 h-8 mb-3 opacity-20" />
                <p className="text-sm">No crawls yet. Start a crawl from New Scan to see activity here.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {crawlItems.slice(0, 5).map(c => (
                  <div key={c.crawl_id} className="flex items-center gap-4 px-6 py-4">
                    <CrawlStatusChip status={c.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink dark:text-white truncate">
                        {formatUrl(c.root_url ?? '')}
                      </p>
                      <p className="text-xs text-body dark:text-gray-500 mt-0.5">
                        {c.total_scanned} page{c.total_scanned !== 1 ? 's' : ''} scanned
                        {c.total_failed > 0 ? ` · ${c.total_failed} failed` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-ink dark:text-white">
                        {formatDuration(c.duration_seconds)}
                      </p>
                      <p className="text-xs text-body dark:text-gray-500 mt-0.5">
                        {formatShortDate(c.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
