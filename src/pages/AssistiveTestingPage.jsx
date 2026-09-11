import { useState, useCallback, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/api';
import { Play, AlertCircle, Link2, CheckCircle2, CircleMinus, Info, ArrowRight, ExternalLink } from 'lucide-react';
import ScanProgress from '../components/newscan/ScanProgress';
import ScoreGauge from '../components/ui/ScoreGauge';
import AssistiveResultView, { MODULE_LABELS } from '../components/assistive/AssistiveResultView';
import './NewScanPage.css';
import { MODULES, buildAssistiveResult } from '../config/assistiveModules';

// axe rule tag each module roughly corresponds to, so "needs review" history
// items can be attributed to the module that most likely flagged them —
// approximate, but grounded in each module's real endpoint/description.
const SCAN_TYPE_TO_MODULE_ID = { keyboard: 'keyboard', contrast: 'color-contrast', 'page-structure': 'page-structure' };

// ─── Test module status row (mirrors the mockup's "Test modules" list) ──────
function ModuleRow({ mod, status, isActiveTab, checked, onToggle, disabled }) {
  const Icon = mod.icon;
  const isPlanned = mod.status !== 'active';
  const statusPill = isPlanned || !status || status === 'not-tested' ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 whitespace-nowrap">
      <CircleMinus size={12} /> Not tested
    </span>
  ) : status === 'passed' ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sage/15 text-sage-700 whitespace-nowrap">
      <CheckCircle2 size={12} /> Completed
    </span>
  ) : status === 'needs-review' ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber/15 text-amber-700 whitespace-nowrap">
      <AlertCircle size={12} /> Needs review
    </span>
  ) : null;

  return (
    <div className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-colors ${
      isActiveTab ?'border-teal/40 bg-teal/[0.04]':'border-gray-100'
    }`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isPlanned ?'bg-gray-100':'bg-teal/10'
      }`}>
        <Icon size={16} className={isPlanned ?'text-gray-400':'text-teal'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink m-0">{mod.label}</p>
        <p className="text-xs text-body m-0 leading-relaxed">{mod.description}</p>
      </div>
      {statusPill}
      {!isPlanned && (
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(mod.id, e.target.checked)}
          aria-label={`Include ${mod.label} in the next test run`}
          title={`Include ${mod.label} in the next test run`}
          className="checkbox-base flex-shrink-0"
        />
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AssistiveTestingPage() {
  const {
    pendingAssistiveUrl, setPendingAssistiveUrl,
    pendingAssistiveModule, setPendingAssistiveModule,
    setAssistiveResult, navigate, setPendingScanHistoryTab,
  } = useApp();
  const [activeModuleId, setActiveModuleId] = useState('keyboard');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRun, setAutoRun] = useState(false);
  const [history, setHistory] = useState([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState(() => new Set());
  // Results from the most recent multi-module run, shown inline below since
  // there's no single results page to navigate to for more than one module.
  const [multiResults, setMultiResults] = useState([]);

  const toggleModuleSelected = useCallback((id, isChecked) => {
    setSelectedModuleIds((prev) => {
      const next = new Set(prev);
      if (isChecked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (pendingAssistiveUrl) {
      setUrl(pendingAssistiveUrl);
      setPendingAssistiveUrl('');
    }
    if (pendingAssistiveModule) {
      setActiveModuleId(pendingAssistiveModule);
      setPendingAssistiveModule(null);
      setAutoRun(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRun && url.trim()) {
      setAutoRun(false);
      handleRunTest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, url]);

  // Powers the "Test modules" status list and coverage gauge below — real
  // history for the URL currently in the input, not fabricated data.
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/assistive-history')
      .then(res => res.json())
      .then(data => { if (!cancelled && data.ok && Array.isArray(data.items)) setHistory(data.items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activeModule = MODULES.find((m) => m.id === activeModuleId);
  const activeModules = MODULES.filter((m) => m.status === 'active');
  const plannedModules = MODULES.filter((m) => m.status !== 'active');

  // Most recent history record per active module, matched against the
  // current URL — 'passed' -> Completed, failed -> Needs review, none -> Not tested.
  const moduleStatus = useMemo(() => {
    const trimmed = url.trim();
    const status = {};
    for (const mod of activeModules) {
      const scanTypeKeys = Object.entries(SCAN_TYPE_TO_MODULE_ID).filter(([, v]) => v === mod.id).map(([k]) => k);
      const matches = history.filter(h => h.url === trimmed && scanTypeKeys.includes(h.scan_type));
      const latest = matches.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      status[mod.id] = !latest ? 'not-tested' : latest.passed ? 'passed' : 'needs-review';
    }
    return status;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, url]);

  const coverage = useMemo(() => {
    const values = Object.values(moduleStatus);
    const passed = values.filter(v => v === 'passed').length;
    const needsReview = values.filter(v => v === 'needs-review').length;
    const notTested = values.length - passed - needsReview + plannedModules.length;
    const totalModules = activeModules.length + plannedModules.length;
    const percentComplete = totalModules > 0 ? Math.round(((passed + needsReview) / totalModules) * 100) : 0;
    return { passed, needsReview, notTested, percentComplete };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleStatus]);

  // Runs whichever modules are checked in the "Test modules" list. With
  // nothing checked, falls back to just the active tab (the original
  // single-test behavior) so Start Test still works without touching a
  // checkbox. Multiple checked modules run one after another; when exactly
  // one ran, its full results page opens as before — with several, there's
  // no single result to navigate to, so every module's real result renders
  // inline below instead (see multiResults / the JSX further down).
  const handleRunTest = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a URL to test.');
      return;
    }
    const idsToRun = selectedModuleIds.size > 0
      ? activeModules.filter((m) => selectedModuleIds.has(m.id)).map((m) => m.id)
      : [activeModuleId];

    setLoading(true);
    setError('');
    setMultiResults([]);

    const okResults = []; // [{ id, built }]
    let firstError = '';

    for (const id of idsToRun) {
      const mod = MODULES.find((m) => m.id === id);
      if (!mod || mod.status !== 'active') continue;
      setActiveModuleId(id);
      try {
        const res = await apiFetch(mod.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();
        if (!data.ok) {
          firstError ||= `${mod.label}: ${data.error ?? 'Test failed.'}`;
        } else {
          okResults.push({ id, built: buildAssistiveResult(data.result ?? data, id, trimmed) });
        }
      } catch {
        firstError ||= `${mod.label}: Network error. Please check your connection and try again.`;
      }
    }

    setLoading(false);
    if (firstError) setError(firstError);

    // Refresh the "Test modules" status list / coverage gauge with whatever
    // just ran, regardless of how many modules were included.
    apiFetch('/api/assistive-history')
      .then((res) => res.json())
      .then((data) => { if (data.ok && Array.isArray(data.items)) setHistory(data.items); })
      .catch(() => {});

    if (idsToRun.length === 1 && okResults.length === 1) {
      setAssistiveResult(okResults[0].built);
      navigate('assistive-results');
    } else {
      setMultiResults(okResults);
    }
  }, [url, selectedModuleIds, activeModuleId, activeModules, setAssistiveResult, navigate]);

  return (
    <div className="flex-1 overflow-auto bg-ivory p-6">

      {/* HEADER */}
      <div className="mb-6">
        <h1 className="font-heading font-bold text-2xl text-ink">
          Assistive testing
        </h1>
        <p className="text-sm text-body mt-1">
          Validate real interaction patterns beyond automated scans
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* ── MAIN COLUMN ── */}
        <div className="space-y-5 min-w-0">

          {/* Module tabs */}
          <div role="tablist"aria-label="Assistive test module"className="flex items-center gap-5 border-b border-gray-200 overflow-x-auto">
            {activeModules.map((mod) => (
              <button
                key={mod.id}
                role="tab"
                aria-selected={activeModuleId === mod.id}
                id={`assistive-tab-${mod.id}`}
                aria-controls="assistive-run-panel"
                onClick={() => { setActiveModuleId(mod.id); setError(''); }}
                className={`pb-3 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 rounded-t ${
                  activeModuleId === mod.id
                    ?'border-teal text-teal font-semibold'
                    :'border-transparent text-body hover:text-ink'
                }`}
              >
                {mod.label}
              </button>
            ))}
          </div>

          <div id="assistive-run-panel" role="tabpanel" aria-labelledby={`assistive-tab-${activeModuleId}`}>
            {loading ? (
              <div className="bg-white rounded-2xl border border-gray-100">
                <ScanProgress bare url={url} />
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5 space-y-4">
                <div>
                  <label htmlFor="assistive-url"className="block text-sm font-semibold text-ink mb-2">
                    Target URL
                  </label>
                  <div className="glow-input-wrapper glow-input-wrapper--large">
                    <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                    <input
                      id="assistive-url"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRunTest(); }}
                      placeholder="https://example.com"
                      className="glow-input glow-input--large-text has-left-icon"
                      aria-describedby={error ? 'assistive-url-error' : undefined}
                      aria-invalid={error ? 'true' : undefined}
                    />
                  </div>
                </div>

                <button
                  onClick={() => handleRunTest()}
                  disabled={!url.trim()}
                  className="btn-primary w-full justify-center py-3.5 text-base font-semibold"
                >
                  <Play className="w-4.5 h-4.5" />
                  Start test
                </button>

                {error && (
                  <div id="assistive-url-error" className="alert-danger" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Test modules list */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body mb-3 px-1">
              Test modules
            </p>
            <div className="space-y-2">
              {[...activeModules, ...plannedModules].map((mod) => (
                <ModuleRow
                  key={mod.id}
                  mod={mod}
                  status={moduleStatus[mod.id]}
                  isActiveTab={mod.id === activeModuleId}
                  disabled={loading}
                  checked={selectedModuleIds.has(mod.id)}
                  onToggle={toggleModuleSelected}
                />
              ))}
            </div>
          </div>

          {/* Inline results for a multi-module run — a single-module run
              navigates to the full results page instead (see handleRunTest). */}
          {multiResults.length > 0 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-body px-1">
                Results from this run
              </p>
              {multiResults.map(({ id, built }) => (
                <div key={id}>
                  <h3 className="font-heading font-semibold text-base text-ink mb-2">
                    {MODULE_LABELS[id] ?? id}
                  </h3>
                  <AssistiveResultView result={built} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── SIDEBAR ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="font-heading font-semibold text-sm text-ink mb-4">Test coverage</p>
            {url.trim() ? (
              <>
                <div className="flex justify-center mb-4">
                  <ScoreGauge score={coverage.percentComplete} label="Complete" color="#0F766E" size={130} />
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="w-6 h-6 rounded-full bg-sage/15 text-sage-700 flex items-center justify-center flex-shrink-0"><CheckCircle2 size={13} /></span>
                    <span className="font-semibold text-ink tabular-nums">{coverage.passed}</span>
                    <span className="text-body">Passed</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="w-6 h-6 rounded-full bg-amber/15 text-amber-700 flex items-center justify-center flex-shrink-0"><AlertCircle size={13} /></span>
                    <span className="font-semibold text-ink tabular-nums">{coverage.needsReview}</span>
                    <span className="text-body">Needs review</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0"><CircleMinus size={13} /></span>
                    <span className="font-semibold text-ink tabular-nums">{coverage.notTested}</span>
                    <span className="text-body">Not tested</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPendingScanHistoryTab('assistive'); navigate('scan-history'); }}
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-teal hover:underline"
                >
                  View full results <ArrowRight size={12} />
                </button>
              </>
            ) : (
              <p className="text-sm text-body">Enter a URL to see coverage across all test modules.</p>
            )}
          </div>

          <div className="alert-info">
            <Info size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold m-0 mb-1">Human review recommended</p>
              <p className="text-xs m-0 leading-relaxed opacity-90">
                Assistive testing results should be reviewed with keyboard and screen reader users to confirm real world accessibility.
              </p>
              <button
                type="button"
                onClick={() => navigate('wcag-reference')}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal hover:underline"
              >
                Learn more about assistive testing <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
