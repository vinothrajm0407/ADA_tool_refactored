import { apiFetch } from '../../utils/api';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, AlertTriangle, RotateCcw, Monitor, Search, History, Play, Loader2, AlertCircle, X, ChevronDown, ChevronRight } from 'lucide-react';
import ViolationRow from './ViolationList';
import IncompleteList from './IncompleteList';
import ScreenshotModal from './ScreenshotModal';
import AssistiveTestDropdown from './AssistiveTestDropdown';
import AssistiveResultView, { MODULE_LABELS } from '../assistive/AssistiveResultView';
import {
  nsComputeScore, nsScoreGradeInfo, nsScoreMessage,
  nsBuildSeverityBreakdown, nsBuildTopIssues, nsTotalElementCount,
  NS_SEVERITY_ROWS, NS_IMPACT_FILTER, SEV_COLORS,
  nsGroupByArea,
  loadPrevScan, saveScanSummary,
  p4riskLevel, p4wcagLabel, p4wcagLevel,
  p4loadVpResults, p4saveVpResults, P4_VIEWPORTS,
} from './scanUtils';
import { useApp } from '../../context/AppContext';
import ScoreRing from '../ui/ScoreRing';

// Inline results for tests started from AssistiveTestDropdown — one collapsible
// card per module that's running/finished/errored, right on the scan results view.
function AssistiveResultsPanel({ sessionId }) {
  const { scanSessions, updateSessionAssistive } = useApp();
  const session = scanSessions.find(s => s.id === sessionId);
  const assistiveState = session?.assistiveState ?? {};
  const entries = Object.entries(assistiveState);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      {entries.map(([moduleId, state]) => (
        <div key={moduleId} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
            <span className="font-heading font-semibold text-sm text-ink">
              {MODULE_LABELS[moduleId] ?? moduleId}
            </span>
            <div className="flex items-center gap-3">
              {state.status === 'running' && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal">
                  <Loader2 size={13} className="animate-spin" /> Running…
                </span>
              )}
              {state.status === 'error' && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-coral">
                  <AlertCircle size={13} /> {state.error}
                </span>
              )}
              <button type="button" onClick={() => updateSessionAssistive(sessionId, moduleId, undefined)}
                className="text-gray-400 hover:text-ink">
                <X size={14} />
              </button>
            </div>
          </div>
          {state.status === 'done' && (
            <div className="p-5">
              <AssistiveResultView result={state.result} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const HERO_BTN = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-solid border-white/20 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

function StatTile({ value, label, tone, onClick, ...rest }) {
  const inner = (
    <>
      <p className={`font-heading font-bold text-3xl leading-none m-0 tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-body mt-1.5 mb-0 font-medium">{label}</p>
    </>
  );
  const cls = 'rounded-xl bg-white px-4 py-4 text-center shadow-sm';
  return onClick
    ? <button type="button" onClick={onClick} {...rest} className={`${cls} border-0 hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

// ─── Count-up animation hook ─────────────────────────────────────────────────

function useCountUp(target, duration = 550) {
  const [count, setCount] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || target === 0) { setCount(target); return; }
    setCount(0);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return count;
}

// ─── Scan comparison card ────────────────────────────────────────────────────

function ScanComparison({ currentScore, currentTotal, scanUrl, prevScan }) {
  if (!prevScan) return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-heading font-semibold text-base leading-none text-ink">Comparison</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-body bg-gray-100 px-2 py-0.5 rounded-full">No prior scan</span>
      </div>
      <p className="text-sm text-body leading-relaxed">
        After fixing accessibility issues and re-scanning, improvement metrics will appear here automatically.
      </p>
    </div>
  );
  const violDiff  = currentTotal - prevScan.totalViolations;
  const scoreDiff = currentScore - prevScan.score;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-heading font-semibold text-base leading-none text-ink">Comparison</span>
        {prevScan.url && prevScan.url !== scanUrl && (
          <span className="text-[10px] text-body font-mono truncate max-w-[180px]"title={prevScan.url}>
            vs {prevScan.url}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body mb-2">Previous</p>
          <p className="text-2xl font-heading font-bold text-body">{prevScan.totalViolations}</p>
          <p className="text-[11px] text-body mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body mt-1">{prevScan.score}/100</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <p className={`text-2xl font-heading font-bold ${violDiff < 0 ?'text-sage': violDiff > 0 ?'text-coral':'text-body'}`}>
            {violDiff > 0 ? '+' : ''}{violDiff}
          </p>
          <p className="text-[10px] text-body">violations</p>
          <p className={`text-xs font-semibold ${scoreDiff > 0 ?'text-teal': scoreDiff < 0 ?'text-coral':'text-body'}`}>
            {scoreDiff !== 0 ? `${scoreDiff > 0 ? '+' : ''}${scoreDiff} score` : 'No change'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body mb-2">Current</p>
          <p className="text-2xl font-heading font-bold text-ink">{currentTotal}</p>
          <p className="text-[11px] text-body mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body mt-1">{currentScore}/100</p>
        </div>
      </div>
      {violDiff < 0 && (
        <div className="mt-4 flex items-center gap-2 bg-teal/5 border border-teal/15 rounded-xl px-4 py-2.5">
          <span className="text-teal font-bold text-sm">↑</span>
          <p className="text-sm text-teal font-medium">
            {Math.abs(violDiff)} fewer violation{Math.abs(violDiff) !== 1 ? 's' : ''} since last scan
          </p>
        </div>
      )}
      {violDiff > 0 && (
        <div className="mt-4 flex items-center gap-2 bg-coral/5 border border-coral/15 rounded-xl px-4 py-2.5">
          <span className="text-coral font-bold text-sm">↓</span>
          <p className="text-sm text-coral font-medium">
            {violDiff} more violation{violDiff !== 1 ? 's' : ''} than last scan — review recent changes
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Issue navigator sidebar ─────────────────────────────────────────────────

function IssueNavigator({ sevBreak, totalViolations, onNavigate }) {
  if (totalViolations === 0) return null;
  return (
    <nav aria-label="Issue navigator"className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-body mb-3">Navigate</p>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => onNavigate('all')}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs hover:bg-teal/5 transition-colors text-left"
        >
          <span className="font-semibold text-ink">All Issues</span>
          <span className="font-bold text-body">{totalViolations}</span>
        </button>
        {NS_SEVERITY_ROWS.map(({ key, label, dot }) => {
          const count = sevBreak[key] || 0;
          if (!count) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs hover:bg-gray-50 transition-colors text-left"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <span className="flex-1 text-body">{label}</span>
              <span className="font-bold text-ink">{count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Viewport comparison panel ───────────────────────────────────────────────

function ViewportComparisonPanel({ scanUrl, currentViolations }) {
  const currentScore = nsComputeScore(currentViolations);
  const currentTotal = currentViolations.length;

  const [vpResults, setVpResults] = useState(() => p4loadVpResults(scanUrl));
  const [scanning, setScanning]   = useState(null);

  const pollJob = (jobId) => new Promise((resolve) => {
    const iv = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/scan/${jobId}`);
        const d = await r.json();
        const s = d.job?.status;
        if (s === 'completed' || s === 'failed') {
          clearInterval(iv);
          resolve(s === 'completed' ? (d.job?.result ?? null) : null);
        }
      } catch { clearInterval(iv); resolve(null); }
    }, 2500);
  });

  const runScan = async (vp) => {
    if (!scanUrl) return;
    setScanning(vp.id);
    try {
      const res  = await apiFetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanUrl, includeBestPractices: false }),
      });
      const data = await res.json();
      if (!data.ok) { setScanning(null); return; }
      const result = await pollJob(data.jobId);
      if (result) {
        const viol    = result?.axeResult?.violations ?? [];
        const updated = { ...(vpResults || {}), [vp.id]: { violations: viol.length, score: nsComputeScore(viol) } };
        setVpResults(updated);
        p4saveVpResults(scanUrl, updated);
      }
    } catch {}
    setScanning(null);
  };

  const rows = P4_VIEWPORTS.map(vp => ({
    ...vp,
    isBase: vp.id === 'desktop',
    data:   vp.id === 'desktop' ? { violations: currentTotal, score: currentScore } : (vpResults?.[vp.id] ?? null),
  }));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-teal flex-shrink-0" />
          <span className="font-heading font-semibold text-base leading-none text-ink">Viewport Comparison</span>
        </div>
        <span className="text-[10px] font-semibold text-body bg-gray-100 px-2 py-0.5 rounded-full">Beta</span>
      </div>
      <p className="text-xs text-body mb-4 leading-relaxed">
        Run independent scans per viewport to detect responsive layout differences.
      </p>
      <div className="space-y-2">
        {rows.map(vp => (
          <div key={vp.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
            <div className="w-16 flex-shrink-0">
              <p className="text-xs font-semibold text-ink">{vp.label}</p>
              <p className="text-[10px] text-body">{vp.width}px</p>
            </div>
            {vp.data ? (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-ink">{vp.data.violations}</span>
                <span className="text-xs text-body truncate">violations · {vp.data.score}/100</span>
                {!vp.isBase && vp.data.violations !== currentTotal && (
                  <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${vp.data.violations > currentTotal ? 'text-coral bg-coral/10' : 'text-sage bg-sage/10'}`}>
                    {vp.data.violations > currentTotal ? '+' : ''}{vp.data.violations - currentTotal}
                  </span>
                )}
                {vp.isBase && <span className="ml-auto text-[10px] font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-full flex-shrink-0">Current</span>}
                {!vp.isBase && vp.data.violations === currentTotal && (
                  <span className="ml-auto text-[10px] text-body flex-shrink-0">No diff</span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => runScan(vp)}
                disabled={!!scanning}
                className="flex-1 flex items-center gap-1.5 text-xs text-teal font-semibold hover:text-teal/80 disabled:opacity-50 transition-colors"
              >
                {scanning === vp.id
                  ? <><span className="w-3 h-3 border border-teal/40 border-t-teal rounded-full animate-spin flex-shrink-0" />Scanning {vp.label}…</>
                  : <>+ Scan {vp.label}</>
                }
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main scan results view ──────────────────────────────────────────────────

export default function ScanResults({ violations, passes, incomplete = [], scanRan, scanUrl, onReset, screenshot, screenshotType, sessionId }) {
  const { navigate } = useApp();
  const [filterImpact, setFilterImpact] = useState('all');
  const [pageScreenshotOpen, setPageScreenshotOpen] = useState(false);
  const hasPageScreenshot = typeof screenshot === 'string' && screenshot.trim().length > 0;
  const pageScreenshotType = (typeof screenshotType === 'string' && screenshotType.trim()) || 'image/jpeg';
  const [groupMode, setGroupMode]       = useState('rule');
  const [searchQuery, setSearchQuery]   = useState('');
  const [wcagFilter, setWcagFilter]     = useState('all');
  const savedRef = useRef(false);
  const [appeared, setAppeared]           = useState(false);
  const [highlightSection, setHighlight]  = useState(null);
  const hlTimerRef                        = useRef(null);

  // Element count (one per affected node), not rule count — matches how axe
  // DevTools' own "Total Issues" tallies (a single rule violated by 7
  // elements reads as 7, not 1).
  const violCount       = useCountUp(nsTotalElementCount(violations));
  const passCount       = useCountUp(passes.length);
  const [showIncomplete, setShowIncomplete] = useState(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setAppeared(true); return; }
    const t = setTimeout(() => setAppeared(true), 40);
    return () => clearTimeout(t);
  }, []);

  const score     = nsComputeScore(violations);
  const gradeInfo = nsScoreGradeInfo(score);
  const sevBreak  = nsBuildSeverityBreakdown(violations);
  const risk      = p4riskLevel(score, sevBreak);
  const wcagLabel = p4wcagLabel(violations);
  const sevTotal  = NS_SEVERITY_ROWS.reduce((n, { key }) => n + (sevBreak[key] || 0), 0);
  const topIssues = nsBuildTopIssues(violations);
  const maxCount  = topIssues.length > 0 ? topIssues[0].count : 1;

  const [prevScan, setPrevScan] = useState(null);

  // Load previous scan: localStorage fast path, DB fallback for first-session visits
  useEffect(() => {
    if (!scanUrl) return;
    const cached = loadPrevScan(scanUrl);
    if (cached) { setPrevScan(cached); return; }
    apiFetch(`/api/history/prev-scan?url=${encodeURIComponent(scanUrl)}`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.scan) setPrevScan(d.scan); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!savedRef.current && scanRan) {
      savedRef.current = true;
      saveScanSummary(scanUrl, { url: scanUrl, score, totalViolations: violations.length, sevBreak });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredViolations = filterImpact === 'all'
    ? violations
    : violations.filter(v => (v.impact || 'minor').toLowerCase() === filterImpact);

  const searchFiltered = searchQuery.trim()
    ? filteredViolations.filter(v => {
        const q = searchQuery.toLowerCase();
        return (
          (v.help        || '').toLowerCase().includes(q) ||
          (v.id          || '').toLowerCase().includes(q) ||
          (v.description || '').toLowerCase().includes(q)
        );
      })
    : filteredViolations;

  // Worst first, then by how many elements are affected — so the top of the list is what to fix first.
  const SEV_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const finalViolations = [...(wcagFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter(v => p4wcagLevel(v) === wcagFilter))]
    .sort((a, b) =>
      (SEV_ORDER[(a.impact || 'minor').toLowerCase()] ?? 3) - (SEV_ORDER[(b.impact || 'minor').toLowerCase()] ?? 3)
      || (b.nodes?.length ?? 0) - (a.nodes?.length ?? 0));

  const impactCount = (imp) => violations.filter(v => (v.impact || 'minor').toLowerCase() === imp).length;

  const scrollToSection = useCallback((id, key) => {
    if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
    setHighlight(key);
    hlTimerRef.current = setTimeout(() => setHighlight(null), 1600);
  }, []);

  const scrollToViolation = (ruleId) => {
    setFilterImpact('all');
    setTimeout(() => {
      document.getElementById(`nsvi-${ruleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleNavigate = (key) => {
    setFilterImpact(key);
    setSearchQuery('');
    setWcagFilter('all');
    setTimeout(() => {
      document.getElementById('ns-violations-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    setHighlight('violations');
    hlTimerRef.current = setTimeout(() => setHighlight(null), 1600);
  };

  const areaGroups = groupMode === 'area' ? nsGroupByArea(finalViolations) : [];
  const hasActiveFilter = filterImpact !== 'all' || searchQuery.trim() || wcagFilter !== 'all';

  return (
    <div className={`space-y-4 transition-all duration-300 ${appeared ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}>

      {/* Main content — fades in + drifts up as reveal card fades out */}
      <div className="space-y-4">

      {/* Report hero: where the scan stands at a glance */}
      <section aria-label="Scan summary" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-900 via-teal-800 to-teal text-white p-6 lg:p-8 shadow-glow">
        <div aria-hidden="true" className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/15 rounded-full px-3 py-1">
                <CheckCircle className="w-3.5 h-3.5" /> Scan complete
              </span>
              <a href={scanUrl} target="_blank" rel="noreferrer" className="block mt-3 text-base lg:text-lg font-heading font-semibold text-white hover:underline break-all max-w-2xl">
                {scanUrl}
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasPageScreenshot && (
                <button type="button" onClick={() => setPageScreenshotOpen(true)} className={HERO_BTN}>
                  <Monitor className="w-3.5 h-3.5" /> View screenshot
                </button>
              )}
              <button type="button" onClick={onReset} className={HERO_BTN}>
                <RotateCcw className="w-3.5 h-3.5" /> Scan another
              </button>
              <button type="button" onClick={() => navigate('scan-history')} className={HERO_BTN}>
                <History className="w-3.5 h-3.5" /> View history
              </button>
            </div>
          </div>

          {scanRan ? (
            <div className="mt-7 grid lg:grid-cols-[auto_1fr] gap-8 items-center">
              <div className="flex items-center gap-5">
                <ScoreRing value={score} />
                <div className="min-w-0 max-w-[220px]">
                  <p className="font-heading text-xl font-bold m-0">Grade {gradeInfo.grade}</p>
                  <p className="text-sm text-white/80 mt-1 mb-2 leading-snug">{nsScoreMessage(score)}</p>
                  <span className="inline-block text-[11px] font-semibold bg-white/15 rounded-full px-2.5 py-1">{risk.level} risk · {wcagLabel}</span>
                </div>
              </div>

              <div>
                <div className="grid gap-3 grid-cols-2">
                  <StatTile
                    value={violCount} label="Violations" tone="text-coral-700"
                    onClick={violations.length > 0 ? () => scrollToSection('ns-violations-section', 'violations') : undefined}
                    aria-label={`${nsTotalElementCount(violations)} violations`}
                  />
                  <StatTile value={passCount} label="Passed" tone="text-sage-700" />
                </div>

                {sevTotal > 0 && (
                  <div className="mt-4">
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-white/15" role="img"
                      aria-label={NS_SEVERITY_ROWS.map(({ key, label }) => `${label} ${sevBreak[key] || 0}`).join(', ')}>
                      {NS_SEVERITY_ROWS.map(({ key }) => (sevBreak[key] || 0) > 0 && (
                        <div key={key} style={{ width: `${((sevBreak[key] || 0) / sevTotal) * 100}%`, background: SEV_COLORS[key] }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-white/90">
                      {NS_SEVERITY_ROWS.map(({ key, label }) => (sevBreak[key] || 0) > 0 && (
                        <span key={key} className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: SEV_COLORS[key] }} />
                          {label} <strong className="font-semibold">{sevBreak[key]}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 bg-white/95 text-amber-800 px-4 py-3 rounded-xl mt-6">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed m-0">
                Axe returned no data — the page may have blocked the scanner (bot protection, CSP, or login required).
              </p>
            </div>
          )}

          {scanRan && (
            <div className="mt-6 bg-white/10 rounded-xl px-4 py-3 text-sm">
              <span className="text-[11px] font-bold uppercase tracking-widest text-white/70 mr-2">Start here</span>
              {risk.action}
            </div>
          )}
        </div>
      </section>

      {scanRan && (
        <ScanComparison
          currentScore={score}
          currentTotal={violations.length}
          scanUrl={scanUrl}
          prevScan={prevScan}
        />
      )}

      {scanRan && (
        <ViewportComparisonPanel scanUrl={scanUrl} currentViolations={violations} />
      )}

      {/* Top Issues */}
      {topIssues.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <p className="font-heading font-semibold text-base text-ink mb-4">Top Issues</p>
          <div className="space-y-2">
            {topIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => scrollToViolation(issue.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-teal/5 transition-colors text-left"
              >
                <span className="flex-1 text-sm font-medium text-ink truncate min-w-0">{issue.title}</span>
                <span className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                  <span className="block h-full bg-teal rounded-full" style={{ width: `${Math.round((issue.count / maxCount) * 100)}%` }} />
                </span>
                <span className="text-xs font-bold text-coral flex-shrink-0 min-w-[20px] text-right">{issue.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Violations + Issue Navigator sidebar */}
      {violations.length > 0 && (
        <div id="ns-violations-section" className="flex gap-4 items-start">
          <div className={`flex-1 min-w-0 bg-white rounded-2xl border p-6 transition-all duration-500 ${
            highlightSection === 'violations'
              ?'border-teal/40 ring-1 ring-teal/20'
              :'border-gray-100'
          }`}>

            {/* Header row */}
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <p className="font-heading font-semibold text-base text-ink">
                Violations{' '}
                <span className="text-sm font-normal text-body">
                  ({finalViolations.length}{hasActiveFilter ? ` of ${violations.length}` : ''})
                </span>
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search violations…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-7 pr-3 py-1 text-xs rounded-lg border border-gray-200 bg-white text-ink placeholder-gray-400 focus:outline-none focus:border-teal w-36 transition-colors"
                  />
                </div>
                {['all', 'A', 'AA', 'BP'].map(lvl => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setWcagFilter(wcagFilter === lvl ? 'all' : lvl)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      wcagFilter === lvl
                        ? 'bg-teal text-white border-teal'
                        :'border-gray-200 text-body hover:border-teal/50'
                    }`}
                  >
                    {lvl === 'all' ? 'WCAG: All' : lvl === 'BP' ? 'Best Practice' : `WCAG ${lvl}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Group toggle + impact pills */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                <button
                  type="button"
                  onClick={() => setGroupMode('rule')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode ==='rule'?'bg-white text-teal':'text-body hover:text-ink'}`}
                >
                  By Rule
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('area')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode ==='area'?'bg-white text-teal':'text-body hover:text-ink'}`}
                >
                  By Area
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFilterImpact('all')}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filterImpact ==='all'?'bg-ink text-white border-ink':'border-gray-200 text-body hover:border-gray-400'}`}
              >
                All
              </button>
              {NS_IMPACT_FILTER.map((imp) => {
                const count = impactCount(imp);
                if (count === 0) return null;
                const activeStyle = { critical: 'bg-coral text-white border-coral', serious: 'bg-terracotta text-white border-terracotta', moderate: 'bg-amber text-white border-amber', minor: 'bg-sage text-white border-sage' }[imp];
                const idleStyle   = { critical: 'text-coral border-coral/30 hover:border-coral', serious: 'text-terracotta border-terracotta/30 hover:border-terracotta', moderate: 'text-amber border-amber/30 hover:border-amber', minor: 'text-sage border-sage/30 hover:border-sage' }[imp];
                return (
                  <button key={imp} type="button" onClick={() => setFilterImpact(filterImpact === imp ? 'all' : imp)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filterImpact === imp ? activeStyle : idleStyle}`}>
                    {imp.charAt(0).toUpperCase() + imp.slice(1)} · {count}
                  </button>
                );
              })}
            </div>

            {/* Violation list */}
            {finalViolations.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-body">No violations match your filters.</p>
                {hasActiveFilter && (
                  <button type="button" onClick={() => { setFilterImpact('all'); setSearchQuery(''); setWcagFilter('all'); }}
                    className="mt-2 text-xs text-teal hover:underline">Clear all filters</button>
                )}
              </div>
            ) : groupMode === 'area' ? (
              <div className="space-y-5">
                {areaGroups.map(({ area, violations: aViolations }) => (
                  <div key={area}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-body">{area}</p>
                      <span className="text-[10px] font-semibold text-body bg-gray-100 px-1.5 py-0.5 rounded-full">{aViolations.length}</span>
                    </div>
                    <div className="space-y-2">
                      {aViolations.map((v, i) => (
                        <div key={v.id ?? i} id={`nsvi-${v.id ?? i}`}>
                          <ViolationRow violation={v} pageUrl={scanUrl} sessionId={sessionId} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {finalViolations.map((v, i) => (
                  <div key={v.id ?? i} id={`nsvi-${v.id ?? i}`}>
                    <ViolationRow violation={v} pageUrl={scanUrl} sessionId={sessionId} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sticky issue navigator — lg screens only */}
          <div className="hidden lg:block w-48 flex-shrink-0 sticky top-4 self-start">
            <IssueNavigator
              sevBreak={sevBreak}
              totalViolations={violations.length}
              onNavigate={handleNavigate}
            />
          </div>
        </div>
      )}

      {/* Run Assistive Test CTA */}
      {scanRan && scanUrl && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-heading font-semibold text-sm text-ink mb-0.5">Deepen your audit</p>
              <p className="text-xs text-body">Check keyboard navigation, color contrast, and more with Assistive Testing.</p>
            </div>
            <AssistiveTestDropdown scanUrl={scanUrl} sessionId={sessionId} />
          </div>
          <AssistiveResultsPanel sessionId={sessionId} />
        </div>
      )}

      {/* Needs manual review — axe's "incomplete" results: not a confirmed
          violation, but axe couldn't automatically tell pass from fail (e.g.
          a contrast check it can't resolve), so a human needs to look.
          Previously captured by the backend but never shown here at all. */}
      {incomplete.length > 0 && (
        <div id="ns-incomplete-section" className={`bg-white rounded-2xl border p-5 transition-colors ${highlightSection === 'incomplete' ? 'border-amber ring-2 ring-amber/30' : 'border-gray-100'}`}>
          <button type="button" onClick={() => setShowIncomplete((p) => !p)} aria-expanded={showIncomplete}
            className="w-full flex items-center gap-1.5 text-left bg-transparent border-none p-0 cursor-pointer font-[inherit]">
            <span className="flex-shrink-0 text-body">{showIncomplete ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
            <span className="font-heading font-semibold text-base text-ink">Needs manual review ({incomplete.length})</span>
          </button>
          <p className="text-xs text-body mt-1.5 ml-5.5">Axe couldn't automatically confirm these pass or fail — a quick manual check is needed.</p>
          {showIncomplete && <IncompleteList incomplete={incomplete} />}
        </div>
      )}

      {/* All clear */}
      {violations.length === 0 && scanRan && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-8 h-8 text-teal" />
          </div>
          <p className="font-heading font-bold text-2xl text-ink mb-3">Excellent accessibility</p>
          <div className={`inline-flex items-baseline gap-1.5 rounded-full px-5 py-2 mb-5 ${gradeInfo.badgeCls}`}>
            <span className="font-heading font-bold text-3xl">{score}</span>
            <span className="text-sm opacity-70">/ 100 · Grade {gradeInfo.grade}</span>
          </div>
          <p className="text-sm text-body max-w-sm mx-auto leading-relaxed mb-6">
            No accessibility violations detected.{passes.length > 0 ? ` ${passes.length} rules passed.` : ''}{' '}
            Automated tools catch ~35% of WCAG issues — manual testing is still recommended.
          </p>
          <div className="inline-flex items-center gap-2 bg-teal/5 border border-teal/15 rounded-xl px-4 py-2.5 text-sm text-teal font-medium">
            Continue monitoring accessibility as your site evolves
          </div>
        </div>
      )}

      </div>{/* end main content wrapper */}

      {pageScreenshotOpen && hasPageScreenshot && (
        <ScreenshotModal
          src={`data:${pageScreenshotType};base64,${screenshot.trim()}`}
          title="Page as tested"
          onClose={() => setPageScreenshotOpen(false)}
        />
      )}
    </div>
  );
}
