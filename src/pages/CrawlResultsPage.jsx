import { apiFetch } from '../utils/api';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Download,
  ArrowUpDown,
  ChevronRight,
  Globe,
  AlertTriangle,
  CheckCircle,
  BarChart2,
  RefreshCw,
  ChevronLeft,
  OctagonX,
  Share2,
} from 'lucide-react';
import SendReportModal from '../components/integrations/SendReportModal';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/ui/StatusBadge';
import MetricCard from '../components/ui/MetricCard';
import { ChartCard } from '../components/ui/ChartCard';
import DetailsDrawer from '../components/ui/DetailsDrawer';
import CrawlIntelPanel from '../components/crawl/CrawlIntelPanel';
import CrawlRegressionPanel from '../components/crawl/CrawlRegressionPanel';
import CrawlAISummaryPanel from '../components/crawl/CrawlAISummaryPanel';
import PageTrendsPanel from '../components/crawl/PageTrendsPanel';
import { Printer } from 'lucide-react';


// ---------------------------------------------------------------------------
// Crawl status indicator — animated loader (running) / static shapes (done)
// ---------------------------------------------------------------------------
function CrawlStatusIndicator({ isActive, isComplete }) {
  const base = isComplete ? 'crawl-loader crawl-loader-done' : 'crawl-loader';
  const tri  = isComplete ? 'crawl-loader crawl-loader-tri crawl-loader-done' : 'crawl-loader crawl-loader-tri';
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        <div className={base}>
          <svg viewBox="0 0 80 80"><circle r="32" cy="40" cx="40" /></svg>
        </div>
        <div className={tri}>
          <svg viewBox="0 0 86 80"><polygon points="43 8 79 72 7 72" /></svg>
        </div>
        <div className={base}>
          <svg viewBox="0 0 80 80"><rect height="64" width="64" y="8" x="8" /></svg>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normaliseStatus(raw) {
  if (!raw) return 'Needs review';
  const s = raw.toLowerCase();
  if (s === 'passed' || s === 'pass' || s === 'scanned' || s === 'completed') return 'Passed';
  if (s === 'failed' || s === 'fail' || s === 'error') return 'Failed';
  if (s === 'running') return 'Running';
  if (s === 'pending') return 'Running';
  return 'Needs review';
}

function violationCount(page) {
  if (typeof page.violations === 'number') return page.violations;
  if (Array.isArray(page.violations)) return page.violations.length;
  return page.violation_count ?? 0;
}

function computePageScore(page) {
  if (page.score !== undefined && page.score !== null) return Math.round(page.score);
  const passRate = page.pass_rate;
  if (passRate != null) return Math.round(passRate);
  return Math.max(0, Math.round(100 - violationCount(page) * 5));
}

function exportCSV(pages) {
  const header = ['URL', 'Score', 'Pass Rate', 'Violations', 'Depth', 'Status'];
  const rows = pages.map((p) => [
    `"${(p.url || '').replace(/"/g, '""')}"`,
    computePageScore(p),
    p.pass_rate ?? '',
    violationCount(p),
    p.depth ?? '',
    normaliseStatus(p.status),
  ]);
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crawl-results.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SortableHeader({ label, sortKey: key, currentSort, currentDir, onSort }) {
  const active = currentSort === key;
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          size={13}
          className={active ? 'text-teal' : 'text-gray-300 dark:text-gray-600'}
        />
      </span>
    </th>
  );
}

function ScoreMiniBar({ score }) {
  const colour =
    score >= 80 ? '#0F766E' : score >= 60 ? '#F59E0B' : '#E76F51';
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: colour }}
        />
      </div>
      <span className="text-xs font-semibold text-ink dark:text-white w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? 'bg-teal text-white'
          : 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

// Task 5: Top Violating Pages — clickable ranked table replacing the old bar chart
function TopViolatingTable({ pages, onRowClick }) {
  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-body dark:text-gray-400 text-sm">
        No violations found across scanned pages
      </div>
    );
  }
  const max = pages[0]?.violations ?? 1;
  return (
    <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
      {pages.map((p, idx) => {
        const pct = max > 0 ? Math.round((p.violations / max) * 100) : 0;
        const scoreColor = p._score >= 80 ? '#0F766E' : p._score >= 60 ? '#F59E0B' : '#E76F51';
        return (
          <button
            key={p.url}
            onClick={() => onRowClick && onRowClick(p)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left"
          >
            <span className="text-[11px] font-mono text-body dark:text-gray-500 w-5 flex-shrink-0">
              #{idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-ink dark:text-white truncate" title={p.url}>
                {p.name || p.url}
              </p>
              <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: '#E76F51', opacity: 0.5 }} />
              </div>
            </div>
            {p._score != null && (
              <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: scoreColor }}>
                {p._score}
              </span>
            )}
            <span className="text-sm font-bold text-coral flex-shrink-0 w-8 text-right">
              {p.violations}
            </span>
            <ChevronRight size={14} className="text-body dark:text-gray-500 flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CrawlResultsPage() {
  const { crawlId, setCrawlId, navigate, setPendingScanHistoryTab } = useApp();

  function goToCrawlHistory() {
    setPendingScanHistoryTab('crawls');
    navigate('scan-history');
  }

  const [job, setJob] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [drawerViolations, setDrawerViolations] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('url');
  const [sortDir, setSortDir] = useState('asc');
  const [reCrawlLoading, setReCrawlLoading] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const pollRef = useRef(null);

  // ---- fetch helpers -------------------------------------------------------
  const fetchJob = useCallback(async () => {
    if (!crawlId) return null;
    try {
      const res = await apiFetch(`/api/crawl/${crawlId}`);
      const data = await res.json();
      if (data.ok && data.job) return data.job;
    } catch {}
    return null;
  }, [crawlId]);

  const fetchPages = useCallback(async () => {
    if (!crawlId) return [];
    try {
      const res = await apiFetch(`/api/crawl/${crawlId}/pages`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.pages)) return data.pages;
    } catch {}
    return [];
  }, [crawlId]);

  // ---- mount / crawlId change ----------------------------------------------
  useEffect(() => {
    if (!crawlId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [j, p] = await Promise.all([fetchJob(), fetchPages()]);
      if (cancelled) return;
      setJob(j);
      setPages(p);
      setLoading(false);
      const isActive = j && (j.status === 'running' || j.status === 'pending');
      setPolling(isActive);
    }
    load();
    return () => { cancelled = true; };
  }, [crawlId, fetchJob, fetchPages]);

  // ---- polling -------------------------------------------------------------
  useEffect(() => {
    if (!polling) {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const [j, p] = await Promise.all([fetchJob(), fetchPages()]);
      setJob(j);
      setPages(p);
      const isActive = j && (j.status === 'running' || j.status === 'pending');
      if (!isActive) setPolling(false);
    }, 2500);
    return () => clearInterval(pollRef.current);
  }, [polling, fetchJob, fetchPages]);

  // ---- row click + violation fetch ----------------------------------------
  async function handleRowClick(page) {
    setSelectedRow(page);
    setDrawerViolations(null);
    setDrawerLoading(true);

    const scanHistId = page.scan_history_id;
    if (scanHistId) {
      const numId = scanHistId.replace(/^SCAN-/i, '');
      try {
        const res = await apiFetch(`/api/history/${numId}`);
        const data = await res.json();
        const violations = data.ok && data.result?.axeResult?.violations;
        setDrawerViolations(Array.isArray(violations) ? violations : []);
      } catch {
        setDrawerViolations([]);
      }
    } else {
      setDrawerViolations(null);
    }
    setDrawerLoading(false);
  }

  function handleCloseDrawer() {
    setSelectedRow(null);
    setDrawerViolations(null);
    setDrawerLoading(false);
  }

  // ---- stop crawl ----------------------------------------------------------
  async function handleStop() {
    if (!crawlId || stopLoading) return;
    setStopLoading(true);
    try {
      await apiFetch(`/api/crawl/${crawlId}/stop`, { method: 'POST' });
      setPolling(false);
      const j = await fetchJob();
      setJob(j);
    } catch {}
    setStopLoading(false);
  }

  // ---- re-crawl ------------------------------------------------------------
  async function handleReCrawl() {
    if (!job || reCrawlLoading) return;
    setReCrawlLoading(true);
    try {
      const res = await apiFetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: job.root_url,
          maxDepth: job.max_depth,
          ...(job.max_pages > 500
            ? { fullSite: true }
            : { maxPages: job.max_pages }),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCrawlId(data.crawl_id);
        setSelectedRow(null);
        setDrawerViolations(null);
        setPages([]);
        setJob(null);
        setPolling(false);
      }
    } catch {}
    setReCrawlLoading(false);
  }

  // ---- sort handler --------------------------------------------------------
  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // ---- derived data --------------------------------------------------------
  const enrichedPages = pages.map((p) => ({
    ...p,
    _score: computePageScore(p),
    _violations: violationCount(p),
    _status: normaliseStatus(p.status),
  }));

  const filteredPages = enrichedPages
    .filter((p) => {
      const matchSearch =
        !searchQuery || (p.url && p.url.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'scanned' && p._status !== 'Failed') ||
        (statusFilter === 'failed' && p._status === 'Failed');
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      let av, bv;
      if (sortKey === 'url')        { av = a.url ?? '';       bv = b.url ?? ''; }
      else if (sortKey === 'score') { av = a._score;          bv = b._score; }
      else if (sortKey === 'violations') { av = a._violations; bv = b._violations; }
      else if (sortKey === 'status') { av = a._status;        bv = b._status; }
      else { av = ''; bv = ''; }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

  const totalPages = enrichedPages.length;
  const totalViolations = enrichedPages.reduce((s, p) => s + p._violations, 0);
  const avgScore = totalPages > 0
    ? Math.round(enrichedPages.reduce((s, p) => s + p._score, 0) / totalPages)
    : 0;
  const passed = enrichedPages.filter((p) => p._violations === 0 && p._status !== 'Failed').length;
  const passRate = totalPages > 0 ? Math.round((passed / totalPages) * 100) : 0;

  const failingPages  = enrichedPages.filter((p) => p._violations > 0).length;
  const passingPages  = enrichedPages.filter((p) => p._violations === 0 && p._status !== 'Failed').length;
  const errorPages    = enrichedPages.filter((p) => p._status === 'Failed').length;
  const statusPieData = [
    passingPages > 0 && { name: 'Passing',    value: passingPages, color: '#6BA368' },
    failingPages > 0 && { name: 'Has Issues', value: failingPages, color: '#E76F51' },
    errorPages   > 0 && { name: 'Error',      value: errorPages,   color: '#9CA3AF' },
  ].filter(Boolean);

  // Task 5: top violating pages — enriched with _score for the clickable table
  const topViolationPages = [...enrichedPages]
    .filter((p) => p._violations > 0)
    .sort((a, b) => b._violations - a._violations)
    .slice(0, 10)
    .map((p) => ({
      name: (p.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 35) || '/',
      violations: p._violations,
      url: p.url,
      _score: p._score,
      // keep full page reference for drawer
      _page: p,
    }));

  const maxPagesCount = job?.max_pages ?? job?.total_discovered ?? 1;
  const scanned = job?.total_scanned ?? 0;
  const progressPct = maxPagesCount > 0 ? Math.min(100, Math.round((scanned / maxPagesCount) * 100)) : 0;
  const jobUrl = job?.root_url ?? job?.url ?? job?.start_url ?? '';
  const isActive = job && (job.status === 'running' || job.status === 'pending');
  const isComplete = job && job.status === 'completed';

  // ---- empty state ---------------------------------------------------------
  if (!crawlId) {
    return (
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 flex items-center justify-center">
        <div className="card p-10 max-w-md w-full text-center space-y-4">
          <Globe className="w-12 h-12 text-teal mx-auto" />
          <h2 className="font-heading text-2xl text-ink dark:text-white">No crawl selected</h2>
          <p className="text-body dark:text-gray-400 text-sm">
            Select a crawl from history or start a new site crawl.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button className="btn-secondary" onClick={goToCrawlHistory}>
              Scan History
            </button>
            <button className="btn-primary" onClick={() => navigate('new-scan')}>
              New Crawl
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- loading skeleton ----------------------------------------------------
  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">
        <div className="h-10 w-64 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <MetricCard key={i} loading />)}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />
      </div>
    );
  }

  // ---- main render ---------------------------------------------------------
  return (
    <>
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">

        {/* 1. HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={goToCrawlHistory}
              className="inline-flex items-center gap-1 text-sm text-body dark:text-gray-400 hover:text-teal transition-colors"
            >
              <ChevronLeft size={15} />
              History
            </button>
            <h2 className="font-heading font-bold text-2xl text-ink dark:text-white">
              Crawl Results
            </h2>
            {job?.status && (isActive || isComplete
              ? <CrawlStatusIndicator isActive={isActive} isComplete={isComplete} />
              : <StatusBadge status={normaliseStatus(job.status)} />
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {jobUrl && (
              <code className="text-xs font-mono bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 px-3 py-1.5 rounded-2xl text-body dark:text-gray-400 max-w-xs truncate">
                {jobUrl}
              </code>
            )}
            {isActive && (
              <button
                onClick={handleStop}
                disabled={stopLoading}
                title="Stop this crawl — pages already scanned will be saved"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-coral/30 bg-coral/5 text-coral font-semibold font-heading text-sm hover:bg-coral/10 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed dark:border-coral/20 dark:bg-coral/5 dark:hover:bg-coral/10"
              >
                <OctagonX size={14} />
                {stopLoading ? 'Stopping…' : 'Stop Crawl'}
              </button>
            )}
            {isComplete && (
              <button
                onClick={() => navigate('executive-summary')}
                className="btn-secondary flex items-center gap-2 text-sm"
                title="Open printable executive summary"
              >
                <Printer size={14} />
                Executive Report
              </button>
            )}
            {isComplete && (
              <button
                onClick={() => setShowShareModal(true)}
                className="btn-secondary flex items-center gap-2 text-sm"
                title="Send report to Slack or Teams"
              >
                <Share2 size={14} />
                Share to Channel
              </button>
            )}
            {job?.root_url && !isActive && (
              <button
                onClick={handleReCrawl}
                disabled={reCrawlLoading}
                className="btn-secondary flex items-center gap-2 text-sm"
                title="Start a new crawl of this site"
              >
                <RefreshCw size={14} className={reCrawlLoading ? 'animate-spin' : ''} />
                {reCrawlLoading ? 'Starting…' : 'Re-Crawl'}
              </button>
            )}
          </div>
        </div>

        {/* 2. METRIC CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Pages"      value={job?.max_pages && job.max_pages <= 500 ? `${totalPages}/${job.max_pages}` : totalPages}          icon={Globe}         color="teal" />
          <MetricCard title="Total Violations" value={totalViolations}     icon={AlertTriangle} color="coral" />
          <MetricCard
            title="Avg Score"
            value={avgScore}
            icon={BarChart2}
            color={avgScore >= 80 ? 'sage' : avgScore >= 60 ? 'amber' : 'coral'}
          />
          <MetricCard title="Pass Rate" value={`${passRate}%`} icon={CheckCircle} color="sage" />
        </div>

        {/* 3. PROGRESS (running/pending only) */}
        {isActive && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-bold text-ink dark:text-white">Crawl in Progress</h3>
              <span className="text-sm text-body dark:text-gray-400">{progressPct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex gap-6 flex-wrap text-sm">
              <div>
                <span className="text-body dark:text-gray-400">Discovered </span>
                <span className="font-semibold text-ink dark:text-white">{job?.total_discovered ?? 0}</span>
              </div>
              <div>
                <span className="text-body dark:text-gray-400">Scanned </span>
                <span className="font-semibold text-teal">{job?.total_scanned ?? 0}</span>
              </div>
              <div>
                <span className="text-body dark:text-gray-400">Failed </span>
                <span className="font-semibold text-coral">{job?.total_failed ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* 4. CHARTS ROW */}
        <div className="grid lg:grid-cols-2 gap-6">
          <ChartCard
            title="Pages: Passing vs Has Issues"
            subtitle="Pages with 0 violations vs pages with at least one violation"
          >
            {statusPieData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-body dark:text-gray-400 text-sm">
                No pages scanned yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusPieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--color-charcoal,#1F1F1F)', border: 'none', borderRadius: 12, color: '#F8F6F1', fontSize: 12 }}
                    formatter={(v, name) => [`${v} page${v !== 1 ? 's' : ''}`, name]}
                  />
                  <Legend iconType="circle" iconSize={8} formatter={(value) => <span style={{ color: '#4B5563', fontSize: 12 }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Task 5: Top Violating Pages — clickable ranked table */}
          <ChartCard
            title="Top Violating Pages"
            subtitle="Ranked by violation count — click any row to inspect"
          >
            <TopViolatingTable
              pages={topViolationPages}
              onRowClick={(p) => p._page && handleRowClick(p._page)}
            />
          </ChartCard>
        </div>

        {/* 5. ACCESSIBILITY INTELLIGENCE — Task 1 */}
        <CrawlIntelPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 6. REGRESSION DETECTION — Task 3 */}
        <CrawlRegressionPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 7. PAGE TRENDS — Feature 6 */}
        <PageTrendsPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 8. AI SUMMARY — Feature 2 */}
        <CrawlAISummaryPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 7. CONTROLS */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-body dark:text-gray-400 pointer-events-none" />
            <input
              type="text"
              className="input-base pl-9 py-2 text-sm w-full"
              placeholder="Search URLs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {['all', 'scanned', 'failed'].map((f) => (
              <FilterPill
                key={f}
                label={f.charAt(0).toUpperCase() + f.slice(1)}
                active={statusFilter === f}
                onClick={() => setStatusFilter(f)}
              />
            ))}
          </div>
          <button
            className="btn-secondary flex items-center gap-2 text-sm ml-auto"
            onClick={() => exportCSV(enrichedPages)}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        {/* 8. PAGES TABLE */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 dark:border-white/5">
                <tr>
                  <SortableHeader label="URL"        sortKey="url"        currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Score"      sortKey="score"      currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Violations" sortKey="violations" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status"     sortKey="status"     currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {filteredPages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-body dark:text-gray-400">
                      {pages.length === 0 ? 'No pages scanned yet.' : 'No pages match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredPages.map((page, idx) => (
                    <tr
                      key={page.url ?? idx}
                      className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(page)}
                    >
                      <td className="px-4 py-3 max-w-xs">
                        <span className="block truncate font-mono text-xs text-ink dark:text-white" title={page.url}>
                          {page.url}
                        </span>
                      </td>
                      <td className="px-4 py-3 min-w-[120px]">
                        <ScoreMiniBar score={page._score} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${page._violations > 0 ? 'text-coral' : 'text-sage'}`}>
                          {page._violations}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={page._status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight size={16} className="text-body dark:text-gray-400 inline" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredPages.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-white/5 text-xs text-body dark:text-gray-400">
              Showing {filteredPages.length} of {totalPages} pages
            </div>
          )}
        </div>
      </div>

      {/* 9. DETAILS DRAWER */}
      {selectedRow && (
        <DetailsDrawer
          row={{
            url: selectedRow.url,
            score: selectedRow._score,
            passRate: selectedRow.pass_rate,
            violationCount: selectedRow._violations,
            violations: drawerViolations,
            violationsLoading: drawerLoading,
            status: selectedRow._status,
            scanHistoryId: selectedRow.scan_history_id,
          }}
          onClose={handleCloseDrawer}
          onOpenFullReport={
            selectedRow.scan_history_id
              ? () => navigate('scan-history')
              : null
          }
        />
      )}
      {showShareModal && (
        <SendReportModal
          onClose={() => setShowShareModal(false)}
          defaultReportType="crawl_summary"
          context={{
            url:        job?.root_url || '',
            score:      avgScore,
            violations: totalViolations,
            pass_rate:  passRate,
            pages:      totalPages,
            reference:  crawlId,
          }}
        />
      )}
    </>
  );
}
