import { useState, useCallback } from 'react';
import {
  Keyboard,
  Eye,
  Play,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import ScoreGauge from '../components/ui/ScoreGauge';
import IssueCard from '../components/ui/IssueCard';
import { StatusBadge, StatusPill } from '../components/ui/StatusBadge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeScore(result) {
  if (!result) return 0;
  if (typeof result.score === 'number') return result.score;
  if (typeof result.keyboard_score === 'number') return result.keyboard_score;
  const issues = result.issues ?? result.elements ?? [];
  const total = result.total_elements ?? issues.length ?? 0;
  if (total === 0) return 100;
  const failing = issues.length;
  return Math.max(0, Math.round(((total - failing) / total) * 100));
}

function normalizeSeverity(raw) {
  if (!raw) return 'Moderate';
  const s = String(raw);
  if (/critical/i.test(s)) return 'Critical';
  if (/serious/i.test(s)) return 'Serious';
  if (/moderate/i.test(s)) return 'Moderate';
  if (/minor/i.test(s)) return 'Minor';
  return 'Moderate';
}

function colorHex(val) {
  if (!val) return '#888888';
  const s = String(val).trim();
  if (s.startsWith('#') && (s.length === 4 || s.length === 7)) return s;
  // rgb(r,g,b) → hex
  const m = s.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (m) {
    return (
      '#' +
      [m[1], m[2], m[3]]
        .map((n) => parseInt(n, 10).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return '#888888';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModuleCard({ id, label, subtitle, icon: Icon, active, activeColor, onClick }) {
  const borderClass = active
    ? activeColor === 'teal'
      ? 'border-teal bg-teal/5'
      : 'border-terracotta bg-terracotta/5'
    :'border-gray-200 bg-transparent hover:border-gray-300';

  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`border-2 rounded-2xl p-4 cursor-pointer text-left transition-all w-full ${borderClass}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon
          className={`w-5 h-5 ${
            active
              ? activeColor === 'teal'
                ? 'text-teal'
                : 'text-terracotta'
              :'text-body'
          }`}
        />
        <span
          className={`font-heading font-bold text-sm ${
            active ?'text-ink':'text-body'
          }`}
        >
          {label}
        </span>
      </div>
      <p className="text-xs text-body mt-0.5">{subtitle}</p>
    </button>
  );
}

function StatItem({ label, value, color }) {
  const colorClass =
    color === 'teal'
      ? 'text-teal'
      : color === 'coral'
      ? 'text-coral'
      : color === 'sage'
      ? 'text-sage'
      : color === 'amber'
      ? 'text-amber'
      :'text-ink';

  return (
    <div className="text-center">
      <p className={`font-heading font-bold text-2xl ${colorClass}`}>{value}</p>
      <p className="text-xs text-body mt-0.5">{label}</p>
    </div>
  );
}

function FocusStep({ index, element, status, isLast }) {
  const passed =
    !status || /pass|ok|good/i.test(String(status));

  return (
    <div className="flex gap-3">
      {/* Connector column */}
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
            passed ? 'bg-teal' : 'bg-coral'
          }`}
        >
          {index + 1}
        </div>
        {!isLast && (
          <div className="w-px flex-1 border-l-2 border-dashed border-gray-200 mt-1"/>
        )}
      </div>

      {/* Content */}
      <div className={`pb-4 flex-1 ${isLast ? '' : ''}`}>
        <p className="text-sm font-medium text-ink leading-snug">
          {element?.selector ?? element?.element ?? element?.tag ?? `Element ${index + 1}`}
        </p>
        {element?.description && (
          <p className="text-xs text-body mt-0.5">
            {element.description}
          </p>
        )}
        <div className="mt-1">
          {passed ? (
            <span className="inline-flex items-center gap-1 text-xs text-sage">
              <CheckCircle className="w-3 h-3" />
              {String(status || 'Focusable')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-coral">
              <XCircle className="w-3 h-3" />
              {String(status)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ContrastRow({ item }) {
  const ratio =
    typeof item.ratio === 'number'
      ? item.ratio.toFixed(2)
      : item.contrast_ratio ?? item.ratio ?? '—';

  const passes =
    item.passes ?? item.pass ?? (typeof item.ratio === 'number' && item.ratio >= 4.5);

  const fg = colorHex(item.foreground ?? item.fg ?? item.color);
  const bg = colorHex(item.background ?? item.bg ?? item.backgroundColor);

  const selector =
    item.selector ?? item.element ?? item.tag ?? 'Unknown element';

  return (
    <div className="card p-4 flex flex-col gap-3">
      {/* Selector */}
      <p className="text-xs font-mono text-body truncate"title={selector}>
        {selector}
      </p>

      {/* Color swatches row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span
            className="w-5 h-5 rounded border border-black/10 shrink-0"
            style={{ backgroundColor: fg }}
            title={`Foreground: ${fg}`}
          />
          <span className="text-xs text-body">{fg}</span>
        </div>
        <ArrowRight className="w-3 h-3 text-body shrink-0"/>
        <div className="flex items-center gap-1.5">
          <span
            className="w-5 h-5 rounded border border-black/10 shrink-0"
            style={{ backgroundColor: bg }}
            title={`Background: ${bg}`}
          />
          <span className="text-xs text-body">{bg}</span>
        </div>
      </div>

      {/* Ratio + badge */}
      <div className="flex items-center justify-between">
        <span className="font-heading font-bold text-lg text-ink">
          {ratio}:1
        </span>
        <StatusBadge status={passes ? 'Passed' : 'Failed'} />
      </div>

      {/* Preview strip */}
      <div
        className="rounded-xl px-3 py-2 text-sm font-medium truncate"
        style={{ color: fg, backgroundColor: bg }}
      >
        {item.text ?? 'Sample Text'}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-body">
      <div className="w-16 h-16 rounded-full bg-teal/10 flex items-center justify-center">
        <Keyboard className="w-8 h-8 text-teal opacity-60" />
      </div>
      <div className="text-center">
        <p className="font-heading font-semibold text-ink text-base">
          No test results yet
        </p>
        <p className="text-sm mt-1">
          Enter a URL above and run a test to see accessibility insights.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function KeyboardTestPage() {
  const [url, setUrl] = useState('');
  const [activeModule, setActiveModule] = useState('keyboard');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleRunTest = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a URL to test.');
      return;
    }
    setLoading(true);
    setResult(null);
    setError('');

    const endpoint =
      activeModule === 'keyboard'
        ? '/api/assisted/keyboard'
        : '/api/assisted/color-contrast';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? 'Test failed. Please check the URL and try again.');
      } else {
        setResult(data.result ?? data);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [url, activeModule]);

  // ---------------------------------------------------------------------------
  // Derived data — keyboard
  // ---------------------------------------------------------------------------
  const kbScore = computeScore(result);
  const kbIssues = result?.issues ?? result?.elements ?? [];
  const tabOrder = result?.tab_order ?? result?.focus_order ?? [];
  const focusSteps =
    tabOrder.length > 0
      ? tabOrder
      : kbIssues.length > 0
      ? kbIssues
      : [];

  const focusIndicators =
    result?.focus_indicators ?? result?.visible_focus_count ?? '—';
  const skipLinks =
    result?.skip_links ?? result?.skip_link_count ?? '—';

  // ---------------------------------------------------------------------------
  // Derived data — color contrast
  // ---------------------------------------------------------------------------
  const contrastItems = result?.elements ?? result?.results ?? result?.items ?? [];

  return (
    <div className="flex-1 overflow-auto bg-ivory p-6 space-y-6">

      {/* 1. HEADER */}
      <div>
        <h2 className="font-heading font-bold text-2xl text-ink">
          Keyboard &amp; Accessibility Testing
        </h2>
        <p className="text-sm text-body mt-1">
          Validate keyboard navigation, focus management, and color contrast compliance
          against WCAG standards.
        </p>
      </div>

      {/* 2. MODULE SELECTOR */}
      <div className="card p-4">
        <p className="text-xs font-medium text-body mb-3 uppercase tracking-wide">
          Select test module
        </p>
        <div className="grid grid-cols-2 gap-3">
          <ModuleCard
            id="keyboard"
            label="Keyboard Navigation"
            subtitle="Tab order, focus traps, visible focus"
            icon={Keyboard}
            active={activeModule === 'keyboard'}
            activeColor="teal"
            onClick={(id) => {
              setActiveModule(id);
              setResult(null);
              setError('');
            }}
          />
          <ModuleCard
            id="color-contrast"
            label="Color Contrast"
            subtitle="WCAG 1.4.3 contrast ratio checks"
            icon={Eye}
            active={activeModule === 'color-contrast'}
            activeColor="terracotta"
            onClick={(id) => {
              setActiveModule(id);
              setResult(null);
              setError('');
            }}
          />
        </div>
      </div>

      {/* 3. URL INPUT CARD */}
      <div className="card p-5">
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) handleRunTest();
            }}
            placeholder="https://example.com"
            className="input-base flex-1"
            disabled={loading}
          />
          <button
            onClick={handleRunTest}
            disabled={loading || !url.trim()}
            className="btn-primary flex items-center gap-2 min-w-[120px] justify-center"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Test
              </>
            )}
          </button>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mt-3 flex items-start gap-2 bg-coral/15 text-coral rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 4. LOADING STATE */}
      {loading && (
        <div className="card p-10 flex flex-col items-center justify-center gap-4 text-body">
          <span className="w-10 h-10 border-4 border-teal/20 border-t-teal rounded-full animate-spin" />
          <p className="text-sm font-medium">Running test…</p>
          <p className="text-xs opacity-60">
            This may take a few seconds depending on page complexity.
          </p>
        </div>
      )}

      {/* 5. RESULTS */}
      {!loading && result && activeModule === 'keyboard' && (
        <>
          {/* A. Keyboard Health Score */}
          <div className="card p-6">
            <h3 className="font-heading font-bold text-base text-ink mb-4">
              Keyboard Health Score
            </h3>
            <div className="flex items-center gap-8 flex-wrap">
              <ScoreGauge score={kbScore} size={120} />
              <div className="flex gap-8 flex-wrap">
                <StatItem
                  label="Keyboard Score"
                  value={`${kbScore}%`}
                  color="teal"
                />
                <StatItem
                  label="Focus Indicators"
                  value={focusIndicators}
                  color={
                    typeof focusIndicators === 'number' && focusIndicators > 0
                      ? 'sage'
                      : 'coral'
                  }
                />
                <StatItem
                  label="Skip Links"
                  value={skipLinks}
                  color={
                    typeof skipLinks === 'number' && skipLinks > 0
                      ? 'sage'
                      : 'amber'
                  }
                />
                <StatItem
                  label="Issues Found"
                  value={kbIssues.length}
                  color={kbIssues.length === 0 ? 'sage' : 'coral'}
                />
              </div>
            </div>
          </div>

          {/* B. Focus Order Visualization */}
          {focusSteps.length > 0 && (
            <div className="card p-6">
              <h3 className="font-heading font-bold text-base text-ink mb-4">
                Focus Order
              </h3>
              <div className="max-h-96 overflow-y-auto pr-1 space-y-0">
                {focusSteps.map((step, i) => (
                  <FocusStep
                    key={i}
                    index={i}
                    element={typeof step === 'string' ? { selector: step } : step}
                    status={step?.status ?? step?.result ?? (step?.passes === false ? 'Failed' : 'Focusable')}
                    isLast={i === focusSteps.length - 1}
                  />
                ))}
              </div>
            </div>
          )}

          {/* C. Detected Issues */}
          {kbIssues.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="font-heading font-bold text-base text-ink">
                  Detected Issues
                </h3>
                <span className="bg-coral/15 text-coral text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  {kbIssues.length}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {kbIssues.map((issue, i) => (
                  <IssueCard
                    key={issue.id ?? i}
                    title={issue.title ?? issue.description ?? issue.selector ?? `Issue ${i + 1}`}
                    detail={issue.detail ?? issue.help ?? issue.message ?? ''}
                    severity={normalizeSeverity(issue.severity ?? issue.impact)}
                    wcag={issue.wcag ?? issue.wcagCriterion ?? issue.tags?.[0]}
                  />
                ))}
              </div>
            </div>
          )}

          {/* No issues */}
          {kbIssues.length === 0 && focusSteps.length === 0 && (
            <div className="card p-8 flex flex-col items-center justify-center gap-3 text-sage">
              <CheckCircle className="w-10 h-10" />
              <p className="font-heading font-bold text-base text-ink">
                No keyboard issues detected
              </p>
              <p className="text-sm text-body">
                This page appears to have good keyboard accessibility.
              </p>
            </div>
          )}
        </>
      )}

      {/* Color Contrast Results */}
      {!loading && result && activeModule === 'color-contrast' && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-heading font-bold text-base text-ink">
              Contrast Results
            </h3>
            {contrastItems.length > 0 && (
              <span className="bg-teal/15 text-teal text-xs font-semibold px-2.5 py-0.5 rounded-full">
                {contrastItems.length} elements
              </span>
            )}
          </div>

          {contrastItems.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {contrastItems.map((item, i) => (
                <ContrastRow key={i} item={item} />
              ))}
            </div>
          ) : (
            /* Fallback: show raw result summary if items array is empty */
            <div className="flex flex-col items-center gap-3 py-8 text-body">
              <CheckCircle className="w-8 h-8 text-sage" />
              <p className="text-sm">
                {result.message ?? 'Color contrast check complete. No elements returned.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 6. EMPTY STATE */}
      {!loading && !result && <EmptyState />}
    </div>
  );
}
