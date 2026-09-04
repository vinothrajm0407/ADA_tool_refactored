import { apiFetch } from '../../utils/api';
import { useState, useEffect, useMemo } from 'react';
import {
  Globe, ChevronLeft, ChevronRight, Search, RefreshCw,
  TrendingUp, TrendingDown, Minus, BarChart2, X, GitCompareArrows,
  CheckSquare, Square,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { formatDateTime, formatShortDate, formatDuration } from '../../utils/format';
import GlowInput from '../ui/GlowInput';
import { StatusBadge } from '../ui/StatusBadge';

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function ScorePill({ value }) {
  if (value == null) return <span className="text-body dark:text-gray-500 text-xs">—</span>;
  const cls =
    value >= 80
      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      : value >= 60
      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
      : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {value}
    </span>
  );
}

function ViolationPill({ value }) {
  if (value == null) return <span className="text-body dark:text-gray-500 text-xs">—</span>;
  const cls =
    value === 0
      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      : value <= 20
      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
      : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {value}
    </span>
  );
}

function DeltaBadge({ delta, invertGood = false }) {
  if (delta == null || delta === 0) return <Minus size={12} className="text-gray-400" />;
  const positive = delta > 0;
  const isGood = invertGood ? !positive : positive;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isGood ? 'text-sage' : 'text-coral'}`}>
      {isGood ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {positive ? '+' : ''}{delta}
    </span>
  );
}

function normaliseStatus(s) {
  if (!s) return s;
  if (s === 'completed') return 'Passed';
  if (s === 'failed') return 'Failed';
  if (s === 'running' || s === 'pending') return 'Running';
  return s;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function KpiMini({ label, value, color = 'text-ink dark:text-white' }) {
  return (
    <div className="bg-white dark:bg-charcoal rounded-xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-soft">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">{label}</p>
      <p className={`font-heading font-bold text-2xl mt-1 leading-none ${color}`}>{value ?? '—'}</p>
    </div>
  );
}

function ScoreTimelineChart({ data, urlLabel }) {
  if (data.length < 2) return null;
  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <p className="font-heading font-semibold text-sm text-ink dark:text-white">
            Accessibility Health Trend
          </p>
          <p className="text-xs text-body dark:text-gray-500 mt-0.5 truncate max-w-xs" title={urlLabel}>
            {urlLabel}
          </p>
        </div>
        <span className="text-[10px] text-body dark:text-gray-500 flex-shrink-0 mt-1">
          {data.length} run{data.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#1F2937', border: 'none', borderRadius: 10, color: '#F8F6F1', fontSize: 12 }}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.date ?? label}
              formatter={(val, name) => [val != null ? `${val}` : '—', name]}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone" dataKey="site_score" name="Site Score"
              stroke="#0F766E" strokeWidth={2} dot={{ r: 3, fill: '#0F766E', strokeWidth: 0 }}
              activeDot={{ r: 5 }} connectNulls
            />
            <Line
              type="monotone" dataKey="avg_pass_rate" name="Avg Pass Rate"
              stroke="#6BA368" strokeWidth={2} strokeDasharray="4 2"
              dot={{ r: 3, fill: '#6BA368', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Task 4: Compare Panel
function ComparePanel({ data, loading, error, onClose }) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6 animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 dark:bg-white/5 rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl" />)}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-coral/20 p-4 text-sm text-coral">
        Comparison error: {error}
      </div>
    );
  }
  if (!data) return null;

  const { crawl_a, crawl_b, summary } = data;

  function CompareMetric({ label, valueA, valueB, delta, invertGood = false }) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-body dark:text-gray-500">{label}</p>
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold text-lg text-ink dark:text-white">{valueA ?? '—'}</span>
          <span className="text-body dark:text-gray-500 text-sm">→</span>
          <span className="font-heading font-bold text-lg text-ink dark:text-white">{valueB ?? '—'}</span>
          <DeltaBadge delta={delta} invertGood={invertGood} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows size={16} className="text-teal flex-shrink-0" />
          <p className="font-heading font-semibold text-sm text-ink dark:text-white">Crawl Comparison</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-body dark:text-gray-500">
          <span>A: {formatShortDate(crawl_a.created_at)}</span>
          <span>B: {formatShortDate(crawl_b.created_at)}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
          <X size={15} className="text-body dark:text-gray-400" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Core metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <CompareMetric
            label="Site Score"
            valueA={crawl_a.site_score}
            valueB={crawl_b.site_score}
            delta={summary.score_delta}
          />
          <CompareMetric
            label="Avg Pass Rate"
            valueA={crawl_a.avg_pass_rate != null ? `${crawl_a.avg_pass_rate}%` : null}
            valueB={crawl_b.avg_pass_rate != null ? `${crawl_b.avg_pass_rate}%` : null}
            delta={summary.pass_rate_delta}
          />
          <CompareMetric
            label="Total Violations"
            valueA={crawl_a.total_violations}
            valueB={crawl_b.total_violations}
            delta={summary.violations_delta}
            invertGood
          />
        </div>

        {/* Page summary pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: `${summary.pages_improved} improved`, cls: 'bg-sage/10 text-sage' },
            { label: `${summary.pages_regressed} regressed`, cls: 'bg-coral/10 text-coral' },
            { label: `${summary.pages_unchanged} unchanged`, cls: 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400' },
            summary.pages_only_in_b > 0 && { label: `${summary.pages_only_in_b} new in B`, cls: 'bg-teal/10 text-teal' },
          ].filter(Boolean).map(({ label, cls }) => (
            <span key={label} className={`text-xs font-semibold px-3 py-1 rounded-full ${cls}`}>{label}</span>
          ))}
        </div>

        {/* Top regressions in B */}
        {data.regressed.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-body dark:text-gray-500 mb-2">
              Biggest Regressions (A → B)
            </p>
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] overflow-hidden">
              {data.regressed.slice(0, 5).map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="text-xs text-ink dark:text-white truncate flex-1" title={r.url}>{r.url}</p>
                  <span className="text-xs text-body dark:text-gray-400 flex-shrink-0">
                    {r.violations_a} → {r.violations_b}
                  </span>
                  <DeltaBadge delta={r.delta} invertGood />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top improvements */}
        {data.improved.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-body dark:text-gray-500 mb-2">
              Most Improved (A → B)
            </p>
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] overflow-hidden">
              {data.improved.slice(0, 5).map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="text-xs text-ink dark:text-white truncate flex-1" title={r.url}>{r.url}</p>
                  <span className="text-xs text-body dark:text-gray-400 flex-shrink-0">
                    {r.violations_a} → {r.violations_b}
                  </span>
                  <DeltaBadge delta={r.delta} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crawls tab content (embedded in Scan History)
// ---------------------------------------------------------------------------
export function CrawlHistoryContent() {
  const { navigate, setCrawlId } = useApp();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [reCrawling, setReCrawling] = useState(null);

  // Compare state
  const [selectedForCompare, setSelectedForCompare] = useState([]); // max 2 crawl_ids
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);

  // Analytics URL selector
  const [analyticsUrl, setAnalyticsUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/api/crawls?limit=100')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok && Array.isArray(data.items)) {
          setItems(data.items);
          setAvailable(data.available !== false);
          setMessage(data.message || '');
        } else {
          setError(data.error || 'Failed to load crawl history');
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Network error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  // ── Analytics derived data ──────────────────────────────────────────────
  // Group completed crawls by URL
  const urlGroups = useMemo(() => {
    const groups = {};
    for (const item of items) {
      if (item.status === 'completed' && item.site_score != null) {
        const url = item.root_url || '';
        if (!groups[url]) groups[url] = [];
        groups[url].push(item);
      }
    }
    return groups;
  }, [items]);

  // URLs that have >= 2 completed crawls (eligible for timeline)
  const eligibleUrls = useMemo(() =>
    Object.entries(urlGroups)
      .filter(([, v]) => v.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([url]) => url),
    [urlGroups]
  );

  // Set default analytics URL to the most-crawled URL
  useEffect(() => {
    if (eligibleUrls.length > 0 && !analyticsUrl) {
      setAnalyticsUrl(eligibleUrls[0]);
    }
  }, [eligibleUrls, analyticsUrl]);

  // Timeline data for selected URL, oldest → newest
  const timelineData = useMemo(() => {
    if (!analyticsUrl || !urlGroups[analyticsUrl]) return [];
    return [...urlGroups[analyticsUrl]]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((item, i) => ({
        label: `#${i + 1}`,
        date: formatShortDate(item.created_at),
        site_score: item.site_score,
        avg_pass_rate: item.avg_pass_rate,
        total_violations: item.total_violations,
        crawl_id: item.crawl_id,
      }));
  }, [analyticsUrl, urlGroups]);

  // Show analytics section when >= 3 total crawls have completed with scores
  const completedWithScore = items.filter(i => i.status === 'completed' && i.site_score != null);
  const showAnalytics = completedWithScore.length >= 3;
  const latestCompleted = completedWithScore[0]; // items sorted newest first

  // ── Search / pagination ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      (item.root_url || '').toLowerCase().includes(q) ||
      (item.crawl_id || '').toLowerCase().includes(q) ||
      (item.status || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Handlers ────────────────────────────────────────────────────────────
  function openCrawl(item) {
    setCrawlId(item.crawl_id);
    navigate('crawl-results');
  }

  async function handleReCrawl(e, item) {
    e.stopPropagation();
    if (reCrawling) return;
    setReCrawling(item.crawl_id);
    try {
      const res = await apiFetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.root_url }),
      });
      const data = await res.json();
      if (data.ok) {
        setCrawlId(data.crawl_id);
        navigate('crawl-results');
      }
    } catch (err) {
      setError(err.message || 'Re-crawl failed. Please try again.');
    }
    setReCrawling(null);
  }

  // ── Compare handlers ────────────────────────────────────────────────────
  function toggleCompare(e, crawlId) {
    e.stopPropagation();
    setSelectedForCompare(prev => {
      if (prev.includes(crawlId)) return prev.filter(id => id !== crawlId);
      if (prev.length >= 2) return [prev[1], crawlId];
      return [...prev, crawlId];
    });
    setCompareData(null);
    setCompareError(null);
  }

  async function handleCompare() {
    if (selectedForCompare.length !== 2) return;
    const [a, b] = selectedForCompare;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const res = await apiFetch(`/api/crawls/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
      const json = await res.json();
      if (json.ok) setCompareData(json);
      else setCompareError(json.error || 'Comparison failed');
    } catch (ex) {
      setCompareError(ex.message || 'Network error');
    }
    setCompareLoading(false);
  }

  function clearCompare() {
    setSelectedForCompare([]);
    setCompareData(null);
    setCompareError(null);
  }

  const showTable = !loading && !error && items.length > 0 && available;
  const compareReady = selectedForCompare.length === 2;

  return (
    <div className="space-y-6">

        {/* ── Task 6: Crawl Trend Dashboard ──────────────────────────────── */}
        {showAnalytics && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-body dark:text-gray-500" />
              <p className="font-heading font-semibold text-sm uppercase tracking-wider text-body dark:text-gray-400 leading-none">
                Site Analytics
              </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiMini
                label="Current Site Score"
                value={latestCompleted?.site_score}
                color={
                  latestCompleted?.site_score >= 80
                    ? 'text-sage'
                    : latestCompleted?.site_score >= 60
                    ? 'text-amber'
                    : 'text-coral'
                }
              />
              <KpiMini
                label="Avg Pass Rate"
                value={latestCompleted?.avg_pass_rate != null ? `${latestCompleted.avg_pass_rate}%` : null}
              />
              <KpiMini
                label="Total Violations"
                value={latestCompleted?.total_violations}
                color="text-coral"
              />
              <KpiMini
                label="Crawl Runs"
                value={items.length}
                color="text-teal"
              />
            </div>

            {/* Task 2: Score Timeline */}
            {eligibleUrls.length > 0 && (
              <div className="space-y-2">
                {eligibleUrls.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-body dark:text-gray-400">Timeline for:</span>
                    <select
                      className="text-xs bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-teal"
                      value={analyticsUrl || ''}
                      onChange={e => setAnalyticsUrl(e.target.value)}
                    >
                      {eligibleUrls.map(url => (
                        <option key={url} value={url}>{url}</option>
                      ))}
                    </select>
                  </div>
                )}
                <ScoreTimelineChart data={timelineData} urlLabel={analyticsUrl || ''} />
              </div>
            )}
          </div>
        )}

        {/* ── Status messages ─────────────────────────────────────────────── */}
        {!loading && !error && message && (
          <p className={
            available
              ? 'text-[0.95rem] text-body dark:text-gray-400'
              : 'text-[0.95rem] text-ink dark:text-white bg-teal/10 dark:bg-teal/[0.15] px-4 py-3 rounded-xl border border-teal'
          } role={available ? undefined : 'status'}>
            {message}
          </p>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-[0.95rem] text-ink dark:text-white bg-coral/10 px-4 py-3 rounded-xl border border-coral/30" role="alert">
            {error}
          </p>
        )}

        {!loading && !error && items.length === 0 && available && (
          <div className="mt-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center">
              <Globe className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">No crawls yet</p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs leading-relaxed">
              Start a site crawl from New Scan and results will appear here.
            </p>
            <button className="btn-primary mt-2" onClick={() => navigate('new-scan')}>
              Start First Crawl
            </button>
          </div>
        )}

        {showTable && (
          <>
            {/* Search + compare controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 max-w-sm">
                <GlowInput
                  icon={Search}
                  type="search"
                  placeholder="Search by URL or status…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Task 4: Compare controls */}
              {selectedForCompare.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-body dark:text-gray-400">
                    {selectedForCompare.length} of 2 selected
                  </span>
                  {compareReady && (
                    <button
                      onClick={handleCompare}
                      disabled={compareLoading}
                      className="btn-primary text-xs flex items-center gap-1.5 py-1.5"
                    >
                      <GitCompareArrows size={13} />
                      {compareLoading ? 'Comparing…' : 'Compare'}
                    </button>
                  )}
                  <button
                    onClick={clearCompare}
                    className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {filtered.length === 0 && (
              <p className="text-[0.95rem] text-body dark:text-gray-400">
                No results match <strong>&ldquo;{searchQuery}&rdquo;</strong>.
              </p>
            )}

            {/* ── Task 4: Compare result panel ────────────────────────── */}
            {(compareData || compareLoading || compareError) && (
              <ComparePanel
                data={compareData}
                loading={compareLoading}
                error={compareError}
                onClose={clearCompare}
              />
            )}

            {filtered.length > 0 && (
              <>
                <div className="bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-gray-50 dark:bg-night border-b border-gray-100 dark:border-white/[0.06]">
                        <tr>
                          <th className="py-3 px-3.5 w-8" />
                          {['Site URL', 'Date', 'Pages', 'Violations', 'Avg Pass Rate', 'Site Score', 'Duration', 'Status', ''].map((h) => (
                            <th
                              key={h}
                              className="py-3 px-3.5 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((item) => {
                          const isSelected = selectedForCompare.includes(item.crawl_id);
                          return (
                            <tr
                              key={item.crawl_id}
                              className={`border-b border-gray-100 dark:border-white/[0.06] last:border-b-0 hover:bg-teal/[0.04] dark:hover:bg-teal/[0.07] cursor-pointer transition-colors ${
                                isSelected ? 'bg-teal/[0.06] dark:bg-teal/[0.10]' : ''
                              }`}
                              onClick={() => openCrawl(item)}
                            >
                              {/* Compare checkbox — Task 4 */}
                              <td className="py-3 px-3.5" onClick={(e) => toggleCompare(e, item.crawl_id)}>
                                {isSelected
                                  ? <CheckSquare size={15} className="text-teal" />
                                  : <Square size={15} className="text-gray-300 dark:text-gray-600 hover:text-teal transition-colors" />
                                }
                              </td>

                              {/* Site URL */}
                              <td className="py-3 px-3.5 max-w-[200px]">
                                <span className="block truncate text-teal text-sm font-medium" title={item.root_url}>
                                  {item.root_url || '—'}
                                </span>
                                <span className="block text-[10px] font-mono text-body dark:text-gray-500 truncate mt-0.5">
                                  {item.crawl_id}
                                </span>
                              </td>

                              {/* Date */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-body dark:text-gray-400 text-xs">
                                {formatDateTime(item.created_at)}
                              </td>

                              {/* Pages */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                <span className="font-semibold text-ink dark:text-white text-sm">
                                  {item.total_scanned ?? 0}
                                </span>
                                {(item.total_failed ?? 0) > 0 && (
                                  <span className="text-coral text-xs ml-1">+{item.total_failed}✗</span>
                                )}
                              </td>

                              {/* Violations */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                <ViolationPill value={item.total_violations} />
                              </td>

                              {/* Avg Pass Rate */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                {item.avg_pass_rate != null
                                  ? <span className="text-sm font-semibold text-ink dark:text-white">{item.avg_pass_rate}%</span>
                                  : <span className="text-body dark:text-gray-500 text-xs">—</span>
                                }
                              </td>

                              {/* Site Score */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-center">
                                <ScorePill value={item.site_score} />
                              </td>

                              {/* Duration */}
                              <td className="py-3 px-3.5 whitespace-nowrap text-body dark:text-gray-400 text-xs">
                                {formatDuration(item.duration_seconds)}
                              </td>

                              {/* Status */}
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <StatusBadge status={normaliseStatus(item.status)} />
                              </td>

                              {/* Re-crawl */}
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <button
                                  title="Re-crawl this site"
                                  aria-label={`Re-crawl ${item.root_url}`}
                                  onClick={(e) => handleReCrawl(e, item)}
                                  disabled={reCrawling === item.crawl_id}
                                  className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40"
                                >
                                  <RefreshCw
                                    size={14}
                                    className={reCrawling === item.crawl_id ? 'animate-spin' : ''}
                                  />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Hint when no item selected */}
                {selectedForCompare.length === 0 && items.length >= 2 && (
                  <p className="text-[11px] text-body dark:text-gray-500 text-center">
                    Select two crawls using the checkboxes to compare them side by side.
                  </p>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-sm text-body dark:text-gray-400">
                    <span>
                      Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white text-xs font-medium hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Prev
                      </button>
                      <span className="px-1 tabular-nums">{safePage} / {totalPages}</span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white text-xs font-medium hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
    </div>
  );
}
