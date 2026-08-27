import { apiFetch } from '../../utils/api';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, AlertTriangle, RotateCcw, Monitor, Shield, Search, History, Play } from 'lucide-react';
import ViolationRow from './ViolationList';
import ScreenshotModal from './ScreenshotModal';
import {
  nsComputeScore, nsScoreGradeInfo, nsScoreMessage,
  nsBuildSeverityBreakdown, nsBuildTopIssues,
  NS_SEVERITY_ROWS, NS_IMPACT_FILTER, SEV_COLORS,
  nsGroupByArea, buildDonutPaths,
  loadPrevScan, saveScanSummary,
  p4riskLevel, p4wcagLabel, p4wcagLevel,
  p4loadVpResults, p4saveVpResults, P4_VIEWPORTS,
} from './scanUtils';
import { useApp } from '../../context/AppContext';

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

// ─── Severity donut chart ────────────────────────────────────────────────────

function SeverityDonut({ sevBreak }) {
  const { paths, total } = buildDonutPaths(sevBreak);
  if (total === 0) return (
    <p className="text-sm text-sage font-semibold text-center py-4">No violations found</p>
  );
  return (
    <div className="flex items-center gap-5 mt-1">
      <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0" role="img" aria-label="Severity distribution donut chart">
        {paths.map(p => <path key={p.key} d={p.d} fill={p.fill} />)}
        <text x="50" y="46" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor" className="text-ink dark:text-white">{total}</text>
        <text x="50" y="59" textAnchor="middle" fontSize="8" fill="currentColor" className="text-body dark:text-gray-400">issues</text>
      </svg>
      <div className="flex-1 space-y-2.5">
        {NS_SEVERITY_ROWS.map(({ key, label, sublabel }) => {
          const count = sevBreak[key] || 0;
          if (!count) return null;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SEV_COLORS[key] }} />
                  <span className="text-xs text-ink dark:text-white font-medium">{label}</span>
                  <span className="text-[10px] text-body dark:text-gray-500">{sublabel}</span>
                </div>
                <span className="text-xs font-bold text-ink dark:text-white">{count}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden ml-3.5">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: SEV_COLORS[key] }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scan comparison card ────────────────────────────────────────────────────

function ScanComparison({ currentScore, currentTotal, scanUrl, prevScan }) {
  if (!prevScan) return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-heading font-semibold text-base leading-none text-ink dark:text-white">Comparison</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">No prior scan</span>
      </div>
      <p className="text-sm text-body dark:text-gray-400 leading-relaxed">
        After fixing accessibility issues and re-scanning, improvement metrics will appear here automatically.
      </p>
    </div>
  );
  const violDiff  = currentTotal - prevScan.totalViolations;
  const scoreDiff = currentScore - prevScan.score;
  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-heading font-semibold text-base leading-none text-ink dark:text-white">Comparison</span>
        {prevScan.url && prevScan.url !== scanUrl && (
          <span className="text-[10px] text-body dark:text-gray-500 font-mono truncate max-w-[180px]" title={prevScan.url}>
            vs {prevScan.url}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">Previous</p>
          <p className="text-2xl font-heading font-bold text-body dark:text-gray-300">{prevScan.totalViolations}</p>
          <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body dark:text-gray-500 mt-1">{prevScan.score}/100</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <p className={`text-2xl font-heading font-bold ${violDiff < 0 ? 'text-sage' : violDiff > 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>
            {violDiff > 0 ? '+' : ''}{violDiff}
          </p>
          <p className="text-[10px] text-body dark:text-gray-500">violations</p>
          <p className={`text-xs font-semibold ${scoreDiff > 0 ? 'text-teal' : scoreDiff < 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>
            {scoreDiff !== 0 ? `${scoreDiff > 0 ? '+' : ''}${scoreDiff} score` : 'No change'}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">Current</p>
          <p className="text-2xl font-heading font-bold text-ink dark:text-white">{currentTotal}</p>
          <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body dark:text-gray-500 mt-1">{currentScore}/100</p>
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
    <nav aria-label="Issue navigator" className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-3">Navigate</p>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => onNavigate('all')}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs hover:bg-teal/5 dark:hover:bg-teal/10 transition-colors text-left"
        >
          <span className="font-semibold text-ink dark:text-white">All Issues</span>
          <span className="font-bold text-body dark:text-gray-400">{totalViolations}</span>
        </button>
        {NS_SEVERITY_ROWS.map(({ key, label, dot }) => {
          const count = sevBreak[key] || 0;
          if (!count) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors text-left"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <span className="flex-1 text-body dark:text-gray-400">{label}</span>
              <span className="font-bold text-ink dark:text-white">{count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Accessibility readiness card ────────────────────────────────────────────

function AccessibilityReadinessCard({ score, sevBreak, violations, passes }) {
  const risk = p4riskLevel(score, sevBreak);
  const wcag = p4wcagLabel(violations);
  const criticalCount = sevBreak.critical || 0;
  const totalChecks = violations.length + passes.length;
  const passRate = totalChecks > 0 ? Math.round((passes.length / totalChecks) * 100) : 100;

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-teal flex-shrink-0" />
          <span className="font-heading font-semibold text-base leading-none text-ink dark:text-white">Accessibility Readiness</span>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${risk.badgeCls}`}>
          {risk.level} Risk
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Score</p>
          <p className="text-xl font-heading font-bold text-ink dark:text-white">{score}<span className="text-xs font-normal text-body dark:text-gray-500">/100</span></p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">WCAG</p>
          <p className="text-sm font-heading font-bold text-ink dark:text-white leading-tight mt-1">{wcag}</p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Critical</p>
          <p className={`text-xl font-heading font-bold ${criticalCount > 0 ? 'text-coral' : 'text-sage'}`}>{criticalCount}</p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Pass Rate</p>
          <p className="text-xl font-heading font-bold text-ink dark:text-white">{passRate}<span className="text-xs font-normal text-body dark:text-gray-500">%</span></p>
        </div>
      </div>
      <div className="bg-teal/5 border border-teal/15 rounded-xl px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-teal mb-1">Recommended Priority</p>
        <p className="text-sm text-ink dark:text-white font-medium">{risk.action}</p>
      </div>
    </div>
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
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-teal flex-shrink-0" />
          <span className="font-heading font-semibold text-base leading-none text-ink dark:text-white">Viewport Comparison</span>
        </div>
        <span className="text-[10px] font-semibold text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">Beta</span>
      </div>
      <p className="text-xs text-body dark:text-gray-500 mb-4 leading-relaxed">
        Run independent scans per viewport to detect responsive layout differences.
      </p>
      <div className="space-y-2">
        {rows.map(vp => (
          <div key={vp.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
            <div className="w-16 flex-shrink-0">
              <p className="text-xs font-semibold text-ink dark:text-white">{vp.label}</p>
              <p className="text-[10px] text-body dark:text-gray-500">{vp.width}px</p>
            </div>
            {vp.data ? (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-ink dark:text-white">{vp.data.violations}</span>
                <span className="text-xs text-body dark:text-gray-500 truncate">violations · {vp.data.score}/100</span>
                {!vp.isBase && vp.data.violations !== currentTotal && (
                  <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${vp.data.violations > currentTotal ? 'text-coral bg-coral/10' : 'text-sage bg-sage/10'}`}>
                    {vp.data.violations > currentTotal ? '+' : ''}{vp.data.violations - currentTotal}
                  </span>
                )}
                {vp.isBase && <span className="ml-auto text-[10px] font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-full flex-shrink-0">Current</span>}
                {!vp.isBase && vp.data.violations === currentTotal && (
                  <span className="ml-auto text-[10px] text-body dark:text-gray-500 flex-shrink-0">No diff</span>
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

export default function ScanResults({ violations, incomplete, passes, scanRan, scanUrl, onReset, screenshot, screenshotType }) {
  const { navigate, setPendingAssistiveUrl } = useApp();
  const [filterImpact, setFilterImpact] = useState('all');
  const [pageScreenshotOpen, setPageScreenshotOpen] = useState(false);
  const hasPageScreenshot = typeof screenshot === 'string' && screenshot.trim().length > 0;
  const pageScreenshotType = (typeof screenshotType === 'string' && screenshotType.trim()) || 'image/jpeg';
  const [groupMode, setGroupMode]       = useState('rule');
  const [searchQuery, setSearchQuery]   = useState('');
  const [wcagFilter, setWcagFilter]     = useState('all');
  const savedRef = useRef(false);
  const [appeared, setAppeared]           = useState(false);
  const [revealDone, setRevealDone]       = useState(false);
  const [revealVisible, setRevealVisible] = useState(true);
  const [highlightSection, setHighlight]  = useState(null);
  const hlTimerRef                        = useRef(null);

  const violCount       = useCountUp(violations.length);
  const incompleteCount = useCountUp(incomplete.length);
  const passCount       = useCountUp(passes.length);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setAppeared(true); return; }
    const t = setTimeout(() => setAppeared(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setRevealDone(true); setRevealVisible(false); return; }
    const t1 = setTimeout(() => setRevealVisible(false), 5000);
    const t2 = setTimeout(() => setRevealDone(true), 5600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const score     = nsComputeScore(violations);
  const gradeInfo = nsScoreGradeInfo(score);
  const sevBreak  = nsBuildSeverityBreakdown(violations);
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

  const finalViolations = wcagFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter(v => p4wcagLevel(v) === wcagFilter);

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

      {/* Scan completion reveal — visible for ~1s then fades out */}
      {!revealDone && (
        <div className={`bg-white dark:bg-charcoal rounded-2xl border border-teal/25 dark:border-teal/25 shadow-soft px-6 py-6 transition-opacity duration-500 ${revealVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center justify-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-full bg-teal/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-4.5 h-4.5 text-teal" />
            </div>
            <span className="font-heading font-semibold text-base text-ink dark:text-white">Scan Complete</span>
            {scanRan && (
              <span className="text-xs text-body dark:text-gray-400">
                &nbsp;· Accessibility Score&nbsp;<span className="font-heading font-bold text-ink dark:text-white">{score}</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
            <div className={`rounded-xl px-4 py-4 text-center ${violations.length > 0 ? 'bg-coral/10' : 'bg-gray-50 dark:bg-white/5'}`}>
              <p className={`font-heading font-bold text-3xl leading-none ${violations.length > 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>{violCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1.5 font-medium">Violations</p>
            </div>
            <div className={`rounded-xl px-4 py-4 text-center ${incomplete.length > 0 ? 'bg-amber/10' : 'bg-gray-50 dark:bg-white/5'}`}>
              <p className={`font-heading font-bold text-3xl leading-none ${incomplete.length > 0 ? 'text-amber' : 'text-body dark:text-gray-400'}`}>{incompleteCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1.5 font-medium">Needs Review</p>
            </div>
            <div className="rounded-xl px-4 py-4 text-center bg-gray-50 dark:bg-white/5">
              <p className="font-heading font-bold text-3xl leading-none text-sage">{passCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1.5 font-medium">Passed</p>
            </div>
          </div>
        </div>
      )}

      {/* Main content — fades in + drifts up as reveal card fades out */}
      <div className={`space-y-4 transition-all duration-500 ${revealVisible ? 'opacity-0 translate-y-5' : 'opacity-100 translate-y-0'}`}>

      {/* Scan complete header */}
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle className="w-4 h-4 text-sage" />
              <span className="text-sm font-semibold text-sage">Scan complete</span>
            </div>
            <p className="text-xs font-mono text-body dark:text-gray-400 break-all max-w-sm">{scanUrl}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onReset} className="btn-secondary text-sm flex items-center gap-2">
              <RotateCcw className="w-3.5 h-3.5" />
              Scan another
            </button>
            <button onClick={() => navigate('scan-history')} className="btn-secondary text-sm flex items-center gap-2">
              <History className="w-3.5 h-3.5" />
              View history
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {violations.length > 0 ? (
            <button
              type="button"
              onClick={() => scrollToSection('ns-violations-section', 'violations')}
              className="rounded-xl px-4 py-3 text-center bg-coral/10 hover:bg-coral/[0.18] dark:hover:bg-coral/[0.18] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1"
              aria-label={`${violations.length} violations — jump to violations section`}
            >
              <p className="font-heading font-bold text-2xl leading-none text-coral">{violCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Violations</p>
            </button>
          ) : (
            <div className="rounded-xl px-4 py-3 text-center bg-gray-50 dark:bg-white/5">
              <p className="font-heading font-bold text-2xl leading-none text-body dark:text-gray-400">{violCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Violations</p>
            </div>
          )}
          {incomplete.length > 0 ? (
            <button
              type="button"
              onClick={() => scrollToSection('ns-needs-review-section', 'needs-review')}
              className="rounded-xl px-4 py-3 text-center bg-amber/10 hover:bg-amber/[0.18] dark:hover:bg-amber/[0.18] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1"
              aria-label={`${incomplete.length} items need review — jump to needs review section`}
            >
              <p className="font-heading font-bold text-2xl leading-none text-amber">{incompleteCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Needs Review</p>
            </button>
          ) : (
            <div className="rounded-xl px-4 py-3 text-center bg-gray-50 dark:bg-white/5">
              <p className="font-heading font-bold text-2xl leading-none text-body dark:text-gray-400">{incompleteCount}</p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Needs Review</p>
            </div>
          )}
          <div className="rounded-xl px-4 py-3 text-center bg-gray-50 dark:bg-white/5">
            <p className="font-heading font-bold text-2xl leading-none text-sage">{passCount}</p>
            <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Passed</p>
          </div>
        </div>
        {!scanRan && (
          <div className="flex items-start gap-2.5 bg-amber/10 px-4 py-3 rounded-xl mt-4">
            <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber leading-relaxed">
              Axe returned no data — the page may have blocked the scanner (bot protection, CSP, or login required).
            </p>
          </div>
        )}
      </div>

      {/* Page screenshot */}
      {hasPageScreenshot && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
          <p className="font-heading font-semibold text-base text-ink dark:text-white mb-1">Page screenshot</p>
          <p className="text-xs text-body dark:text-gray-500 mb-3">View the page as it was when the accessibility check ran.</p>
          <button
            type="button"
            onClick={() => setPageScreenshotOpen(true)}
            className="btn-secondary text-sm"
          >
            View page screenshot
          </button>
        </div>
      )}

      {/* Score + Severity Distribution */}
      {scanRan && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-4">
              Accessibility Score
            </p>
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center flex-shrink-0 ${gradeInfo.dialCls}`}>
                <span className="font-heading font-bold text-2xl leading-none">{score}</span>
                <span className="text-[10px] opacity-60 mt-0.5">/ 100</span>
              </div>
              <div className="min-w-0">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full mb-2 inline-block ${gradeInfo.badgeCls}`}>
                  Grade {gradeInfo.grade}
                </span>
                <p className="text-sm text-body dark:text-gray-400 leading-snug">{nsScoreMessage(score)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-1">
              Severity Distribution
            </p>
            <SeverityDonut sevBreak={sevBreak} />
          </div>
        </div>
      )}

      {scanRan && (
        <AccessibilityReadinessCard score={score} sevBreak={sevBreak} violations={violations} passes={passes} />
      )}

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
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
          <p className="font-heading font-semibold text-base text-ink dark:text-white mb-4">Top Issues</p>
          <div className="space-y-2">
            {topIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => scrollToViolation(issue.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-teal/5 dark:hover:bg-teal/10 transition-colors text-left"
              >
                <span className="flex-1 text-sm font-medium text-ink dark:text-white truncate min-w-0">{issue.title}</span>
                <span className="w-24 h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden flex-shrink-0">
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
          <div className={`flex-1 min-w-0 bg-white dark:bg-charcoal rounded-2xl border shadow-soft p-6 transition-all duration-500 ${
            highlightSection === 'violations'
              ? 'border-teal/40 dark:border-teal/40 ring-1 ring-teal/20 dark:ring-teal/20'
              : 'border-gray-100 dark:border-white/[0.06]'
          }`}>

            {/* Header row */}
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <p className="font-heading font-semibold text-base text-ink dark:text-white">
                Violations{' '}
                <span className="text-sm font-normal text-body dark:text-gray-400">
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
                    className="pl-7 pr-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-ink dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-teal dark:focus:border-teal w-36 transition-colors"
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
                        : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-teal/50 dark:hover:border-teal/50'
                    }`}
                  >
                    {lvl === 'all' ? 'WCAG: All' : lvl === 'BP' ? 'Best Practice' : `WCAG ${lvl}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Group toggle + impact pills */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <div className="flex items-center bg-gray-100 dark:bg-white/5 rounded-lg p-0.5 border border-gray-200 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setGroupMode('rule')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode === 'rule' ? 'bg-white dark:bg-charcoal text-teal shadow-sm' : 'text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'}`}
                >
                  By Rule
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('area')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode === 'area' ? 'bg-white dark:bg-charcoal text-teal shadow-sm' : 'text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'}`}
                >
                  By Area
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFilterImpact('all')}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filterImpact === 'all' ? 'bg-ink dark:bg-white text-white dark:text-night border-ink dark:border-white' : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-gray-400 dark:hover:border-white/30'}`}
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
                <p className="text-sm text-body dark:text-gray-500">No violations match your filters.</p>
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
                      <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400">{area}</p>
                      <span className="text-[10px] font-semibold text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">{aViolations.length}</span>
                    </div>
                    <div className="space-y-2">
                      {aViolations.map((v, i) => (
                        <div key={v.id ?? i} id={`nsvi-${v.id ?? i}`}>
                          <ViolationRow violation={v} />
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
                    <ViolationRow violation={v} />
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

      {/* Needs Review */}
      {incomplete.length > 0 && (
        <div id="ns-needs-review-section" className={`bg-white dark:bg-charcoal rounded-2xl border shadow-soft p-6 transition-all duration-500 ${
          highlightSection === 'needs-review'
            ? 'border-teal/40 dark:border-teal/40 ring-1 ring-teal/20 dark:ring-teal/20'
            : 'border-gray-100 dark:border-white/[0.06]'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-heading font-semibold text-base text-ink dark:text-white">Needs Review</span>
            <span className="text-xs font-semibold text-amber bg-amber/10 px-2 py-0.5 rounded-full">{incomplete.length}</span>
          </div>
          <p className="text-xs text-body dark:text-gray-500 mb-4">
            Axe could not automatically confirm these — they require manual inspection.
          </p>
          <div className="space-y-2">
            {incomplete.map((v, i) => (
              <ViolationRow key={v.id ?? i} violation={{ ...v, impact: v.impact ?? 'moderate' }} />
            ))}
          </div>
        </div>
      )}

      {/* Run Assistive Test CTA */}
      {scanRan && scanUrl && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-heading font-semibold text-sm text-ink dark:text-white mb-0.5">Deepen your audit</p>
            <p className="text-xs text-body dark:text-gray-400">Check keyboard navigation, color contrast, and more with Assistive Testing.</p>
          </div>
          <button
            type="button"
            onClick={() => { setPendingAssistiveUrl(scanUrl); navigate('assistive-test'); }}
            className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            Run Assistive Test
          </button>
        </div>
      )}

      {/* All clear */}
      {violations.length === 0 && incomplete.length === 0 && scanRan && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-8 h-8 text-teal" />
          </div>
          <p className="font-heading font-bold text-2xl text-ink dark:text-white mb-3">Excellent accessibility</p>
          <div className={`inline-flex items-baseline gap-1.5 rounded-full px-5 py-2 mb-5 ${gradeInfo.badgeCls}`}>
            <span className="font-heading font-bold text-3xl">{score}</span>
            <span className="text-sm opacity-70">/ 100 · Grade {gradeInfo.grade}</span>
          </div>
          <p className="text-sm text-body dark:text-gray-400 max-w-sm mx-auto leading-relaxed mb-6">
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
