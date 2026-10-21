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
  Loader2,
  Printer,
} from 'lucide-react';
import SendReportModal from '../components/integrations/SendReportModal';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/ui/StatusBadge';
import MetricCard from '../components/ui/MetricCard';
import { ChartCard } from '../components/ui/ChartCard';
import DetailsDrawer from '../components/ui/DetailsDrawer';
import CrawlIntelPanel from '../components/crawl/CrawlIntelPanel';
import CrawlRegressionPanel from '../components/crawl/CrawlRegressionPanel';
import CrawlAISummaryPanel from '../components/crawl/CrawlAISummaryPanel';
import PageTrendsPanel from '../components/crawl/PageTrendsPanel';
import ScoreRing from '../components/ui/ScoreRing';


const HERO_BTN = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-solid border-white/20 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

const FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'issues', label: 'With issues' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Failed to scan' },
];

function verdictFor(score) {
  return score >= 80 ? { label: 'Good', text: 'Most pages pass. Keep an eye on new pages.' }
    : score >= 60 ? { label: 'Fair', text: 'Some pages have real barriers — start with the worst ones.' }
    : { label: 'Needs work', text: 'Many pages fail. Start with the pages listed under "Fix these first".' };
}

function StatTile({ value, label }) {
  return (
    <div className="rounded-xl bg-white px-4 py-4 text-center shadow-sm">
      <p className="font-heading font-bold text-3xl leading-none m-0 tabular-nums text-ink">{value}</p>
      <p className="text-xs text-body mt-1.5 mb-0 font-medium">{label}</p>
    </div>
  );
}

function pathOf(url = '') {
  try { const u = new URL(url); return { host: u.hostname, path: (u.pathname + u.search) || '/' }; }
  catch { return { host: '', path: url }; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// "scanned" only means the scan ran — a page that still has violations hasn't passed.
export function normaliseStatus(raw, violations = 0) {
  if (!raw) return 'Needs review';
  const s = raw.toLowerCase();
  if (s === 'passed' || s === 'pass' || s === 'scanned' || s === 'completed') return violations > 0 ? 'Has issues' : 'Passed';
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
      className="px-4 py-3 text-left text-xs font-semibold text-body uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          size={13}
          className={active ?'text-teal':'text-gray-300'}
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
      <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: colour }}
        />
      </div>
      <span className="text-xs font-semibold text-ink w-7 text-right">
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
          :'bg-gray-100 text-body hover:bg-gray-200'
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
      <div className="flex items-center justify-center h-48 text-body text-sm">
        No violations found across scanned pages
      </div>
    );
  }
  const max = pages[0]?.violations ?? 1;
  return (
    <div className="divide-y divide-gray-50">
      {pages.map((p, idx) => {
        const pct = max > 0 ? Math.round((p.violations / max) * 100) : 0;
        const scoreColor = p._score >= 80 ? '#0F766E' : p._score >= 60 ? '#F59E0B' : '#E76F51';
        return (
          <button
            key={p.url}
            onClick={() => onRowClick && onRowClick(p)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="text-[11px] font-mono text-body w-5 flex-shrink-0">
              #{idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-ink truncate"title={p.url}>
                {p.name || p.url}
              </p>
              <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
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
            <ChevronRight size={14} className="text-body flex-shrink-0"/>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
// `crawlId`/`onStatusChange`/`onRecrawl` are only passed when rendered inline
// as a tab's content (see NewScanPage's CrawlTabStrip) — omitting them keeps
// this working exactly as before as the standalone /crawl-results page (deep
// links from Slack/Teams, "View" from Scan History's Crawls tab), driven by
// the single global crawlId in context instead of a per-tab one.
export default function CrawlResultsPage({ crawlId: crawlIdProp, onStatusChange, onRecrawl } = {}) {
  const { crawlId: contextCrawlId, setCrawlId, navigate, setPendingScanHistoryTab } = useApp();
  const crawlId = crawlIdProp ?? contextCrawlId;

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
  const [sortKey, setSortKey] = useState('violations');
  const [sortDir, setSortDir] = useState('desc');
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
      onStatusChange?.(j);
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
      onStatusChange?.(j);
    }, 2500);
    return () => clearInterval(pollRef.current);
  }, [polling, fetchJob, fetchPages]);

  // ---- row click + violation fetch ----------------------------------------
  async function handleRowClick(page) {
    setSelectedRow(page);
    setDrawerViolations(null);
    setDrawerLoading(true);

    // Crawled pages keep their own stored result (scan_history_id is empty for them).
    if (page.id != null && crawlId) {
      try {
        const res = await apiFetch(`/api/crawl/${crawlId}/pages/${page.id}/result`);
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
        // In tab mode, re-target this same tab at the fresh crawl instead of
        // the single global crawlId (which isn't what this tab is tracking).
        if (onRecrawl) onRecrawl(data.crawl_id);
        else setCrawlId(data.crawl_id);
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
    _status: normaliseStatus(p.status, violationCount(p)),
  }));

  const filteredPages = enrichedPages
    .filter((p) => {
      const matchSearch =
        !searchQuery || (p.url && p.url.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'issues' && p._violations > 0) ||
        (statusFilter === 'passed' && p._violations === 0 && p._status !== 'Failed') ||
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
  const filterCounts = { all: totalPages, issues: failingPages, passed: passingPages, failed: errorPages };
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
      name: (p.url || '').replace(/^https?:\/\/[^/]+/, '') || '/',
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
      <div className="flex-1 overflow-auto bg-ivory p-6 flex items-center justify-center">
        <div className="card p-10 max-w-md w-full text-center space-y-4">
          <Globe className="w-12 h-12 text-teal mx-auto" />
          <h2 className="font-heading text-2xl text-ink">No crawl selected</h2>
          <p className="text-body text-sm">
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
      <div className="flex-1 overflow-auto bg-ivory p-6 space-y-6">
        <div className="h-10 w-64 bg-gray-200 rounded-2xl animate-pulse"/>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <MetricCard key={i} loading />)}
        </div>
        <div className="h-64 bg-gray-200 rounded-2xl animate-pulse"/>
      </div>
    );
  }

  // ---- main render ---------------------------------------------------------
  return (
    <>
      <div className="flex-1 overflow-auto bg-ivory p-6 space-y-6">

        {/* BACK LINK */}
        <button onClick={goToCrawlHistory} className="inline-flex items-center gap-1 text-sm text-body hover:text-teal transition-colors -mb-2">
          <ChevronLeft size={15} /> Crawl history
        </button>

        {/* HERO: where the crawl stands */}
        <section aria-label="Crawl summary" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-900 via-teal-800 to-teal text-white p-6 lg:p-8 shadow-glow">
          <div aria-hidden="true" className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/15 rounded-full px-3 py-1">
                  {isActive ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Crawling…</>
                    : isComplete ? <><CheckCircle className="w-3.5 h-3.5" /> Crawl complete</>
                    : <><AlertTriangle className="w-3.5 h-3.5" /> Crawl {job?.status ?? 'ended'}</>}
                </span>
                {jobUrl && (
                  <a href={jobUrl} target="_blank" rel="noreferrer" className="block mt-3 text-base lg:text-lg font-heading font-semibold text-white hover:underline break-all max-w-2xl">
                    {jobUrl}
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isActive && (
                  <button onClick={handleStop} disabled={stopLoading} title="Stop this crawl — pages already scanned will be saved" className={HERO_BTN}>
                    <OctagonX size={14} /> {stopLoading ? 'Stopping…' : 'Stop crawl'}
                  </button>
                )}
                {isComplete && (
                  <button onClick={() => { setCrawlId(crawlId); navigate('executive-summary'); }} title="Open printable executive summary" className={HERO_BTN}>
                    <Printer size={14} /> Executive report
                  </button>
                )}
                {isComplete && (
                  <button onClick={() => setShowShareModal(true)} title="Send report to Slack or Teams" className={HERO_BTN}>
                    <Share2 size={14} /> Share
                  </button>
                )}
                {job?.root_url && !isActive && (
                  <button onClick={handleReCrawl} disabled={reCrawlLoading} title="Start a new crawl of this site" className={HERO_BTN}>
                    <RefreshCw size={14} className={reCrawlLoading ? 'animate-spin' : ''} /> {reCrawlLoading ? 'Starting…' : 'Re-crawl'}
                  </button>
                )}
              </div>
            </div>

            {isActive && (
              <div className="mt-6 bg-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>Crawl in progress</span><span className="tabular-nums">{progressPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/20 overflow-hidden mt-2" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${progressPct}%` }} />
                </div>
                <p className="text-xs text-white/80 mt-2 mb-0">
                  Discovered {job?.total_discovered ?? 0} · Scanned {job?.total_scanned ?? 0} · Failed {job?.total_failed ?? 0}. Results below update as pages finish.
                </p>
              </div>
            )}

            {totalPages > 0 && (
              <div className="mt-7 grid lg:grid-cols-[auto_1fr] gap-8 items-center">
                <div className="flex items-center gap-5">
                  <ScoreRing value={avgScore} />
                  <div className="min-w-0 max-w-[220px]">
                    <p className="font-heading text-xl font-bold m-0">{verdictFor(avgScore).label}</p>
                    <p className="text-sm text-white/80 mt-1 mb-0 leading-snug">{verdictFor(avgScore).text}</p>
                    <p className="text-[11px] text-white/60 mt-2 mb-0">Average score across all pages</p>
                  </div>
                </div>
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatTile value={job?.max_pages && job.max_pages <= 500 ? `${totalPages}/${job.max_pages}` : totalPages} label="Pages scanned" />
                    <StatTile value={totalViolations} label="Total violations" />
                    <StatTile value={failingPages} label="Pages with issues" />
                    <StatTile value={`${passRate}%`} label="Pages passing" />
                  </div>
                  <div className="mt-4">
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-white/15" role="img"
                      aria-label={`${passingPages} passing, ${failingPages} with issues, ${errorPages} failed to scan`}>
                      {passingPages > 0 && <div style={{ width: `${(passingPages / totalPages) * 100}%`, background: '#6ee7b7' }} />}
                      {failingPages > 0 && <div style={{ width: `${(failingPages / totalPages) * 100}%`, background: '#fca5a5' }} />}
                      {errorPages > 0 && <div style={{ width: `${(errorPages / totalPages) * 100}%`, background: '#d1d5db' }} />}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-white/90">
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#6ee7b7' }} />Passing <strong className="font-semibold">{passingPages}</strong></span>
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#fca5a5' }} />With issues <strong className="font-semibold">{failingPages}</strong></span>
                      {errorPages > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: '#d1d5db' }} />Failed to scan <strong className="font-semibold">{errorPages}</strong></span>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* FIX THESE FIRST */}
        {topViolationPages.length > 0 && (
          <ChartCard
            title="Fix these first"
            subtitle="Pages with the most violations. Click a page to see what's wrong."
          >
            <TopViolatingTable
              pages={topViolationPages}
              onRowClick={(p) => p._page && handleRowClick(p._page)}
            />
          </ChartCard>
        )}

        {/* 5. ACCESSIBILITY INTELLIGENCE — Task 1 */}
        <CrawlIntelPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 6. REGRESSION DETECTION — Task 3 */}
        <CrawlRegressionPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 7. PAGE TRENDS — Feature 6 */}
        <PageTrendsPanel crawlId={crawlId} isComplete={isComplete} />

        {/* 8. AI SUMMARY — Feature 2 */}
        <CrawlAISummaryPanel crawlId={crawlId} isComplete={isComplete} />

        {/* ALL PAGES */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-body pointer-events-none"/>
            <label className="sr-only" htmlFor="crawl-search">Search pages by URL</label>
            <input
              id="crawl-search"
              type="text"
              className="input-base pl-9 py-2 text-sm w-full"
              placeholder="Search pages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ id, label }) => (
              <FilterPill
                key={id}
                label={`${label} · ${filterCounts[id]}`}
                active={statusFilter === id}
                onClick={() => setStatusFilter(id)}
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
              <thead className="border-b border-gray-100">
                <tr>
                  <SortableHeader label="URL"        sortKey="url"        currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Score"      sortKey="score"      currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Violations" sortKey="violations" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status"     sortKey="status"     currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredPages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-body">
                      {pages.length === 0 ? 'No pages scanned yet.' : 'No pages match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredPages.map((page, idx) => (
                    <tr
                      key={page.url ?? idx}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(page)}
                    >
                      <td className="px-4 py-3 max-w-sm">
                        <span className="block truncate text-sm font-medium text-ink" title={page.url}>
                          {pathOf(page.url).path}
                        </span>
                        <span className="block truncate text-xs text-body">{pathOf(page.url).host}</span>
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
                        <ChevronRight size={16} className="text-body inline"/>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredPages.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 text-xs text-body">
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
