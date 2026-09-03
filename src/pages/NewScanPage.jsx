import { apiFetch } from '../utils/api';
import { useState, useCallback } from 'react';
import { Globe, Network, FileCode, Plus, X, Loader2, GitCompare, ShieldCheck, Upload, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import './NewScanPage.css';
import SingleScanForm from '../components/newscan/SingleScanForm';
import CrawlForm from '../components/newscan/CrawlForm';
import ScanProgress from '../components/newscan/ScanProgress';
import ScanResults from '../components/newscan/ScanResults';
import ScanComparisonView from '../components/newscan/ScanComparisonView';
import ADAResultsView from '../components/ADAResultsView/ADAResultsView';

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

const BEFORE_YOU_START = [
  { icon: Globe, title: 'Enter your website', body: 'Provide the full URL of the website you want to scan, including https://.' },
  { icon: CheckCircle2, title: 'Choose scan options', body: 'Pick Page audit for a single URL or Site crawl to check multiple pages at once.' },
  { icon: ShieldCheck, title: 'Review your results', body: "We'll scan your site and show a clear summary of issues, along with guidance to help you fix them." },
];

function ScanOptionCards({ activeId, onSelect }) {
  return (
    <div role="tablist" aria-label="Scan options" className="grid sm:grid-cols-3 gap-3 mb-6">
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
              'relative text-left rounded-2xl border-2 p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40',
              disabled
                ? 'border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02] cursor-not-allowed opacity-70'
                : isActive
                  ? 'border-teal bg-teal/5 dark:bg-teal/10'
                  : 'border-gray-200 dark:border-white/10 bg-white dark:bg-charcoal hover:border-teal/40',
            ].join(' ')}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${
              disabled ? 'bg-gray-100 dark:bg-white/5 text-gray-400' : 'bg-teal/10 text-teal'
            }`}>
              <Icon size={18} />
            </div>
            <p className="font-heading font-semibold text-sm text-ink dark:text-white mb-1">{label}</p>
            <p className="text-xs text-body dark:text-gray-400 leading-relaxed">{description}</p>
            {disabled ? (
              <span className="inline-block mt-3 text-[10px] font-semibold text-body dark:text-gray-400 bg-gray-200 dark:bg-white/10 px-2 py-1 rounded-full">
                Coming soon
              </span>
            ) : (
              <span
                aria-hidden="true"
                className={`absolute bottom-3 right-3 w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                  isActive ? 'border-teal bg-teal' : 'border-gray-300 dark:border-white/20'
                }`}
              >
                {isActive && <CheckCircle2 size={14} className="text-white" strokeWidth={3} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BeforeYouStart() {
  return (
    <aside className="w-full lg:w-72 flex-shrink-0 space-y-4">
      <div className="card p-5">
        <h2 className="font-heading font-semibold text-sm text-ink dark:text-white mb-4">Before you start</h2>
        <ol className="space-y-4">
          {BEFORE_YOU_START.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal/10 text-teal text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-white">
                    <Icon size={13} className="text-teal flex-shrink-0" /> {step.title}
                  </p>
                  <p className="text-xs text-body dark:text-gray-400 mt-0.5 leading-relaxed">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="alert-info">
        <span className="font-semibold flex-shrink-0">Tip:</span>
        <span>Start with a Page audit to get a quick result, then use Site crawl for a fuller picture.</span>
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
function ScanTabStrip({ tabs, activeId, onSelect, onClose, onNew, onCompare, compareEnabled }) {
  return (
    <div className="flex items-end gap-0.5 border-b border-gray-200 dark:border-white/10 mb-0 overflow-x-auto">
      {tabs.map(t => {
        const isActive = t.id === activeId;
        const label = sessionLabel(t.url);
        return (
          <button
            key={t.id}
            type="button"
            title={t.url}
            onClick={() => onSelect(t.id)}
            className={[
              'group relative flex items-center gap-2 pl-3 pr-2 py-2 text-[13px] font-medium whitespace-nowrap transition-colors flex-shrink-0 rounded-t-lg border',
              isActive
                ? 'bg-white dark:bg-charcoal text-ink dark:text-white border-gray-200 dark:border-white/10 border-b-white dark:border-b-charcoal -mb-px z-10'
                : 'bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-white border-transparent',
            ].join(' ')}
          >
            {t.phase === 'scanning' ? (
              <Loader2 size={11} className="animate-spin text-teal flex-shrink-0" />
            ) : (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                t.phase === 'failed' ? 'bg-coral' :
                (t.result?.axeResult?.violations?.length ?? 0) > 0 ? 'bg-amber' : 'bg-sage'
              }`} />
            )}
            <span className="max-w-[140px] truncate">{label}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClose(t.id); } }}
              className="ml-0.5 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-white/10 flex-shrink-0"
              aria-label={`Close ${label} tab`}
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        aria-label="New scan tab"
        title="New scan"
        className="flex items-center justify-center w-8 h-8 mb-0.5 rounded-lg text-gray-400 hover:text-teal hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors flex-shrink-0"
      >
        <Plus size={15} />
      </button>
      <div className="flex-1" />
      {compareEnabled && (
        <button
          type="button"
          onClick={onCompare}
          className="flex items-center gap-1.5 px-2.5 py-1.5 mb-1 rounded-lg text-[13px] font-medium text-body dark:text-gray-400 hover:text-ink dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors flex-shrink-0"
        >
          <GitCompare size={13} /> Compare Scans
        </button>
      )}
    </div>
  );
}

export default function NewScanPage() {
  const {
    navigate, setCrawlId,
    scanSessions, activeScanSessionId, setActiveScanSessionId, createScanSession, updateScanSession, closeScanSession,
  } = useApp();

  const [activeTab, setActiveTab] = useState('single');
  const [showUploadView, setShowUploadView] = useState(false);

  // Only the not-yet-started "new scan" form is local — once you hit Start Scan
  // it becomes a session in AppContext and survives from then on.
  const [formUrl, setFormUrl] = useState('');
  const [formIncludeBestPractices, setFormIncludeBestPractices] = useState(false);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareAId, setCompareAId] = useState(null);
  const [compareBId, setCompareBId] = useState(null);

  // crawl state (unaffected by this change — crawls already persist via crawlId)
  const [crawlUrl, setCrawlUrl]         = useState('');
  const [maxPages, setMaxPages]         = useState(50);
  const [maxDepth, setMaxDepth]         = useState(3);
  const [fullSite, setFullSite]         = useState(false);
  const [notifyEmail, setNotifyEmail]   = useState('');
  const [crawlLoading, setCrawlLoading] = useState(false);

  const activeSession = scanSessions.find(s => s.id === activeScanSessionId) ?? null;
  const doneSessions  = scanSessions.filter(s => s.phase === 'done');
  const showCompare   = compareOpen && doneSessions.length >= 2;

  const activeTabId = activeScanSessionId;

  const startNewScanTab = useCallback(() => {
    setCompareOpen(false);
    setActiveScanSessionId(null);
    setFormUrl('');
    setFormIncludeBestPractices(false);
  }, [setActiveScanSessionId]);

  const selectTab = useCallback((id) => {
    setCompareOpen(false);
    setActiveScanSessionId(id);
  }, [setActiveScanSessionId]);

  // Closing a tab falls back to another open one, or the blank form if it
  // was the last one left.
  const closeTab = useCallback((id) => {
    closeScanSession(id);
    if (activeScanSessionId === id) {
      const remaining = scanSessions.filter(s => s.id !== id);
      setActiveScanSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSessions, activeScanSessionId, closeScanSession, setActiveScanSessionId]);

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
        else if (s === 'failed') { clearInterval(iv); updateScanSession(sessionId, { phase: 'failed', error: 'Scan failed. Please check the URL and try again.' }); }
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
      if (!data.ok) { updateScanSession(sessionId, { phase: 'failed', error: data.message ?? 'Failed to start scan.' }); return; }
      pollScan(sessionId, data.jobId);
    } catch { updateScanSession(sessionId, { phase: 'failed', error: 'Network error. Please try again.' }); }
  }, [updateScanSession, pollScan]);

  const handleStartScan = useCallback(() => {
    const url = formUrl.trim();
    if (!url) return;
    const sessionId = createScanSession(url, formIncludeBestPractices);
    setFormUrl('');
    runScan(sessionId, url, formIncludeBestPractices);
  }, [formUrl, formIncludeBestPractices, createScanSession, runScan]);

  const retryScan = useCallback((session) => {
    updateScanSession(session.id, { phase: 'scanning', error: '' });
    runScan(session.id, session.url, session.includeBestPractices);
  }, [updateScanSession, runScan]);

  const handleStartCrawl = useCallback(async () => {
    const url = crawlUrl.trim();
    if (!url) return;
    setCrawlLoading(true);
    try {
      const res  = await apiFetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages, maxDepth, fullSite, notifyEmail: notifyEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { setCrawlLoading(false); return; }
      setCrawlId(data.crawl_id);
      navigate('crawl-results');
    } catch { setCrawlLoading(false); }
  }, [crawlUrl, maxPages, maxDepth, fullSite, notifyEmail, setCrawlId, navigate]);

  const result     = activeSession?.result ?? null;
  const violations = result?.axeResult?.violations ?? [];
  const incomplete = result?.axeResult?.incomplete  ?? [];
  const passes     = result?.axeResult?.passes      ?? [];
  const scanRan    = passes.length > 0 || violations.length > 0 || incomplete.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night">
      <div className="px-8 py-8 lg:px-12">

        <div className="mb-8">
          <h1 className="font-heading font-bold text-3xl text-ink dark:text-white mb-2">Start a new accessibility audit</h1>
          <p className="text-base text-body dark:text-gray-400">
            Enter a website URL and choose the type of accessibility check you want to run. We'll scan your site and give you clear, actionable results.
          </p>
        </div>

        {showUploadView ? (
          <ADAResultsView onClearResult={() => setShowUploadView(false)} />
        ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">

        <ScanOptionCards activeId={activeTab} onSelect={(id) => setActiveTab(id)} />

        {/* Single Page Scan */}
        {activeTab === 'single' && (
          <>
            {scanSessions.length > 0 && (
              <ScanTabStrip
                tabs={scanSessions}
                activeId={activeTabId}
                onSelect={selectTab}
                onClose={closeTab}
                onNew={startNewScanTab}
                onCompare={openCompare}
                compareEnabled={doneSessions.length >= 2}
              />
            )}

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

            {!showCompare && !activeSession && (
              <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
                <div className="px-6 py-5">
                  <SingleScanForm
                    scanUrl={formUrl}
                    onUrlChange={setFormUrl}
                    includeBestPractices={formIncludeBestPractices}
                    onBestPracticesChange={setFormIncludeBestPractices}
                    scanPhase="idle"
                    scanError=""
                    onStartScan={handleStartScan}
                  />
                  <button
                    type="button"
                    onClick={() => setShowUploadView(true)}
                    className="btn-secondary w-full justify-center mt-3 text-sm"
                  >
                    <Upload size={14} /> Upload JSON results
                  </button>
                  <p className="text-xs text-body dark:text-gray-500 text-center mt-3">
                    Your data is secure and never shared with third parties.
                  </p>
                </div>
              </div>
            )}

            {!showCompare && activeSession?.phase === 'scanning' && (
              <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
                <ScanProgress bare url={activeSession.url} />
              </div>
            )}

            {!showCompare && activeSession?.phase === 'failed' && (
              <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft px-6 py-5">
                <SingleScanForm
                  scanUrl={activeSession.url}
                  onUrlChange={() => {}}
                  includeBestPractices={activeSession.includeBestPractices}
                  onBestPracticesChange={() => {}}
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
                onReset={startNewScanTab}
                screenshot={result?.axeResult?.screenshot}
                screenshotType={result?.axeResult?.screenshotType}
                sessionId={activeSession.id}
              />
            )}
          </>
        )}

        {/* Site Crawl */}
        {activeTab === 'crawl' && (
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
            onStartCrawl={handleStartCrawl}
          />
        )}

        </div>
        {(activeTab === 'crawl' || (activeTab === 'single' && !activeSession && !showCompare)) && <BeforeYouStart />}
        </div>
        )}

      </div>
    </div>
  );
}
