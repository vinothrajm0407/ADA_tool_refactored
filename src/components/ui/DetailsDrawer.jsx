import { X, Loader2, AlertCircle } from 'lucide-react';
import ScoreGauge from './ScoreGauge';
import StatusBadge from './StatusBadge';
import IssueCard from './IssueCard';

function wcagTagFrom(tags) {
  if (!Array.isArray(tags)) return null;
  const t = tags.find((t) => typeof t === 'string' && t.toLowerCase().startsWith('wcag'));
  return t ? t.toUpperCase() : null;
}

function mapViolationToCard(v) {
  return {
    title: v.help || v.description || v.id,
    detail: v.description || '',
    severity: v.impact || 'minor',
    wcag: wcagTagFrom(v.tags),
  };
}

export default function DetailsDrawer({ row, onClose, onOpenFullReport }) {
  if (!row) return null;

  const {
    url,
    score,
    passRate,
    violationCount,
    violations,
    violationsLoading,
    status,
  } = row;

  // Derive recommendation from score
  const recommendedStep =
    score >= 90
      ? 'Run a full manual keyboard-navigation check to confirm no focus-order issues remain.'
      : score >= 70
      ? 'Address the serious and critical violations first, then re-scan to confirm improvement.'
      : 'Engage an accessibility specialist to perform a comprehensive remediation audit before the next release.';

  const hasViolationDetail = Array.isArray(violations) && violations.length > 0;
  const noScanHistoryId = !violationsLoading && !hasViolationDetail && violationCount > 0 && violations !== null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="relative h-full w-full max-w-md bg-white flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Page Details"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="font-heading text-lg text-ink">Page Details</h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 rounded-xl text-body hover:text-ink transition-colors"
            aria-label="Close drawer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-5 flex-1">

          {/* URL */}
          <div>
            <p className="text-xs font-body font-medium text-body uppercase tracking-wide mb-1.5">
              URL
            </p>
            <code className="block w-full bg-gray-50 text-ink text-sm font-mono px-3 py-2 rounded-2xl border border-gray-100 break-all">
              {url}
            </code>
          </div>

          {/* Score + Pass Rate row */}
          <div className="card flex items-center gap-5 p-4">
            <ScoreGauge score={score} size={80} />
            <div className="flex-1 min-w-0 space-y-1">
              <div>
                <p className="text-xs font-body font-medium text-body uppercase tracking-wide mb-0.5">
                  Accessibility Score
                </p>
                <p className="font-heading text-4xl text-ink leading-none">
                  {score}
                  <span className="text-base font-normal text-body ml-1">/100</span>
                </p>
              </div>
              {passRate != null && (
                <p className="text-sm text-body">
                  Pass rate: <span className="font-semibold text-ink">{passRate}%</span>
                </p>
              )}
            </div>
          </div>

          {/* Violations count */}
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100">
            <span className="text-sm font-body font-medium text-body">
              Violations Found
            </span>
            <span className={`font-heading text-xl ${(violationCount ?? 0) > 0 ?'text-coral-700':'text-sage-700'}`}>
              {violationCount ?? 0}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-body font-medium text-body">Status</span>
            <StatusBadge status={status} />
          </div>

          {/* Violation list */}
          {(violationCount ?? 0) > 0 && (
            <div>
              <p className="text-xs font-body font-medium text-body uppercase tracking-wide mb-2">
                Violations
              </p>

              {violationsLoading && (
                <div className="flex items-center gap-2 text-body text-sm py-4 justify-center">
                  <Loader2 size={15} className="animate-spin text-teal" />
                  Loading violation details…
                </div>
              )}

              {!violationsLoading && violations === null && (
                <div className="flex items-center gap-2 text-body text-xs py-2">
                  <AlertCircle size={14} className="text-amber-800 flex-shrink-0"/>
                  Violation detail unavailable — database not configured.
                </div>
              )}

              {!violationsLoading && hasViolationDetail && (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {violations.map((v, i) => {
                    const card = mapViolationToCard(v);
                    return (
                      <IssueCard
                        key={v.id ? `${v.id}-${i}` : i}
                        title={card.title}
                        detail={card.detail}
                        severity={card.severity}
                        wcag={card.wcag}
                      />
                    );
                  })}
                </div>
              )}

              {!violationsLoading && violations !== null && !hasViolationDetail && violationCount > 0 && (
                <p className="text-xs text-body py-2">
                  Violation data not yet available for this page.
                </p>
              )}
            </div>
          )}

          {/* Recommended Next Step */}
          <div className="rounded-2xl bg-teal/5 border border-teal/20 p-4">
            <p className="text-xs font-body font-medium text-teal uppercase tracking-wide mb-1.5">
              Recommended Next Step
            </p>
            <p className="text-sm font-body text-body leading-relaxed">
              {recommendedStep}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 shrink-0">
          <button
            className="btn-primary w-full"
            onClick={onOpenFullReport}
            disabled={!onOpenFullReport}
          >
            Open Full Report
          </button>
        </div>
      </div>
    </div>
  );
}
