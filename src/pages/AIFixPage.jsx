import { apiFetch } from '../utils/api';
import { useState, useEffect, useCallback } from 'react';
import { Wand2, Bot, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { StatusPill } from '../components/ui/StatusBadge';
import CodeBlock from '../components/ui/CodeBlock';
import IssueCard from '../components/ui/IssueCard';

const FRAMEWORKS = [
  { id: 'html', label: 'HTML' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
];

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

export default function AIFixPage() {
  const [violations, setViolations] = useState([]);
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [framework, setFramework] = useState('html');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
          let violations = [];

          if (Array.isArray(item.violations)) {
            violations = item.violations;
          } else if (item.result && Array.isArray(item.result.violations)) {
            violations = item.result.violations;
          } else if (item.id) {
            try {
              const detailRes = await apiFetch(`/api/history/${item.id}`);
              const detailData = await detailRes.json();
              if (detailData.ok && detailData.result && Array.isArray(detailData.result.violations)) {
                violations = detailData.result.violations;
              }
            } catch {
              // skip
            }
          }

          for (const v of violations) {
            if (v.id && !seen.has(v.id)) {
              seen.add(v.id);
              collected.push(v);
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
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6">
      {/* Page header */}
      <div className="flex items-start gap-3 mb-1">
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

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-2 gap-6 mt-6">

        {/* LEFT PANEL — Issue selector */}
        <div className="card p-5 h-fit">
          {/* Panel heading */}
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-heading font-semibold text-base text-ink dark:text-white">
              Select Violation
            </h3>
            {!historyLoading && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-teal/10 text-teal">
                {violations.length}
              </span>
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
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {violations.map((v) => {
                const isSelected = selectedViolation?.id === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      setSelectedViolation(v);
                      setResult(null);
                      setError('');
                    }}
                    className={`cursor-pointer p-3 rounded-xl transition-colors ${
                      isSelected
                        ? 'bg-teal/10 border border-teal/30'
                        : 'hover:bg-ivory dark:hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusPill severity={impactToSeverity(v.impact)} />
                      <span className="font-mono text-xs text-body dark:text-gray-400 truncate">
                        {v.id}
                      </span>
                    </div>
                    <p className="text-sm text-ink dark:text-white truncate leading-snug">
                      {v.description ?? v.help ?? v.id}
                    </p>
                  </div>
                );
              })}
            </div>
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
            className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="text-center">
                <p className="text-sm font-medium text-ink dark:text-white">
                  Generating fix with Claude AI…
                </p>
                <p className="text-xs text-body dark:text-gray-400 mt-1">
                  Analyzing the violation and crafting a remediation
                </p>
              </div>
              <div className="flex gap-1">
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
              <div className="flex items-start gap-3 p-4 rounded-xl bg-coral/10 border border-coral/20">
                <AlertCircle className="w-5 h-5 text-coral shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-coral">Generation failed</p>
                  <p className="text-xs text-coral/80 mt-0.5">{error}</p>
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
                    <p className="font-heading font-semibold text-sm text-ink dark:text-white leading-tight">
                      AI Fix Assistant
                    </p>
                    <span className="text-xs text-body dark:text-gray-400">
                      Powered by Claude
                    </span>
                  </div>
                </div>
                {result.wcagCriterion && (
                  <span className="font-mono text-xs bg-teal/10 text-teal px-2 py-1 rounded-lg border border-teal/20 shrink-0">
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

              {/* Copy button */}
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
