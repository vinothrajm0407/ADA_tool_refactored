// An issue Auto Fix already handles: its PR is open (and not rejected) or merged.
// `fix` is one entry of page-summary's `fixes` (latest fix per rule on a page).
export const coveredFix = (f) =>
  !!f?.pr_url && f.approval_status !== 'rejected' && (f.pr_state === 'open' || f.pr_state === 'merged');

// Auto-fixable issues on a page that nothing handles yet.
export const remainingFixable = (s) =>
  Math.max(0, (s?.fixable || 0) - Object.values(s?.fixes || {}).filter(coveredFix).length);
