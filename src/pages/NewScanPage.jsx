import { apiFetch } from '../utils/api';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Network, FileCode, Plus, X, Loader2, GitCompare, CheckCircle2, Check, Info, BarChart3, Pencil } from 'lucide-react';
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
  { icon: CheckCircle2, title: 'Choose scan options', body: 'Select the types of accessibility checks that match your goals.' },
  { icon: BarChart3, title: 'Review your results', body: "We'll scan your site and show a clear summary of issues, along with guidance to help you fix them." },
];

function ScanOptionCards({ activeId, onSelect }) {
  return (
    <div role="tablist" aria-label="Scan options" className="grid sm:grid-cols-3 gap-3">
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
              'relative text-left rounded-xl p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal/40',
              disabled
                ?'border-2 border-gray-200 bg-white cursor-not-allowed opacity-60'
                : isActive
                  ?'border-2 border-teal bg-teal/5'
                  :'border-2 border-gray-200 bg-white hover:border-teal/40',
            ].join(' ')}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-teal/10 text-teal">
              <Icon size={18} />
            </div>
            <p className="font-heading font-semibold text-sm text-ink mb-1">{label}</p>
            <p className="text-xs text-body leading-relaxed">{description}</p>
            {disabled ? (
              <span className="absolute bottom-3 right-3 text-[10px] font-semibold text-body bg-gray-100 px-2 py-0.5 rounded-full">
                Coming soon
              </span>
            ) : isActive ? (
              <span
                aria-hidden="true"
                className="absolute bottom-3 right-3 w-4 h-4 bg-teal rounded flex items-center justify-center"
              >
                <Check size={10} className="text-white" strokeWidth={3} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ─── Scan options section (mirrors the mockup: heading + description above
// the option cards, "coming soon" note below) — rendered inside whichever
// form card is currently active, between the URL field and its mode-specific
// settings, so it reads as one continuous card rather than a separate block. ──
function ScanOptionsSection({ activeId, onSelect }) {
  return (
    <div>
      <label className="text-sm font-semibold text-ink mb-1 block">
        Scan options <span className="text-coral">*</span>
      </label>
      <p className="text-xs text-body mb-3">Select the types of checks to include in your audit.</p>
      <ScanOptionCards activeId={activeId} onSelect={onSelect} />
      <p className="text-xs text-body mt-2 flex items-center gap-1">
        <Info size={12} className="text-gray-400 flex-shrink-0" />
        HTML validation will be available in a future release.
      </p>
    </div>
  );
}

function BeforeYouStart() {
  return (
    <aside className="w-full lg:w-80 flex-shrink-0 space-y-4">
      <div className="card p-5">
        <h2 className="font-heading font-semibold text-sm text-ink mb-4">Before you start</h2>
        <ol className="space-y-4">
          {BEFORE_YOU_START.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal/10 text-teal text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex gap-2 min-w-0">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Icon size={15} className="text-body" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">{step.title}</p>
                    <p className="text-xs text-body mt-0.5 leading-relaxed">{step.body}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="alert-info">
        <span className="font-semibold flex-shrink-0">Tip:</span>
        <span>Start with a Full page scan to get a complete overview, then dive deeper into specific checks.</span>
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
            ) : t.phase === 'draft' ? (
              <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
            ) : (
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                t.phase === 'failed' ? 'bg-coral' :
                (t.result?.axeResult?.violations?.length ?? 0) > 0 ? 'bg-amber' : 'bg-sage'
              }`} />
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
    navigate, setCrawlId,
    scanSessions, activeScanSessionId, setActiveScanSessionId, createScanSession, createDraftScanSession,
    updateScanSession, closeScanSession,
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
  const isDraftActive = activeSession?.phase === 'draft';

  // The compose form (URL + scan options) is shared by two states: the very
  // first visit, before any tab exists at all (backed by local formUrl state),
  // and an open "draft" tab (backed by that session itself) — letting several
  // draft tabs stay open at once, each keeping its own typed-but-unrun URL,
  // instead of there only ever being one shared blank form.
  const composeUrl = isDraftActive ? activeSession.url : formUrl;
  const composeBestPractices = isDraftActive ? activeSession.includeBestPractices : formIncludeBestPractices;
  const setComposeUrl = useCallback((val) => {
    if (isDraftActive) updateScanSession(activeSession.id, { url: val });
    else setFormUrl(val);
  }, [isDraftActive, activeSession, updateScanSession]);
  const setComposeBestPractices = useCallback((val) => {
    if (isDraftActive) updateScanSession(activeSession.id, { includeBestPractices: val });
    else setFormIncludeBestPractices(val);
  }, [isDraftActive, activeSession, updateScanSession]);

  const startNewScanTab = useCallback(() => {
    setCompareOpen(false);
    createDraftScanSession();
  }, [createDraftScanSession]);

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
    const url = composeUrl.trim();
    if (!url) return;
    if (isDraftActive) {
      // Convert this same draft tab in place — it keeps its id (and any custom
      // rename) rather than being replaced by a freshly created tab.
      updateScanSession(activeSession.id, { phase: 'scanning', url, includeBestPractices: composeBestPractices });
      runScan(activeSession.id, url, composeBestPractices);
    } else {
      const sessionId = createScanSession(url, composeBestPractices);
      setFormUrl('');
      runScan(sessionId, url, composeBestPractices);
    }
  }, [composeUrl, composeBestPractices, isDraftActive, activeSession, updateScanSession, createScanSession, runScan]);

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
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="px-8 py-8 lg:px-12">

        {activeTab === 'single' && scanSessions.length > 0 && !showUploadView && (
          <div className="mb-6">
            <ScanTabStrip
              tabs={scanSessions}
              activeId={activeTabId}
              onSelect={selectTab}
              onClose={closeTab}
              onNew={startNewScanTab}
              onCompare={openCompare}
              onRename={(id, name) => updateScanSession(id, { name })}
              compareEnabled={doneSessions.length >= 2}
            />
          </div>
        )}

        <div className="mb-8">
          <h1 className="font-heading font-bold text-3xl text-ink mb-2 leading-[1.2]">Start a new accessibility audit</h1>
          <p className="text-base text-body leading-[1.5] max-w-2xl">
            Enter a website URL and choose the type of accessibility check you want to run. We'll scan your site and give you clear, actionable results.
          </p>
        </div>

        {showUploadView ? (
          <ADAResultsView onClearResult={() => setShowUploadView(false)} />
        ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start max-w-5xl">
        <div className="flex-1 min-w-0 w-full">

        {/* Single Page Scan */}
        {activeTab === 'single' && (
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

        {/* Compose a new audit — one stable card shared by both Page audit and
            Site crawl. The URL field and Scan Options stay in the same place
            in the tree when switching tabs (only the tail below them swaps),
            so React reuses the DOM nodes instead of unmounting the whole card
            — that unmount/remount was what caused a visible "shake" before. */}
        {((activeTab === 'single' && !showCompare && (!activeSession || isDraftActive)) || activeTab === 'crawl') && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
            <section>
              <label htmlFor="scan-url" className="text-sm font-semibold text-ink mb-1 block">
                {activeTab === 'crawl' ? 'Root URL' : 'Website URL'} <span className="text-coral">*</span>
              </label>
              <input
                id="scan-url"
                type="url"
                value={activeTab === 'crawl' ? crawlUrl : composeUrl}
                onChange={e => (activeTab === 'crawl' ? setCrawlUrl : setComposeUrl)(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  if (activeTab === 'crawl') { if (!crawlLoading && crawlUrl.trim()) handleStartCrawl(); }
                  else if (composeUrl.trim()) handleStartScan();
                }}
                placeholder="https://example.com"
                disabled={activeTab === 'crawl' && crawlLoading}
                className="w-full border-2 border-teal rounded-lg px-4 py-2.5 text-sm text-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal/20 focus:ring-offset-1 transition-shadow disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </section>

            <div className="border-t border-gray-100" />

            <ScanOptionsSection activeId={activeTab} onSelect={setActiveTab} />

            <div className="border-t border-gray-100" />

            {activeTab === 'single' ? (
              <SingleScanForm
                scanUrl={composeUrl}
                onUrlChange={setComposeUrl}
                includeBestPractices={composeBestPractices}
                onBestPracticesChange={setComposeBestPractices}
                scanPhase="idle"
                scanError=""
                onStartScan={handleStartScan}
                onUploadClick={() => setShowUploadView(true)}
                hideUrlField
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
                onStartCrawl={handleStartCrawl}
                hideUrlField
              />
            )}
          </div>
        )}

        </div>
        {(activeTab === 'crawl' || (activeTab === 'single' && !activeSession && !showCompare)) && <BeforeYouStart />}
        </div>
        )}

      </div>
    </div>
  );
}
