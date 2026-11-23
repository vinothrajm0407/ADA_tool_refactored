import { describe, it, expect } from 'vitest';
import { siteOf, prStateOf, approvalOf, summarize, filterFixes, sortFixes, groupBySite, isReviewable, waitingDays, onePerPr } from './fixHistoryUtils';

const G3 = 'https://vinothrajm0407.github.io/ADA-AutoFix-Test-GitHub-3/';
const G2 = 'https://vinothrajm0407.github.io/ADA-AutoFix-Test-GitHub-2/';
const fixes = [
  { id: 1, rule_id: 'image-alt', page_url: G3, status: 'verified', pr_url: 'https://g/pull/3', pr_state: 'merged',
    merged_by: 'lead', created_at: '2026-11-17T10:00:00Z', merged_at: '2026-11-19T10:00:00Z', approved_by: ['alice'] },
  { id: 2, rule_id: 'object-alt', page_url: G3, status: 'verified', pr_url: 'https://g/pull/1', pr_state: 'open',
    created_at: '2026-11-19T09:00:00Z', approved_by: [] },
  { id: 3, rule_id: 'label', page_url: G2, status: 'failed', error_message: 'Could not match', created_at: '2026-11-18T09:00:00Z' },
  { id: 4, rule_id: 'label', page_url: 'https://example.com/a', status: 'verified', pr_url: 'https://g/pull/9',
    pr_state: 'closed', created_at: '2026-10-01T09:00:00Z' },
];

describe('fix history helpers', () => {
  it('names sites per Pages repo, plain host otherwise', () => {
    expect(siteOf(fixes[0])).toBe('vinothrajm0407.github.io/ADA-AutoFix-Test-GitHub-3');
    expect(siteOf(fixes[3])).toBe('example.com');
  });

  it('derives PR state', () => {
    expect(fixes.map(prStateOf)).toEqual(['merged', 'open', 'none', 'closed']);
    expect(prStateOf({ pr_url: 'x', merged: true })).toBe('merged');
  });

  it('summarizes counts and average days to merge', () => {
    expect(summarize(fixes)).toEqual({ total: 4, verified: 3, failed: 1, awaiting: 1, approved: 1, merged: 1, closed: 1, avgDaysToMerge: 2 });
  });

  it('filters by status, PR state, site, text and date', () => {
    const ids = opts => filterFixes(fixes, opts).map(f => f.id);
    expect(ids({ status: 'failed' })).toEqual([3]);
    expect(ids({ pr: 'open' })).toEqual([2]);
    expect(ids({ site: 'example.com' })).toEqual([4]);
    expect(ids({ q: 'ALICE' })).toEqual([1]);
    expect(ids({ from: '2026-11-18', to: '2026-11-18' })).toEqual([3]);
  });

  it('sorts and groups', () => {
    expect(sortFixes(fixes, 'date', 'asc').map(f => f.id)).toEqual([4, 1, 3, 2]);
    expect(sortFixes(fixes, 'rule', 'asc')[0].rule_id).toBe('image-alt');
    const g = groupBySite(fixes);
    expect(g[0].site).toMatch(/GitHub-3$/);
    expect(g[0].summary.merged).toBe(1);
  });

  it('derives approval state: stored decision wins, open PR without one is pending', () => {
    expect(approvalOf({ pr_url: 'x', pr_state: 'open' })).toBe('pending');
    expect(approvalOf({ pr_url: 'x', pr_state: 'closed', approval_status: 'rejected' })).toBe('rejected');
    expect(approvalOf({ pr_url: 'x', pr_state: 'merged' })).toBe(null);
    expect(approvalOf({ status: 'failed' })).toBe(null);
  });

  it('separates "changes requested" from the Approver queue', () => {
    const sent = { id: 9, pr_url: 'https://g/pull/7', pr_state: 'open', approval_status: 'changes_requested', created_at: '2026-11-01T00:00:00Z' };
    expect(isReviewable(sent)).toBe(false);
    expect(filterFixes([...fixes, sent], { pr: 'open' }).map(f => f.id)).toEqual([2]);
    expect(filterFixes([...fixes, sent], { pr: 'changes' }).map(f => f.id)).toEqual([9]);
  });

  it('counts waiting days only for fixes waiting on the Approver', () => {
    const now = new Date('2026-11-23T09:00:00Z');
    expect(waitingDays(fixes[1], now)).toBe(4);   // open since Nov 19
    expect(waitingDays(fixes[0], now)).toBe(null); // merged
  });

  it('keeps one row per pull request for bulk decisions', () => {
    const batch = [{ id: 1, pr_url: 'a' }, { id: 2, pr_url: 'a' }, { id: 3, pr_url: 'b' }];
    expect(onePerPr(batch).map(f => f.id)).toEqual([1, 3]);
  });
});
