import { CheckCircle, XCircle, AlertCircle, AlertTriangle, ChevronRight } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  error:   { icon: XCircle,        bg: 'bg-coral/5 border-coral/20',   text: 'text-coral',  label: 'Error'   },
  warning: { icon: AlertTriangle,   bg: 'bg-amber/5 border-amber/20',   text: 'text-amber',  label: 'Warning' },
};

function IssueCard({ issue }) {
  const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.warning;
  const Icon = style.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${style.bg}`}>
      <Icon size={15} className={`${style.text} shrink-0 mt-0.5`} />
      <div>
        <p className={`text-sm font-medium leading-snug ${style.text}`}>{issue.message}</p>
        {issue.detail && (
          <p className="text-xs text-body dark:text-gray-400 mt-0.5">{issue.detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Heading tree ─────────────────────────────────────────────────────────────

const INDENT = { 1: 0, 2: 16, 3: 32, 4: 48, 5: 60, 6: 72 };
const LEVEL_COLORS = {
  1: 'bg-teal/10 text-teal border-teal/20',
  2: 'bg-brand-blue/10 text-brand-blue border-brand-blue/20',
  3: 'bg-sage/10 text-sage border-sage/20',
  4: 'bg-amber/10 text-amber border-amber/20',
  5: 'bg-terracotta/10 text-terracotta border-terracotta/20',
  6: 'bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400 border-gray-200 dark:border-white/10',
};

function HeadingRow({ heading }) {
  const color = LEVEL_COLORS[heading.level] ?? LEVEL_COLORS[6];
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: INDENT[heading.level] ?? 72 }}>
      <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
        H{heading.level}
      </span>
      <p className="text-sm text-ink dark:text-gray-200 leading-snug truncate flex-1" title={heading.text}>
        {heading.text || <em className="text-body dark:text-gray-500">(empty)</em>}
      </p>
    </div>
  );
}

// ─── Landmark badge ───────────────────────────────────────────────────────────

const LANDMARK_COLORS = {
  main:           'bg-teal/10 text-teal',
  navigation:     'bg-brand-blue/10 text-brand-blue',
  banner:         'bg-sage/10 text-sage',
  contentinfo:    'bg-terracotta/10 text-terracotta',
  complementary:  'bg-amber/10 text-amber',
  search:         'bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400',
  form:           'bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400',
  region:         'bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400',
};

function LandmarkChip({ landmark }) {
  const color = LANDMARK_COLORS[landmark.role] ?? LANDMARK_COLORS.region;
  const label = landmark.label || (landmark.tagName !== landmark.role ? `<${landmark.tagName}>` : '');
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold ${color}`}>
      <span className="font-mono">{landmark.role}</span>
      {label && <span className="opacity-60 font-normal">{label}</span>}
    </div>
  );
}

// ─── Stat item ────────────────────────────────────────────────────────────────

function StatItem({ label, value, color = 'default' }) {
  const colors = { teal: 'text-teal', coral: 'text-coral', amber: 'text-amber', sage: 'text-sage', default: 'text-ink dark:text-white' };
  return (
    <div className="text-center">
      <p className={`font-heading font-bold text-2xl ${colors[color]}`}>{value}</p>
      <p className="text-xs text-body dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

// ─── Check item ───────────────────────────────────────────────────────────────

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
        <p className={`text-sm font-medium leading-snug ${check.passed ? 'text-ink dark:text-white' : 'text-coral'}`}>
          {check.label}
        </p>
        {check.details && (
          <p className="text-xs text-body dark:text-gray-500 mt-0.5">{check.details}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PageStructureModule({ result }) {
  const raw = result?.metadata ?? result;

  const checks         = raw?.checks ?? [];
  const headings       = raw?.headings ?? [];
  const headingIssues  = raw?.headingIssues ?? [];
  const landmarks      = raw?.landmarks ?? [];
  const landmarkIssues = raw?.landmarkIssues ?? [];
  const errors         = raw?.errors ?? [];
  const pageTitle      = raw?.title ?? '';

  const allIssues    = [...headingIssues, ...landmarkIssues];
  const errorCount   = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;

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

      {/* Summary */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white">
            Page Structure
          </h3>
          {pageTitle && (
            <p className="text-xs text-body dark:text-gray-500 truncate max-w-xs text-right" title={pageTitle}>
              {pageTitle}
            </p>
          )}
        </div>
        <div className="flex gap-8 flex-wrap">
          <StatItem label="Headings" value={headings.length} color="teal" />
          <StatItem label="Landmarks" value={landmarks.length} color="teal" />
          <StatItem
            label="Errors"
            value={errorCount}
            color={errorCount === 0 ? 'sage' : 'coral'}
          />
          <StatItem
            label="Warnings"
            value={warningCount}
            color={warningCount === 0 ? 'sage' : 'amber'}
          />
        </div>
      </div>

      {/* Automated checks */}
      {checks.length > 0 && (
        <div className="card p-5">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-1">
            Automated Checks
          </h3>
          <div>
            {checks.map((check, i) => <CheckItem key={check.id ?? i} check={check} />)}
          </div>
        </div>
      )}

      {/* Issues */}
      {allIssues.length > 0 && (
        <div className="card p-5 space-y-2">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-3">
            Issues Found
          </h3>
          {allIssues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
        </div>
      )}

      {/* Heading tree */}
      {headings.length > 0 && (
        <div className="card p-5">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-1">
            Heading Tree
          </h3>
          <p className="text-xs text-body dark:text-gray-500 mb-4">
            {headings.length} heading{headings.length !== 1 ? 's' : ''} — indentation shows nesting level
          </p>
          <div className="max-h-96 overflow-y-auto">
            {headings.map((h, i) => <HeadingRow key={i} heading={h} />)}
          </div>
        </div>
      )}

      {/* Landmarks */}
      {landmarks.length > 0 && (
        <div className="card p-5">
          <h3 className="font-heading font-bold text-base text-ink dark:text-white mb-3">
            Landmark Regions
          </h3>
          <div className="flex flex-wrap gap-2">
            {landmarks.map((l, i) => <LandmarkChip key={i} landmark={l} />)}
          </div>
        </div>
      )}

      {/* All clear */}
      {checks.length > 0 && allIssues.length === 0 && (
        <div className="card p-8 flex flex-col items-center gap-3">
          <CheckCircle className="w-10 h-10 text-sage" />
          <p className="font-heading font-bold text-base text-ink dark:text-white">
            Page structure looks good
          </p>
          <p className="text-sm text-body dark:text-gray-400">
            Heading hierarchy is logical and key landmark regions are present.
          </p>
        </div>
      )}

    </div>
  );
}
