// Pure helpers behind the Fix History page: grouping, summary numbers,
// filtering and sorting. Kept free of React so
// they are unit-tested directly (fixHistoryUtils.test.js).

const DAY_MS = 86400000;

// "vinothrajm0407.github.io/ADA-AutoFix-Test-GitHub-3" for Pages-style hosts
// (one site per first path segment), plain host otherwise.
export function siteOf(fix) {
  try {
    const u = new URL(fix.page_url);
    const first = u.pathname.split('/').filter(Boolean)[0];
    return /\.(github|gitlab)\.io$/.test(u.hostname) && first ? `${u.hostname}/${first}` : u.hostname;
  } catch {
    return fix.page_url || 'Unknown site';
  }
}

// 'none' (no PR), 'open', 'merged' or 'closed'.
export function prStateOf(fix) {
  if (!fix.pr_url) return 'none';
  return fix.pr_state || (fix.merged ? 'merged' : 'open');
}

// In-tool approval: 'pending' (waiting for an Approver), 'changes_requested'
// (sent back to the developer), 'approved', 'rejected' or null.
export function approvalOf(fix) {
  if (fix.approval_status) return fix.approval_status;
  return prStateOf(fix) === 'open' ? 'pending' : null;
}

// Open PR waiting for the Approver's decision.
export function isReviewable(fix) {
  return prStateOf(fix) === 'open' && approvalOf(fix) === 'pending';
}

// Same threshold as the backend's daily reminder (fix_notify.REMINDER_DAYS).
export const REMINDER_DAYS = 3;

// Days a reviewable fix has been waiting, or null when it isn't waiting.
export function waitingDays(fix, now = new Date()) {
  return isReviewable(fix) ? daysBetween(fix.created_at, now.toISOString()) : null;
}

// One fix per pull request: a batch PR has a row per element, and one decision covers them all.
export function onePerPr(fixes) {
  const seen = new Set();
  return fixes.filter(f => !seen.has(f.pr_url) && seen.add(f.pr_url));
}

export function isFailed(fix) {
  return fix.status !== 'verified' && fix.status !== 'partial';
}

export function daysBetween(a, b) {
  const t1 = Date.parse(a), t2 = Date.parse(b);
  return Number.isNaN(t1) || Number.isNaN(t2) ? null : Math.max(0, Math.round((t2 - t1) / DAY_MS));
}

export function summarize(fixes) {
  const s = { total: fixes.length, verified: 0, failed: 0, awaiting: 0, approved: 0, merged: 0, closed: 0, avgDaysToMerge: null };
  const days = [];
  for (const f of fixes) {
    if (isFailed(f)) s.failed += 1; else s.verified += 1;
    const pr = prStateOf(f);
    if (pr === 'open') s.awaiting += 1;
    if (pr === 'merged') s.merged += 1;
    if (pr === 'closed') s.closed += 1;
    if (f.approved_by?.length) s.approved += 1;
    if (pr === 'merged' && f.merged_at) {
      const d = daysBetween(f.created_at, f.merged_at);
      if (d !== null) days.push(d);
    }
  }
  if (days.length) s.avgDaysToMerge = days.reduce((a, b) => a + b, 0) / days.length;
  return s;
}

// Local-calendar YYYY-MM-DD, so a fix at 23:30 lands on the day the user saw it.
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function filterFixes(fixes, { status = 'all', pr = 'all', site = 'all', q = '', from = '', to = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return fixes.filter(f => {
    if (status === 'verified' && isFailed(f)) return false;
    if (status === 'failed' && !isFailed(f)) return false;
    if (pr === 'changes') { if (approvalOf(f) !== 'changes_requested') return false; }
    else if (pr === 'open') { if (!isReviewable(f)) return false; }
    else if (pr !== 'all' && prStateOf(f) !== pr) return false;
    if (site !== 'all' && siteOf(f) !== site) return false;
    const day = dayKey(f.created_at) || '';
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (needle) {
      const hay = [f.rule_id, f.help, f.page_url, f.selector, f.file, f.pr_url, f.error_message, f.merged_by,
        f.fixed_by, f.review_comment, ...(f.approved_by || [])].join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

const SORT_VALUE = {
  rule: f => f.rule_id || '',
  page: f => f.page_url || '',
  status: f => (isFailed(f) ? 1 : 0),
  pr: f => ['open', 'merged', 'closed', 'none'].indexOf(prStateOf(f)),
  approved: f => (f.approved_by || []).join(', '),
  merged: f => f.merged_at || '',
  date: f => f.created_at || '',
  fixedBy: f => f.fixed_by || '',
};

export function sortFixes(fixes, key = 'date', dir = 'desc') {
  const val = SORT_VALUE[key] || SORT_VALUE.date;
  const sign = dir === 'asc' ? 1 : -1;
  return [...fixes].sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

// [{ site, fixes, summary }] sorted by most fixes first.
export function groupBySite(fixes) {
  const groups = new Map();
  for (const f of fixes) {
    const s = siteOf(f);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(f);
  }
  return [...groups.entries()]
    .map(([site, list]) => ({ site, fixes: list, summary: summarize(list) }))
    .sort((a, b) => b.fixes.length - a.fixes.length);
}
