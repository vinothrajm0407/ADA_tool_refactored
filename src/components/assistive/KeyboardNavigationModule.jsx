import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import ScoreGauge from '../ui/ScoreGauge';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeScore(checks) {
  if (!checks?.length) return 0;
  const passed = checks.filter((c) => c.passed).length;
  return Math.round((passed / checks.length) * 100);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatItem({ label, value, color }) {
  const colorClass = {
    teal: 'text-teal',
    coral: 'text-coral',
    sage: 'text-sage',
    amber: 'text-amber',
  }[color] ?? 'text-ink dark:text-white';
  return (
    <div className="text-center">
      <p className={`font-heading font-bold text-2xl ${colorClass}`}>{value}</p>
      <p className="text-xs text-body dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function CheckItem({ check }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 dark:border-white/[0.04] last:border-0">
      <div className="mt-0.5 shrink-0">
        {check.passed
          ? <CheckCircle size={15} className="text-sage" />
          : <XCircle size={15} className="text-coral" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-snug ${
          check.passed ? 'text-ink dark:text-white' : 'text-coral'
        }`}>
          {check.label}
        </p>
        {check.details && (
          <p className="text-xs text-body dark:text-gray-500 mt-0.5">{check.details}</p>
        )}
      </div>
    </div>
  );
}

function FocusStep({ index, selector, isLast }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-teal/10 text-teal flex items-center justify-center text-xs font-bold shrink-0">
          {index + 1}
        </div>
        {!isLast && (
          <div className="w-px flex-1 border-l-2 border-dashed border-gray-200 dark:border-white/10 mt-1" />
        )}
      </div>
      <div className="pb-4 flex-1">
        <p className="text-xs font-mono text-ink dark:text-white leading-snug break-all">
          {selector}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function KeyboardNavigationModule({ result }) {
  // result.metadata is the raw API response from /api/assisted/keyboard
  const raw = result?.metadata ?? result;

  const checks     = raw?.checks ?? [];
  const failed     = raw?.failedChecks ?? checks.filter((c) => !c.passed);
  const focusPath  = raw?.focusPathSample ?? [];
  const pageTitle  = raw?.title ?? '';
  const errors     = raw?.errors ?? [];
  const score      = computeScore(checks);
  const passedCount = checks.filter((c) => c.passed).length;

  // Playwright error — show clearly
  if (errors.length > 0 && checks.length === 0) {
    return (
      <div className="card p-6 flex items-start gap-3 bg-coral/5 border border-coral/20">
        <AlertCircle size={18} className="text-coral shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm text-coral">Test could not complete</p>
          <p className="text-xs text-body dark:text-gray-400 mt-1">{errors[0]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Score card */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white">
            Keyboard Health Score
          </h3>
          {pageTitle && (
            <p className="text-xs text-body dark:text-gray-500 truncate max-w-xs text-right" title={pageTitle}>
              {pageTitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-8 flex-wrap">
          <ScoreGauge score={score} size={120} />
          <div className="flex gap-8 flex-wrap">
            <StatItem label="Score" value={`${score}%`} color="teal" />
            <StatItem
              label="Checks Run"
              value={checks.length || '—'}
              color="teal"
            />
            <StatItem
              label="Passed"
              value={checks.length > 0 ? passedCount : '—'}
              color={passedCount === checks.length && checks.length > 0 ? 'sage' : 'amber'}
            />
            <StatItem
              label="Failed"
              value={failed.length}
              color={failed.length === 0 ? 'sage' : 'coral'}
            />
          </div>
        </div>
      </div>

      {/* Automated checks list */}
      {checks.length > 0 && (
        <div className="card p-5">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-1">
            Automated Checks
          </h3>
          <div>
            {checks.map((check, i) => (
              <CheckItem key={check.id ?? i} check={check} />
            ))}
          </div>
        </div>
      )}

      {/* Tab order sample */}
      {focusPath.length > 0 && (
        <div className="card p-6">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-1">
            Tab Order Sample
          </h3>
          <p className="text-xs text-body dark:text-gray-500 mb-4">
            First {focusPath.length} element{focusPath.length !== 1 ? 's' : ''} reached by the Tab key
          </p>
          <div className="max-h-80 overflow-y-auto pr-1">
            {focusPath.map((selector, i) => (
              <FocusStep
                key={i}
                index={i}
                selector={selector}
                isLast={i === focusPath.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* All clear */}
      {checks.length > 0 && failed.length === 0 && (
        <div className="card p-8 flex flex-col items-center justify-center gap-3">
          <CheckCircle className="w-10 h-10 text-sage" />
          <p className="font-heading font-bold text-base text-ink dark:text-white">
            All keyboard checks passed
          </p>
          <p className="text-sm text-body dark:text-gray-400">
            This page passed all automated keyboard accessibility checks.
          </p>
        </div>
      )}

    </div>
  );
}
