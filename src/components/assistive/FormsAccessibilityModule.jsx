import { CheckCircle, XCircle, AlertCircle, AlertTriangle, Tag } from 'lucide-react';
import ScoreGauge from '../ui/ScoreGauge';

// ─── Severity styles ──────────────────────────────────────────────────────────

const SEV = {
  error:   { Icon: XCircle,       bg: 'bg-coral/5 border-coral/20',   text: 'text-coral',  label: 'Error'   },
  warning: { Icon: AlertTriangle,  bg: 'bg-amber/5 border-amber/20',   text: 'text-amber',  label: 'Warning' },
};

// ─── Label method badge ───────────────────────────────────────────────────────

const METHOD_STYLE = {
  'label-for':       'bg-teal/10 text-teal',
  'aria-label':      'bg-teal/10 text-teal',
  'aria-labelledby': 'bg-teal/10 text-teal',
  'wrapping-label':  'bg-teal/10 text-teal',
  'title':           'bg-amber/10 text-amber',
  'placeholder-only':'bg-amber/10 text-amber',
  'none':            'bg-coral/10 text-coral',
};

const METHOD_LABEL = {
  'label-for':       '<label for>',
  'aria-label':      'aria-label',
  'aria-labelledby': 'aria-labelledby',
  'wrapping-label':  'wrapping label',
  'title':           'title attr',
  'placeholder-only':'placeholder only',
  'none':            'no label',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatItem({ label, value, color = 'default' }) {
  const colors = {
    teal: 'text-teal', coral: 'text-coral',
    amber: 'text-amber', sage: 'text-sage',
    default: 'text-ink dark:text-white',
  };
  return (
    <div className="text-center">
      <p className={`font-heading font-bold text-2xl ${colors[color]}`}>{value ?? '—'}</p>
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
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium leading-snug ${check.passed ? 'text-ink dark:text-white' : 'text-coral'}`}>
            {check.label}
          </p>
          {check.wcag && (
            <span className="text-[10px] font-mono bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400 px-1.5 py-0.5 rounded">
              WCAG {check.wcag}
            </span>
          )}
        </div>
        {check.details && (
          <p className="text-xs text-body dark:text-gray-500 mt-0.5">{check.details}</p>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue }) {
  const style = SEV[issue.severity] ?? SEV.warning;
  const { Icon } = style;
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${style.bg}`}>
      <Icon size={15} className={`${style.text} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium leading-snug ${style.text}`}>{issue.message}</p>
          {issue.wcag && (
            <span className="text-[10px] font-mono bg-white/60 dark:bg-white/10 text-body dark:text-gray-400 px-1.5 py-0.5 rounded">
              WCAG {issue.wcag}
            </span>
          )}
        </div>
        {issue.detail && (
          <p className="text-xs text-body dark:text-gray-400 mt-0.5 break-words">{issue.detail}</p>
        )}
        {issue.selector && (
          <p className="text-[10px] font-mono text-body dark:text-gray-500 mt-1 truncate">{issue.selector}</p>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field }) {
  const methodStyle = METHOD_STYLE[field.labelMethod] ?? METHOD_STYLE.none;
  const methodLabel = METHOD_LABEL[field.labelMethod] ?? field.labelMethod;

  return (
    <div className="py-3 border-b border-gray-50 dark:border-white/[0.04] last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {field.hasLabel
            ? <CheckCircle size={14} className="text-sage" />
            : <XCircle size={14} className="text-coral" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-xs font-mono text-ink dark:text-gray-200 truncate">
              {field.selector}
            </p>
            <span className="text-[10px] bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400 px-1.5 py-0.5 rounded font-mono">
              {field.type}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Label method */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${methodStyle}`}>
              {methodLabel}
            </span>

            {/* Label text */}
            {field.labelText && (
              <span className="text-[10px] text-body dark:text-gray-500 truncate max-w-[180px]" title={field.labelText}>
                "{field.labelText}"
              </span>
            )}

            {/* Required */}
            {field.hasRequired && (
              <span className="text-[10px] bg-teal/10 text-teal px-1.5 py-0.5 rounded font-medium">
                required
              </span>
            )}

            {/* Autocomplete */}
            {field.hasAutocomplete && (
              <span className="text-[10px] bg-sage/10 text-sage px-1.5 py-0.5 rounded font-mono">
                autocomplete="{field.autocompleteValue}"
              </span>
            )}
            {field.needsAutocomplete && (
              <span className="text-[10px] bg-amber/10 text-amber px-1.5 py-0.5 rounded font-medium">
                needs autocomplete
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FormsAccessibilityModule({ result }) {
  const raw = result?.metadata ?? result;

  const checks               = raw?.checks ?? [];
  const fields               = raw?.fields ?? [];
  const issues               = raw?.issues ?? [];
  const errors               = raw?.errors ?? [];
  const pageTitle            = raw?.title ?? '';
  const score                = raw?.score ?? 0;
  const totalFields          = raw?.totalFields ?? fields.length;
  const labelledFields       = raw?.labelledFields ?? 0;
  const unlabelledFields     = raw?.unlabelledFields ?? 0;
  const placeholderOnlyFields = raw?.placeholderOnlyFields ?? 0;

  const errorIssues   = issues.filter(i => i.severity === 'error');
  const warningIssues = issues.filter(i => i.severity === 'warning');

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

  if (totalFields === 0 && checks.length > 0) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3">
        <Tag className="w-10 h-10 text-body dark:text-gray-400 opacity-50" />
        <p className="font-heading font-bold text-base text-ink dark:text-white">
          No form inputs detected
        </p>
        <p className="text-sm text-body dark:text-gray-400 text-center max-w-sm">
          This page does not appear to contain any interactive form fields.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Score card */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white">
            Forms Accessibility Score
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
            <StatItem label="Total Fields" value={totalFields} color="teal" />
            <StatItem
              label="Labelled"
              value={labelledFields}
              color={labelledFields === totalFields ? 'sage' : 'amber'}
            />
            <StatItem
              label="Errors"
              value={errorIssues.length}
              color={errorIssues.length === 0 ? 'sage' : 'coral'}
            />
            <StatItem
              label="Warnings"
              value={warningIssues.length}
              color={warningIssues.length === 0 ? 'sage' : 'amber'}
            />
          </div>
        </div>
        {placeholderOnlyFields > 0 && (
          <p className="text-xs text-amber mt-4">
            {placeholderOnlyFields} input(s) counted as unlabelled — placeholder disappears on focus
          </p>
        )}
      </div>

      {/* Automated checks */}
      {checks.length > 0 && (
        <div className="card p-5">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-1">
            Automated Checks
          </h3>
          <div>
            {checks.map((c, i) => <CheckItem key={c.id ?? i} check={c} />)}
          </div>
        </div>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <div className="card p-5 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-heading font-bold text-base text-ink dark:text-white">
              Issues Found
            </h3>
            {errorIssues.length > 0 && (
              <span className="bg-coral/10 text-coral text-xs font-semibold px-2 py-0.5 rounded-full">
                {errorIssues.length} error{errorIssues.length !== 1 ? 's' : ''}
              </span>
            )}
            {warningIssues.length > 0 && (
              <span className="bg-amber/10 text-amber text-xs font-semibold px-2 py-0.5 rounded-full">
                {warningIssues.length} warning{warningIssues.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
        </div>
      )}

      {/* Field inventory */}
      {fields.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-heading font-bold text-base text-ink dark:text-white">
              Field Inventory
            </h3>
            <span className="bg-teal/10 text-teal text-xs font-semibold px-2 py-0.5 rounded-full">
              {fields.length} input{fields.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-body dark:text-gray-500 mb-3">
            Label method, required status, and autocomplete for each visible input
          </p>
          <div className="max-h-96 overflow-y-auto">
            {fields.map((f, i) => <FieldRow key={i} field={f} />)}
          </div>
        </div>
      )}

      {/* All clear */}
      {checks.length > 0 && issues.length === 0 && totalFields > 0 && (
        <div className="card p-8 flex flex-col items-center gap-3">
          <CheckCircle className="w-10 h-10 text-sage" />
          <p className="font-heading font-bold text-base text-ink dark:text-white">
            All form accessibility checks passed
          </p>
          <p className="text-sm text-body dark:text-gray-400">
            All {totalFields} input{totalFields !== 1 ? 's' : ''} are correctly labelled and meet WCAG requirements.
          </p>
        </div>
      )}

    </div>
  );
}
