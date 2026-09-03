import { apiFetch } from '../utils/api';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Wand2, Bot, Copy, Check, AlertCircle, RefreshCw, ShieldAlert, Clock3, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { StatusPill } from '../components/ui/StatusBadge';
import CodeBlock from '../components/ui/CodeBlock';

const FRAMEWORKS = [
  { id: 'html', label: 'HTML' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
];

const PAGE_SIZE = 6;

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function impactToSeverity(impact) {
  if (!impact) return 'Minor';
  const map = {
    critical: 'Critical',
    serious: 'Serious',
    moderate: 'Moderate',
    minor: 'Minor',
  };
  return map[impact.toLowerCase()] ?? capitalizeFirst(impact);
}

const SEVERITY_ORDER = ['Critical', 'Serious', 'Moderate', 'Minor'];

function StatCard({ icon: Icon, tone, value, label, sub }) {
  const toneClasses = {
    danger:  'bg-coral/10 text-coral',
    warning: 'bg-amber/10 text-amber-700 dark:text-amber-300',
    success: 'bg-sage/10 text-sage-700 dark:text-sage-300',
  }[tone];
  return (
    <div className="flex items-center gap-3 px-5 py-4 flex-1 min-w-[200px]">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${toneClasses}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="font-heading font-bold text-2xl text-ink dark:text-white leading-none m-0">{value}</p>
        <p className="text-sm font-medium text-ink dark:text-white m-0 mt-1">{label}</p>
        <p className="text-xs text-body dark:text-gray-400 m-0">{sub}</p>
      </div>
    </div>
  );
}

export default function AIFixPage() {
  const [violations, setViolations] = useState([]);
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [framework, setFramework] = useState('html');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [severityFilter, setSeverityFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [fixStats, setFixStats] = useState({ awaitingReview: 0, applied: 0 });

  useEffect(() => {
    const fetchViolations = async () => {
      setHistoryLoading(true);
      try {
        const res = await apiFetch('/api/history?limit=5');
        const data = await res.json();
        if (!data.ok || !Array.isArray(data.items)) {
          setHistoryLoading(false);
          return;
        }

        const seen = new Set();
        const collected = [];

        for (const item of data.items) {
          let itemViolations = [];

          if (Array.isArray(item.violations)) {
            itemViolations = item.violations;
          } else if (item.result && Array.isArray(item.result.violations)) {
            itemViolations = item.result.violations;
          } else if (item.id) {
            try {
              const detailRes = await apiFetch(`/api/history/${item.id}`);
              const detailData = await detailRes.json();
              if (detailData.ok && detailData.result && Array.isArray(detailData.result.violations)) {
                itemViolations = detailData.result.violations;
              }
            } catch {
              // skip
            }
          }

          for (const v of itemViolations) {
            if (v.id && !seen.has(v.id)) {
              seen.add(v.id);
              // Tag with the scan it came from — the mockup shows a source
              // URL per issue; the raw axe violation has no URL of its own,
              // so this is the scan-level context it was collected under.
              collected.push({ ...v, sourceUrl: item.url, sourceScanId: item.id });
            }
          }
        }

        setViolations(collected);
      } catch {
        // silently fail — violations stays empty
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchViolations();
  }, []);

  // Fixable/Awaiting-review/Applied stats — real counts, not placeholders.
  // "Fixable issues" = violations loaded above (existing count). Awaiting
  // review / Applied come from the real Auto-Fix pipeline's fix history
  // (a separate system from this page's own AI-snippet generator below —
  // see the note near the Apply-fix behavior further down).
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/fixes?limit=200')
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.ok || !Array.isArray(data.fixes)) return;
        const awaitingReview = data.fixes.filter(f => f.status === 'verified' && !f.merged).length;
        const applied = data.fixes.filter(f => f.merged).length;
        setFixStats({ awaitingReview, applied });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setCurrentPage(1) }, [severityFilter]);

  const filteredViolations = useMemo(() => {
    const filtered = severityFilter
      ? violations.filter(v => impactToSeverity(v.impact) === severityFilter)
      : violations;
    return [...filtered].sort((a, b) =>
      SEVERITY_ORDER.indexOf(impactToSeverity(a.impact)) - SEVERITY_ORDER.indexOf(impactToSeverity(b.impact))
    );
  }, [violations, severityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredViolations.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedViolations = filteredViolations.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleGetFix = useCallback(async () => {
    if (!selectedViolation || loading) return;
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/ai-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ violation: selectedViolation, framework }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? data.message ?? 'Failed to generate fix. Please try again.');
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedViolation, framework, loading]);

  const handleCopy = useCallback(() => {
    if (!result?.after) return;
    navigator.clipboard.writeText(result.after).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night page-content">
      {/* Page header */}
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-teal/10 flex items-center justify-center shrink-0 mt-0.5">
          <Wand2 className="w-5 h-5 text-teal" />
        </div>
        <div>
          <h2 className="font-heading font-bold text-2xl text-ink dark:text-white">
            AI Fix Assistant
          </h2>
          <p className="text-sm text-body dark:text-gray-400 mt-0.5">
            Select an accessibility violation from your recent scans and get an AI-generated code fix with explanation.
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex flex-wrap divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-white/[0.06] bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-2xl shadow-soft mb-3">
        <StatCard icon={ShieldAlert} tone="danger" value={historyLoading ? '—' : violations.length} label="Fixable issues" sub="Ready for AI assistance" />
        <StatCard icon={Clock3} tone="warning" value={fixStats.awaitingReview} label="Awaiting review" sub="Open PRs need your review" />
        <StatCard icon={CheckCircle2} tone="success" value={fixStats.applied} label="Fixes applied" sub="Merged across all audits" />
      </div>

      {/* Warning banner */}
      <div className="alert-warning mb-5">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span>AI-generated fixes may not be perfect. Always review and test changes before deploying to production.</span>
      </div>

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* LEFT PANEL — Issue selector */}
        <div className="card p-5 h-fit">
          {/* Panel heading */}
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="font-heading font-semibold text-base text-ink dark:text-white m-0">
                Accessibility issues
              </h3>
              {!historyLoading && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-teal/10 text-teal-700 dark:text-teal-300">
                  {filteredViolations.length}
                </span>
              )}
            </div>
            {!historyLoading && violations.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-body dark:text-gray-400">
                <span className="sr-only">Filter by severity</span>
                <select
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value)}
                  className="select-base w-auto py-1.5 pl-2.5 pr-7 text-xs"
                  aria-label="Filter issues by severity"
                >
                  <option value="">All severities</option>
                  {SEVERITY_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
          </div>

          {/* Violation list */}
          {historyLoading ? (
            <div className="flex items-center justify-center py-10 gap-3 text-body dark:text-gray-400 text-sm">
              <span className="w-5 h-5 border-2 border-teal/30 border-t-teal rounded-full animate-spin shrink-0" />
              Loading violations…
            </div>
          ) : violations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-body dark:text-gray-400 text-sm gap-2">
              <AlertCircle className="w-7 h-7 opacity-30" />
              <p>No violations found. Run a scan first.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {pagedViolations.map((v) => {
                  const isSelected = selectedViolation?.id === v.id && selectedViolation?.sourceScanId === v.sourceScanId;
                  return (
                    <button
                      key={`${v.sourceScanId}-${v.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedViolation(v);
                        setResult(null);
                        setError('');
                      }}
                      className={`w-full text-left flex items-center justify-between gap-3 p-3 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 ${
                        isSelected
                          ? 'bg-teal/10 border border-teal/30'
                          : 'hover:bg-ivory dark:hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusPill severity={impactToSeverity(v.impact)} />
                        </div>
                        <p className="text-sm font-medium text-ink dark:text-white truncate leading-snug m-0">
                          {v.description ?? v.help ?? v.id}
                        </p>
                        {v.sourceUrl && (
                          <p className="text-xs text-body dark:text-gray-500 truncate m-0 mt-0.5">{v.sourceUrl}</p>
                        )}
                      </div>
                      <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 text-xs text-body dark:text-gray-400">
                  <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredViolations.length)} of {filteredViolations.length} issues</span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                      aria-label="Previous page"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-white/10 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ivory dark:hover:bg-white/5">
                      <ChevronLeft size={13} />
                    </button>
                    <span className="tabular-nums">{safePage} / {totalPages}</span>
                    <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                      aria-label="Next page"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-white/10 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ivory dark:hover:bg-white/5">
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Framework selector */}
          <div className="mt-5">
            <label className="block text-xs font-medium text-body dark:text-gray-400 mb-2">
              Framework
            </label>
            <div className="flex gap-2">
              {FRAMEWORKS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFramework(f.id)}
                  className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all border ${
                    framework === f.id
                      ? 'bg-teal/10 border-teal/30 text-teal'
                      : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-teal/20 hover:text-teal'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGetFix}
            disabled={!selectedViolation || loading}
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate Fix
              </>
            )}
          </button>
        </div>

        {/* RIGHT PANEL — AI result */}
        <div className="card p-5">
          {/* Empty state */}
          {!loading && !result && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-body dark:text-gray-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center">
                <Bot className="w-7 h-7 text-teal opacity-60" />
              </div>
              <p className="text-sm text-center max-w-xs">
                Select a violation and click <span className="font-semibold text-ink dark:text-white">Generate Fix</span> to get an AI-powered code fix.
              </p>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center">
                <Bot className="w-7 h-7 text-teal animate-pulse" />
              </div>
              <div className="text-center" role="status">
                <p className="text-sm font-medium text-ink dark:text-white">
                  Generating fix…
                </p>
                <p className="text-xs text-body dark:text-gray-400 mt-1">
                  Analyzing the violation and crafting a remediation
                </p>
              </div>
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-teal/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div className="flex flex-col gap-3">
              <div className="alert-danger" role="alert">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium m-0">Generation failed</p>
                  <p className="text-xs mt-0.5 m-0 opacity-90">{error}</p>
                </div>
              </div>
              <button
                onClick={handleGetFix}
                disabled={!selectedViolation}
                className="btn-ghost flex items-center gap-2 justify-center text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Try again
              </button>
            </div>
          )}

          {/* Result state */}
          {!loading && result && (
            <div className="space-y-5">
              {/* Result header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-teal/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-teal" />
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm text-ink dark:text-white leading-tight m-0">
                      AI-suggested fix
                    </p>
                    <span className="text-xs text-body dark:text-gray-400">
                      {FRAMEWORKS.find(f => f.id === framework)?.label ?? framework}
                    </span>
                  </div>
                </div>
                {result.wcagCriterion && (
                  <span className="font-mono text-xs bg-teal/10 text-teal-700 dark:text-teal-300 px-2 py-1 rounded-lg border border-teal/20 shrink-0">
                    {result.wcagCriterion}
                  </span>
                )}
              </div>

              {/* Problem explanation */}
              {result.explanation && (
                <div>
                  <p className="text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide mb-1.5">
                    Problem
                  </p>
                  <p className="text-sm text-ink dark:text-gray-200 leading-relaxed">
                    {result.explanation}
                  </p>
                </div>
              )}

              {/* Code blocks */}
              {result.before && (
                <CodeBlock title="Code Before" code={result.before} tone="before" />
              )}
              {result.after && (
                <CodeBlock title="Code After" code={result.after} tone="after" />
              )}

              {/* Copy button — this is the terminal action on purpose: the
                  fix is copied to the clipboard for you to paste and commit
                  yourself, so nothing is ever applied without you doing it.
                  (Auto-Fix's real apply/PR/merge pipeline is a separate
                  system, reachable from a scan's violation list once a repo
                  is connected under Connected Repos — this page is a
                  lighter, repo-independent "get me a snippet" tool.) */}
              {result.after && (
                <button
                  onClick={handleCopy}
                  className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-sage" />
                      <span className="text-sage">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Fix
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
