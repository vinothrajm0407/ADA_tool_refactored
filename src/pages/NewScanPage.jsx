import { apiFetch } from '../utils/api';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Network, FileCode, Plus, X, Loader2, GitCompare, Check, BarChart3, Pencil, ArrowRight, ShieldCheck, Clock, Wrench, Lock, Upload, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';
import './NewScanPage.css';
import SingleScanForm from '../components/newscan/SingleScanForm';
import CrawlForm from '../components/newscan/CrawlForm';
import ScanProgress from '../components/newscan/ScanProgress';
import ScanResults from '../components/newscan/ScanResults';
import ScanComparisonView from '../components/newscan/ScanComparisonView';
import ADAResultsView from '../components/ADAResultsView/ADAResultsView';
import CrawlResultsPage from './CrawlResultsPage';
import { nsFriendlyScanError } from '../components/newscan/scanUtils';

const TABS = [
  {
    id: 'single', label: 'Page audit', icon: Globe,
    description: 'Scan a single page at the URL you provide.',
  },
  {
    id: 'crawl', label: 'Site crawl', icon: Network,
    description: 'Scan multiple pages starting from a URL, up to a page and depth limit you set.',
  },
  {
    id: 'html', label: 'HTML validation', icon: FileCode, disabled: true,
    description: 'Validate raw HTML against accessibility standards.',
  },
];

const HOW_IT_WORKS = [
  { icon: Globe, title: 'Enter your website', body: 'Paste the full URL, including https://.' },
  { icon: SlidersHorizontal, title: 'Pick the audit type', body: 'One page for a quick check, or crawl the whole site.' },
  { icon: BarChart3, title: 'Review and fix', body: 'Get a clear list of issues, with guidance and Auto-Fix to resolve them.' },
];

const STANDARDS = ['WCAG 2.0 A/AA', 'WCAG 2.1 A/AA', 'ARIA', 'Color contrast', 'Forms & labels', 'Keyboard access'];

function ScanOptionCards({ activeId, onSelect }) {
  return (
    <div role="tablist" aria-label="Audit type" className="grid sm:grid-cols-3 gap-3">
      {TABS.map(({ id, label, description, icon: Icon, disabled }) => {
        const isActive = activeId === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => !disabled && onSelect(id)}
            className={[
              'relative text-left rounded-xl p-4 border border-solid transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal/40',
              disabled
                ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                : isActive
                  ? 'border-teal bg-teal/5 ring-1 ring-teal shadow-soft'
                  : 'border-gray-200 bg-white hover:border-teal/50 hover:shadow-soft',
            ].join(' ')}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${isActive ? 'bg-teal text-white' : 'bg-teal/10 text-teal'}`}>
              <Icon size={19} />
            </div>
            <p className="font-heading font-semibold text-sm text-ink mt-0 mb-1">{label}</p>
            <p className="text-xs text-body mt-0 mb-0 leading-relaxed">{description}</p>
            {disabled ? (
              <span className="absolute top-3 right-3 text-[10px] font-semibold text-body bg-gray-200/70 px-2 py-0.5 rounded-full">
                Coming soon
              </span>
            ) : isActive ? (
              <span aria-hidden="true" className="absolute top-3 right-3 w-5 h-5 bg-teal rounded-full flex items-center justify-center">
                <Check size={12} className="text-white" strokeWidth={3} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="w-full lg:w-80 flex-shrink-0 space-y-4">
      <div className="card p-6">
        <h2 className="font-heading font-semibold text-sm text-ink mt-0 mb-5">How it works</h2>
        <ol className="relative space-y-6">
          <span aria-hidden="true" className="absolute left-[15px] top-4 bottom-4 w-px bg-gray-200" />
          {HOW_IT_WORKS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative flex gap-4">
                <span className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-teal text-white flex items-center justify-center shadow-sm">
                  <Icon size={14} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-semibold text-ink m-0">{i + 1}. {step.title}</p>
                  <p className="text-xs text-body mt-0.5 mb-0 leading-relaxed">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="card p-6">
        <h2 className="font-heading font-semibold text-sm text-ink mt-0 mb-3">What we check</h2>
        <div className="flex flex-wrap gap-2">
          {STANDARDS.map(s => (
            <span key={s} className="text-xs font-medium text-teal-800 bg-teal/10 rounded-full px-3 py-1">{s}</span>
          ))}
        </div>
        <p className="text-xs text-body mt-4 mb-0 leading-relaxed">
          Powered by axe-core, the same engine as axe DevTools, so results match what your team sees in the browser.
        </p>
      </div>
    </aside>
  );
}

// Prefer the last path segment (distinguishes multiple scans on the same host,
// e.g. two GitHub Pages projects) and fall back to the hostname for root URLs.
function sessionLabel(url) {
  if (!url) return 'Scan';
  try {
    const u = new URL(url);
    const segment = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
    return segment || u.hostname || url;
  } catch { return url; }
}

// Browser-style tabs across the top of Single Page Scan — one per scan
// you've started — switching to another sidebar section and back, or between
// tabs, doesn't lose results or an Auto-Fix run in progress; a tab only
// disappears when explicitly closed. The active tab's white background sits
// flush against the panel below it (no bottom border, pulled down 1px over
// the shelf line) so it reads as one continuous surface, the way browser
// tabs attach to their page.
function ScanTabStrip({ tabs, activeId, onSelect, onClose, onNew, onCompare, onRename, compareEnabled }) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingId) editInputRef.current?.select();
  }, [editingId]);

  const startEditing = (t, e) => {
    e.stopPropagation();
    setEditingId(t.id);
    setDraftName(t.name || sessionLabel(t.url));
  };

  const commitEdit = () => {
    const name = draftName.trim();
    if (name && editingId) onRename(editingId, name);
    setEditingId(null);
  };

  return (
    <div role="tablist" aria-label="Open scans" className="flex items-center gap-1 border-b border-gray-200 mb-0 overflow-x-auto">
      {tabs.map(t => {
        const isActive = t.id === activeId;
        const label = t.name || (t.url ? sessionLabel(t.url) : 'New scan');
        const isEditing = editingId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={t.url}
            onClick={() => onSelect(t.id)}
            className={[
              // The global `button { border: none }` reset (index.css) sets border-width
              // to its initial value ("medium", ~3px) and relies on border-style:none to
              // force it invisible — so border-solid alone would make ALL four sides
              // visible at that default width, not just the bottom. Zero the other three
              // explicitly rather than relying on utility source-order to break the tie.
              'group relative flex items-center gap-2 px-4 py-3 text-base font-medium whitespace-nowrap transition-colors flex-shrink-0 border-t-0 border-l-0 border-r-0 border-b-2 border-solid -mb-px',
              isActive
                ? 'text-teal-800 font-semibold border-teal'
                : 'text-gray-500 hover:text-ink border-transparent',
            ].join(' ')}
          >
            {t.phase === 'scanning' ? (
              <Loader2 size={13} className="animate-spin text-teal flex-shrink-0" />
            ) : (
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                t.phase === 'failed' ? 'bg-coral' :
                (t.violationsCount ?? t.result?.axeResult?.violations?.length ?? 0) > 0 ? 'bg-amber' : 'bg-sage'
              }`} />
            )}
            {t.kind === 'crawl' && (
              <Network size={12} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
            )}
            {isEditing ? (
              <input
                ref={editInputRef}
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                }}
                className="max-w-[180px] w-32 bg-teal/5 border border-teal/30 rounded px-1 -my-0.5 text-base font-medium text-ink focus:outline-none focus:ring-1 focus:ring-teal/40"
              />
            ) : (
              <span className="max-w-[180px] truncate">{label}</span>
            )}
            {isActive && !isEditing && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => startEditing(t, e)}
                onKeyDown={(e) => { if (e.key === 'Enter') startEditing(t, e); }}
                className="p-0.5 rounded-full text-gray-300 hover:text-teal hover:bg-teal/10 flex-shrink-0 transition-colors"
                aria-label={`Rename ${label} tab`}
                title="Rename"
              >
                <Pencil size={13} />
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClose(t.id); } }}
              className="ml-0.5 p-0.5 rounded-full text-gray-300 hover:text-coral hover:bg-coral/10 flex-shrink-0 transition-colors"
              aria-label={`Close ${label} tab`}
            >
              <X size={14} />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        aria-label="New scan tab"
        title="New scan"
        className="flex items-center gap-1.5 px-4 py-2 my-2 rounded-full text-base font-medium text-teal bg-teal/10 hover:bg-teal/15 transition-colors flex-shrink-0"
      >
        <Plus size={16} /> New scan
      </button>
      <div className="flex-1" />
      {compareEnabled && (
        <button
          type="button"
          onClick={onCompare}
          className="flex items-center gap-1.5 px-4 py-2 my-2 rounded-full border border-gray-200 text-base font-medium text-body hover:text-ink hover:border-teal/40 hover:bg-teal/5 transition-colors flex-shrink-0"
        >
          <GitCompare size={15} /> Compare Scans
        </button>
      )}
    </div>
  );
}

export default function NewScanPage() {
  const {
    scanSessions, createScanSession, updateScanSession, closeScanSession,
    crawlSessions, createCrawlSession, updateCrawlSession, retargetCrawlSession, closeCrawlSession,
  } = useApp();

  // Which single tab (scan or crawl) is currently shown. null means "no tab
  // selected" — the blank compose form below is shown instead. This is the
  // one thing that decides what's on screen; it replaces the old page-wide
  // Page-audit/Site-crawl mode switch, which hid a whole type's tabs whenever
  // you were looking at the other type.
  const [focusedTab, setFocusedTab] = useState(null); // { kind: 'single'|'crawl', id } | null
  // Which form the blank compose card shows — only matters while focusedTab is null.
  const [activeTab, setActiveTab] = useState('single');
  const [showUploadView, setShowUploadView] = useState(false);

  // Blank compose form fields — local until Start Scan/Crawl turns them into
  // a real tab in AppContext.
  const [formUrl, setFormUrl] = useState('');
  const [formIncludeBestPractices, setFormIncludeBestPractices] = useState(false);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState(null);
  const [compareBId, setCompareBId] = useState(null);

  const [crawlUrl, setCrawlUrl]         = useState('');
  const [maxPages, setMaxPages]         = useState(50);
  const [maxDepth, setMaxDepth]         = useState(3);
  const [fullSite, setFullSite]         = useState(false);
  const [notifyEmail, setNotifyEmail]   = useState('');
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlError, setCrawlError]     = useState('');

  // One combined, chronologically-ordered tab strip across both scan and crawl tabs.
  const combinedTabs = [
    ...scanSessions.map(s => ({ ...s, kind: 'single' })),
    ...crawlSessions.map(s => ({ ...s, kind: 'crawl' })),
  ].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const activeSession = focusedTab?.kind === 'single' ? scanSessions.find(s => s.id === focusedTab.id) ?? null : null;
  const activeCrawlSession = focusedTab?.kind === 'crawl' ? crawlSessions.find(s => s.id === focusedTab.id) ?? null : null;
  const doneSessions  = scanSessions.filter(s => s.phase === 'done');
  const showCompare   = compareOpen && doneSessions.length >= 2;

  const composeUrl = formUrl;
  const composeBestPractices = formIncludeBestPractices;
  const setComposeUrl = setFormUrl;
  const setComposeBestPractices = setFormIncludeBestPractices;

  const startNewTab = useCallback(() => {
    setCompareOpen(false);
    setFocusedTab(null);
    setActiveTab('single');
  }, []);

  const selectTab = useCallback((t) => {
    setCompareOpen(false);
    setFocusedTab({ kind: t.kind, id: t.id });
  }, []);

  // Closing a tab falls back to the next-most-recent remaining tab (of either
  // kind), or the blank compose form if it was the last one left.
  const closeTab = useCallback((t) => {
    if (t.kind === 'single') closeScanSession(t.id);
    else closeCrawlSession(t.id);
    setFocusedTab(prev => {
      if (!prev || prev.id !== t.id) return prev;
      const remaining = combinedTabs.filter(x => x.id !== t.id);
      const next = remaining[remaining.length - 1];
      return next ? { kind: next.kind, id: next.id } : null;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedTabs, closeScanSession, closeCrawlSession]);

  const openCompare = useCallback(() => {
    const [first, second] = doneSessions.slice(-2);
    setCompareAId(first?.id ?? null);
    setCompareBId(second?.id ?? first?.id ?? null);
    setCompareOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSessions]);

  const pollScan = useCallback((sessionId, jobId) => {
    const iv = setInterval(async () => {
      try {
        const res  = await apiFetch(`/api/scan/${jobId}`);
        const data = await res.json();
        if (!data.ok) { clearInterval(iv); updateScanSession(sessionId, { phase: 'failed', error: 'Could not retrieve scan status.' }); return; }
        const s = data.job?.status;
        if (s === 'completed') { clearInterval(iv); updateScanSession(sessionId, { phase: 'done', result: data.job?.result ?? null }); }
        else if (s === 'failed') { clearInterval(iv); updateScanSession(sessionId, { phase: 'failed', error: nsFriendlyScanError(data.job?.failure_reason) }); }
      } catch { clearInterval(iv); updateScanSession(sessionId, { phase: 'failed', error: 'Network error while polling scan status.' }); }
    }, 2500);
  }, [updateScanSession]);

  const runScan = useCallback(async (sessionId, url, includeBestPractices) => {
    try {
      const res  = await apiFetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, includeBestPractices }),
      });
      const data = await res.json();
      if (!data.ok) { updateScanSession(sessionId, { phase: 'failed', error: data.error ?? 'Failed to start scan.' }); return; }
      pollScan(sessionId, data.jobId);
    } catch { updateScanSession(sessionId, { phase: 'failed', error: 'Network error. Please try again.' }); }
  }, [updateScanSession, pollScan]);

  const handleStartScan = useCallback(() => {
    const url = composeUrl.trim();
    if (!url) return;
    const sessionId = createScanSession(url, composeBestPractices);
    setFormUrl('');
    setFocusedTab({ kind: 'single', id: sessionId });
    runScan(sessionId, url, composeBestPractices);
  }, [composeUrl, composeBestPractices, createScanSession, runScan]);

  const retryScan = useCallback((session) => {
    updateScanSession(session.id, { phase: 'scanning', error: '' });
    runScan(session.id, session.url, session.includeBestPractices);
  }, [updateScanSession, runScan]);

  const handleStartCrawl = useCallback(async () => {
    const url = crawlUrl.trim();
    if (!url) return;
    setCrawlLoading(true);
    setCrawlError('');
    try {
      const res  = await apiFetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages, maxDepth, fullSite, notifyEmail: notifyEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { setCrawlLoading(false); setCrawlError(data.error || 'Failed to start crawl.'); return; }
      createCrawlSession(data.crawl_id, url);
      setCrawlLoading(false);
      setCrawlUrl('');
      setFocusedTab({ kind: 'crawl', id: data.crawl_id });
    } catch { setCrawlLoading(false); setCrawlError('Network error. Please try again.'); }
  }, [crawlUrl, maxPages, maxDepth, fullSite, notifyEmail, createCrawlSession]);

  const result     = activeSession?.result ?? null;
  const violations = result?.axeResult?.violations ?? [];
  const incomplete = result?.axeResult?.incomplete  ?? [];
  const passes     = result?.axeResult?.passes      ?? [];
  const scanRan    = passes.length > 0 || violations.length > 0 || incomplete.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="px-8 py-8 lg:px-12">

        {combinedTabs.length > 0 && !showUploadView && (
          <div className="mb-6">
            <ScanTabStrip
              tabs={combinedTabs}
              activeId={focusedTab?.id ?? null}
              onSelect={(id) => selectTab(combinedTabs.find(t => t.id === id))}
              onClose={(id) => closeTab(combinedTabs.find(t => t.id === id))}
              onNew={startNewTab}
              onCompare={openCompare}
              onRename={(id, name) => {
                const t = combinedTabs.find(x => x.id === id);
                if (!t) return;
                if (t.kind === 'single') updateScanSession(id, { name });
                else updateCrawlSession(id, { name });
              }}
              compareEnabled={doneSessions.length >= 2}
            />
          </div>
        )}

        {(focusedTab || showCompare || showUploadView) && (
          <div className="mb-8">
            <h1 className="font-heading font-bold text-3xl text-ink mb-2 leading-[1.2]">Accessibility audit</h1>
            <p className="text-base text-body leading-[1.5] max-w-2xl">
              Review your results below, or start a new audit from the tab bar.
            </p>
          </div>
        )}

        {!focusedTab && !showCompare && !showUploadView && (
          <section aria-label="Start an audit" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-900 via-teal-800 to-teal text-white p-8 lg:p-10 mb-6 shadow-glow max-w-6xl">
            <div aria-hidden="true" className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden="true" className="absolute -bottom-28 -left-10 w-72 h-72 rounded-full bg-teal-300/20 blur-3xl" />
            <div className="relative">
              <h1 className="font-heading font-bold text-3xl lg:text-4xl leading-[1.15] max-w-2xl !text-white m-0">
                Find and fix accessibility issues in minutes
              </h1>
              <p className="text-base text-white/80 mt-3 mb-0 max-w-2xl leading-relaxed">
                Enter a website address. We&apos;ll check it against WCAG and show you exactly what to fix.
              </p>

              <div className="mt-7 flex items-center gap-2 bg-white rounded-2xl p-2 shadow-lg ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-teal-300 max-w-3xl">
                <Globe size={20} className="ml-3 text-teal flex-shrink-0" aria-hidden="true" />
                <input
                  id="scan-url"
                  type="url"
                  aria-label={activeTab === 'crawl' ? 'Root URL' : 'Website URL'}
                  value={activeTab === 'crawl' ? crawlUrl : composeUrl}
                  onChange={e => {
                    if (activeTab === 'crawl') { setCrawlUrl(e.target.value); setCrawlError(''); }
                    else setComposeUrl(e.target.value);
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    if (activeTab === 'crawl') { if (!crawlLoading && crawlUrl.trim()) handleStartCrawl(); }
                    else if (composeUrl.trim()) handleStartScan();
                  }}
                  placeholder="https://example.com"
                  disabled={activeTab === 'crawl' && crawlLoading}
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none px-2 py-3 text-base text-ink placeholder-gray-400 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={activeTab === 'crawl' ? handleStartCrawl : handleStartScan}
                  disabled={activeTab === 'crawl' ? (crawlLoading || !crawlUrl.trim()) : !composeUrl.trim()}
                  className="btn-primary !px-6 !py-3 !rounded-xl text-sm flex-shrink-0"
                >
                  {activeTab === 'crawl' && crawlLoading
                    ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting…</>
                    : <>{activeTab === 'crawl' ? 'Start crawl' : 'Run audit'} <ArrowRight size={15} /></>}
                </button>
              </div>

              {activeTab === 'crawl' && crawlError && (
                <p role="alert" className="mt-3 inline-flex items-center gap-2 bg-white/95 text-coral-700 text-sm font-medium px-3 py-2 rounded-lg">
                  <AlertTriangle size={14} className="flex-shrink-0" /> {crawlError}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/80">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} /> WCAG 2.0 &amp; 2.1</span>
                <span className="inline-flex items-center gap-1.5"><Clock size={14} /> Usually 1–2 minutes</span>
                <span className="inline-flex items-center gap-1.5"><Wrench size={14} /> Auto-Fix ready</span>
                <span className="inline-flex items-center gap-1.5"><Lock size={14} /> Your data is never shared</span>
                {activeTab === 'single' && (
                  <button type="button" onClick={() => setShowUploadView(true)} className="inline-flex items-center gap-1.5 underline underline-offset-2 hover:text-white ml-auto">
                    <Upload size={13} /> Upload JSON results
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {showUploadView ? (
          <ADAResultsView onClearResult={() => setShowUploadView(false)} />
        ) : (
        <div className={`flex flex-col lg:flex-row gap-6 items-start ${!focusedTab && !showCompare ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <div className="flex-1 min-w-0 w-full">

        {/* Single Page Scan */}
        {(activeSession || showCompare) && (
          <>
            {showCompare && (
              <ScanComparisonView
                sessions={doneSessions}
                sessionA={doneSessions.find(s => s.id === compareAId) ?? doneSessions[0]}
                sessionB={doneSessions.find(s => s.id === compareBId) ?? doneSessions[1] ?? doneSessions[0]}
                onChangeA={setCompareAId}
                onChangeB={setCompareBId}
                onClose={() => setCompareOpen(false)}
              />
            )}

            {!showCompare && activeSession?.phase === 'scanning' && (
              <div className="bg-white rounded-xl border border-gray-100">
                <ScanProgress bare url={activeSession.url} />
              </div>
            )}

            {!showCompare && activeSession?.phase === 'failed' && (
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <SingleScanForm
                  scanUrl={activeSession.url}
                  onUrlChange={(val) => updateScanSession(activeSession.id, { url: val })}
                  includeBestPractices={activeSession.includeBestPractices}
                  onBestPracticesChange={(val) => updateScanSession(activeSession.id, { includeBestPractices: val })}
                  scanPhase="failed"
                  scanError={activeSession.error}
                  onStartScan={() => retryScan(activeSession)}
                />
              </div>
            )}

            {!showCompare && activeSession?.phase === 'done' && (
              <ScanResults
                violations={violations}
                incomplete={incomplete}
                passes={passes}
                scanRan={scanRan}
                scanUrl={activeSession.url}
                onReset={startNewTab}
                screenshot={result?.axeResult?.screenshot}
                screenshotType={result?.axeResult?.screenshotType}
                sessionId={activeSession.id}
              />
            )}
          </>
        )}

        {/* Compose a new audit — one stable card shared by both Page audit and
            Site crawl. The URL field and Scan Options stay in the same place
            in the tree when switching tabs (only the tail below them swaps),
            so React reuses the DOM nodes instead of unmounting the whole card
            — that unmount/remount was what caused a visible "shake" before. */}
        {activeCrawlSession && (
          <CrawlResultsPage
            crawlId={activeCrawlSession.id}
            onStatusChange={(j) => updateCrawlSession(activeCrawlSession.id, {
              phase: j?.status === 'failed' ? 'failed' : (j?.status === 'running' || j?.status === 'pending' ? 'scanning' : 'done'),
            })}
            onRecrawl={(newId) => {
              retargetCrawlSession(activeCrawlSession.id, newId);
              setFocusedTab({ kind: 'crawl', id: newId });
            }}
          />
        )}

        {!focusedTab && !showCompare && (
          <div className="card p-6 space-y-6">
            <section>
              <h2 className="font-heading font-semibold text-base text-ink m-0">Choose your audit type</h2>
              <p className="text-xs text-body mt-1 mb-4">Pick how much of your site to check.</p>
              <ScanOptionCards activeId={activeTab} onSelect={setActiveTab} />
            </section>

            <section>
              <h2 className="font-heading font-semibold text-base text-ink mt-0 mb-3">Options</h2>
              {activeTab === 'single' ? (
                <SingleScanForm
                  scanUrl={composeUrl}
                  onUrlChange={setComposeUrl}
                  includeBestPractices={composeBestPractices}
                  onBestPracticesChange={setComposeBestPractices}
                  scanPhase="idle"
                  scanError=""
                  onStartScan={handleStartScan}
                  hideUrlField
                  hideActions
                />
              ) : (
                <CrawlForm
                  crawlUrl={crawlUrl}
                  onUrlChange={setCrawlUrl}
                  maxPages={maxPages}
                  onMaxPagesChange={setMaxPages}
                  maxDepth={maxDepth}
                  onMaxDepthChange={setMaxDepth}
                  fullSite={fullSite}
                  onFullSiteChange={setFullSite}
                  notifyEmail={notifyEmail}
                  onNotifyEmailChange={setNotifyEmail}
                  crawlLoading={crawlLoading}
                  crawlError={crawlError}
                  onStartCrawl={handleStartCrawl}
                  hideUrlField
                  hideActions
                />
              )}
            </section>
          </div>
        )}

        </div>
        {!focusedTab && !showCompare && <Sidebar />}
        </div>
        )}

      </div>
    </div>
  );
}
