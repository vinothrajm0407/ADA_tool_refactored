import { useState, useEffect, useCallback, useMemo } from 'react';
import { GitBranch, RefreshCw, FileText, Download, Search, Layers, ShieldCheck, Check, Ban, MessageSquareWarning, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import PageHeader from '../components/ui/PageHeader';
import ActivityTimeline from '../components/fixhistory/ActivityTimeline';
import FixSummary from '../components/fixhistory/FixSummary';
import FixTable from '../components/fixhistory/FixTable';
import FixDrawer from '../components/fixhistory/FixDrawer';
import { filterFixes, sortFixes, siteOf, approvalOf, isReviewable, waitingDays, onePerPr, REMINDER_DAYS } from '../components/fixhistory/fixHistoryUtils';

async function download(path, filename) {
  const res = await apiFetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const NO_FILTERS = { status: 'all', pr: 'all', site: 'all', q: '', from: '', to: '' };

function Select({ label, value, onChange, options }) {
  return (
    <label>
      <span className="block text-[11px] font-semibold text-body mb-1">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white max-w-[260px]">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// Approver: one decision for every selected fix. A batch PR is decided once
// (the backend applies it to every row on that PR).
function BulkBar({ fixes, onDone, onClear }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { ok, failed: [{ fix, error }] }
  const prs = onePerPr(fixes);

  async function run(decision) {
    if (decision !== 'approve' && !comment.trim()) {
      setResult({ ok: 0, failed: [{ error: decision === 'reject' ? 'Write a reason before rejecting.' : 'Say what needs to change.' }] });
      return;
    }
    setBusy(decision); setResult(null);
    const failed = [];
    let ok = 0;
    for (const fix of prs) { // one at a time: each approve is a real merge on the git provider
      try {
        const res = await apiFetch(`/api/fixes/${fix.id}/review`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, comment: comment.trim() }),
        });
        const data = await res.json();
        if (data.ok) ok += 1; else failed.push({ fix, error: data.error });
      } catch (e) { failed.push({ fix, error: e.message }); }
    }
    setBusy('');
    setComment('');
    onDone({ ok, failed }); // the page shows the outcome: decided fixes leave the selection, which can unmount this bar
  }

  return (
    <section className="bg-white rounded-2xl border-2 border-teal/40 p-4 space-y-3" aria-label="Bulk decision">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink"><b>{fixes.length}</b> fix{fixes.length !== 1 ? 'es' : ''} selected
          {prs.length !== fixes.length && <span className="text-body"> · {prs.length} pull request{prs.length !== 1 ? 's' : ''}</span>}</p>
        <button type="button" onClick={onClear} className="text-[12px] text-body hover:text-ink inline-flex items-center gap-1"><X size={12} /> Clear selection</button>
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={1000}
        aria-label="Comment for the selected fixes (required to request changes or reject)"
        placeholder="Comment for all selected fixes — required to request changes or reject"
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => run('approve')} disabled={!!busy} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
          <Check size={14} /> {busy === 'approve' ? 'Merging…' : `Approve & merge (${prs.length})`}
        </button>
        <button type="button" onClick={() => run('changes')} disabled={!!busy} className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
          <MessageSquareWarning size={14} /> {busy === 'changes' ? 'Sending…' : 'Request changes'}
        </button>
        <button type="button" onClick={() => run('reject')} disabled={!!busy} className="btn-secondary text-sm flex items-center gap-1.5 text-coral disabled:opacity-50">
          <Ban size={14} /> {busy === 'reject' ? 'Rejecting…' : 'Reject & close PRs'}
        </button>
      </div>
      {result && <BulkResult result={result} />}
    </section>
  );
}

function BulkResult({ result }) {
  return (
    <div role="status" className="text-[12px]">
      {result.ok > 0 && <p className="text-sage font-semibold">{result.ok} pull request{result.ok !== 1 ? 's' : ''} done.</p>}
      {result.failed.map((f, i) => (
        <p key={i} className="text-coral">{f.fix ? `${f.fix.rule_id} (fix ${f.fix.id}): ` : ''}{f.error}</p>
      ))}
    </div>
  );
}

export default function FixHistoryPage() {
  const [tab, setTab]         = useState('fixes'); // 'fixes' or 'activity'
  const [fixes, setFixes]     = useState([]);
  const [role, setRole]       = useState('developer'); // 'approver' reviews everyone's fixes
  const [me, setMe]           = useState(null);        // signed-in user id: who may resubmit a fix
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort]       = useState({ key: 'date', dir: 'desc' });
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState(null);
  const [pickedIds, setPickedIds] = useState(() => new Set()); // Approver's bulk selection
  const [bulkResult, setBulkResult] = useState(null);
  const [exporting, setExporting] = useState(''); // '', 'pdf' or 'csv'
  const [exportError, setExportError] = useState('');

  // Refresh also asks GitHub/GitLab/… who approved and merged each open PR.
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/fixes?limit=1000${refresh ? '&refresh=1' : ''}`);
      const data = await res.json();
      if (data.ok) { setFixes(data.fixes || []); setRole(data.role || 'developer'); setMe(data.me ?? null); }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sites = useMemo(() => [...new Set(fixes.map(siteOf))].sort(), [fixes]);
  const shown = useMemo(() => sortFixes(filterFixes(fixes, filters), sort.key, sort.dir), [fixes, filters, sort]);
  const set = key => value => setFilters(f => ({ ...f, [key]: value }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const closeDrawer = useCallback(() => setSelected(null), []);
  const isApprover = role === 'approver';
  const pending = useMemo(() => fixes.filter(isReviewable).length, [fixes]);
  const overdue = useMemo(() => fixes.filter(f => (waitingDays(f) ?? -1) >= REMINDER_DAYS).length, [fixes]);
  const sentBack = useMemo(() => fixes.filter(f => approvalOf(f) === 'changes_requested' && f.pr_state !== 'closed' && f.pr_state !== 'merged').length, [fixes]);
  // Only fixes still reviewable stay picked (after a reload some were decided).
  const picked = useMemo(() => fixes.filter(f => pickedIds.has(f.id) && isReviewable(f)), [fixes, pickedIds]);
  const pickApi = useMemo(() => ({
    ids: pickedIds,
    toggle: f => setPickedIds(s => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }),
    toggleAll: list => setPickedIds(s => (list.every(f => s.has(f.id)) ? new Set() : new Set(list.map(f => f.id)))),
  }), [pickedIds]);

  // After Approve / Reject: reload (a batch PR updates several rows) and keep the panel on the updated fix.
  async function onReviewed(updated) {
    await load();
    if (updated) setSelected(updated);
  }

  function onSort(key) {
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }

  async function exportPack(format) {
    setExporting(format);
    setExportError('');
    const day = new Date().toISOString().slice(0, 10);
    try {
      await download(`/api/compliance/evidence-pack?format=${format}`,
        format === 'csv' ? `audit-trail-${day}.csv` : `evidence-pack-${day}.pdf`);
      load();
    } catch (e) { setExportError(e.message); } finally { setExporting(''); }
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0" role="main">
      <div className="max-w-[1200px] mx-auto space-y-6">

        <PageHeader
          title="Fix History"
          description={isApprover
            ? 'You are the Approver: review every developer’s fixes — approving merges the pull request.'
            : 'Every Auto Fix with its review trail. Fixes wait for an Approver before they are merged.'}
          actions={tab === 'fixes' && (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => exportPack('pdf')} disabled={!!exporting}
                className="btn-primary text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-50">
                <FileText size={14} /> {exporting === 'pdf' ? 'Building…' : 'Evidence pack (PDF)'}
              </button>
              <button onClick={() => exportPack('csv')} disabled={!!exporting}
                className="btn-secondary text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-50">
                <Download size={14} /> {exporting === 'csv' ? 'Exporting…' : 'Audit trail (CSV)'}
              </button>
              <button onClick={() => load(true)} disabled={loading} title="Also checks GitHub for new approvals and merges"
                className="btn-secondary text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          )}
        />

        <div role="tablist" aria-label="Fix History views" className="inline-flex gap-1 p-1 bg-white border border-gray-200 rounded-xl">
          {[['fixes', 'Fixes & approvals'], ['activity', 'All activity']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                tab === id ? 'bg-teal text-white' : 'text-body hover:text-ink hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'activity' ? <ActivityTimeline /> : <>
          {exportError && <p className="text-[12px] text-coral" role="alert">{exportError}</p>}

          {loading && !fixes.length ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <div key={i} className="h-[84px] rounded-2xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : fixes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
              <GitBranch size={28} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-body">No Auto Fix attempts yet. Click Auto Fix on a violation to get started.</p>
            </div>
          ) : <>
            {isApprover && pending > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap bg-amber/10 border border-amber/30 rounded-2xl px-4 py-3" role="status">
                <p className="flex items-center gap-2 text-[13px] text-ink">
                  <ShieldCheck size={16} className="text-amber" aria-hidden="true" />
                  <span><b>{pending}</b> fix{pending !== 1 ? 'es are' : ' is'} waiting for your approval.
                    {overdue > 0 && <b className="text-coral"> {overdue} waiting {REMINDER_DAYS}+ days.</b>}</span>
                </p>
                <button type="button" onClick={() => setFilters({ ...NO_FILTERS, pr: 'open' })}
                  className="btn-primary text-sm">Review now</button>
              </div>
            )}

            {!isApprover && sentBack > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap bg-amber/10 border border-amber/30 rounded-2xl px-4 py-3" role="status">
                <p className="flex items-center gap-2 text-[13px] text-ink">
                  <MessageSquareWarning size={16} className="text-amber" aria-hidden="true" />
                  <span>The Approver asked for changes on <b>{sentBack}</b> fix{sentBack !== 1 ? 'es' : ''}.</span>
                </p>
                <button type="button" onClick={() => setFilters({ ...NO_FILTERS, pr: 'changes' })} className="btn-primary text-sm">Show them</button>
              </div>
            )}

            <FixSummary fixes={fixes} />

            {/* Filters — one row above the table */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[200px]">
                  <span className="block text-[11px] font-semibold text-body mb-1">Search</span>
                  <span className="relative block">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                    <input type="search" value={filters.q} onChange={e => set('q')(e.target.value)}
                      placeholder="Rule, page, element, file, person…"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  </span>
                </label>
                <Select label="Status" value={filters.status} onChange={set('status')}
                  options={[['all', 'All'], ['verified', 'Verified'], ['failed', 'Failed']]} />
                <Select label="Pull request" value={filters.pr} onChange={set('pr')}
                  options={[['all', 'All'], ['open', 'Awaiting approval'], ['changes', 'Changes requested'], ['merged', 'Merged'], ['closed', 'Closed / rejected'], ['none', 'No PR']]} />
                <Select label="Website" value={filters.site} onChange={set('site')}
                  options={[['all', 'All websites'], ...sites.map(s => [s, s])]} />
                <label>
                  <span className="block text-[11px] font-semibold text-body mb-1">From</span>
                  <input type="date" value={filters.from} onChange={e => set('from')(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                </label>
                <label>
                  <span className="block text-[11px] font-semibold text-body mb-1">To</span>
                  <input type="date" value={filters.to} onChange={e => set('to')(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[12px] text-body" aria-live="polite">
                  Showing <b>{shown.length}</b> of {fixes.length} fixes
                  {filtered && <button type="button" onClick={() => setFilters(NO_FILTERS)} className="ml-2 font-medium text-teal hover:underline">Clear filters</button>}
                </p>
                <label className="inline-flex items-center gap-2 text-[12px] font-medium text-ink cursor-pointer">
                  <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} className="accent-teal" />
                  <Layers size={13} aria-hidden="true" /> Group by website
                </label>
              </div>
            </div>

            {isApprover && picked.length > 0 && (
              <BulkBar fixes={picked} onDone={r => { setBulkResult(r); load(); }} onClear={() => setPickedIds(new Set())} />
            )}
            {bulkResult && picked.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start justify-between gap-3">
                <BulkResult result={bulkResult} />
                <button type="button" onClick={() => setBulkResult(null)} aria-label="Dismiss" className="text-body hover:text-ink"><X size={14} /></button>
              </div>
            )}

            {shown.length ? (
              <FixTable fixes={shown} sort={sort} onSort={onSort} grouped={grouped} onOpen={setSelected}
                selectedId={selected?.id} showFixedBy={isApprover} picked={isApprover ? pickApi : null} />
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-body">No fixes match these filters.</div>
            )}
          </>}
        </>}
      </div>
      <FixDrawer fix={selected} onClose={closeDrawer} isApprover={isApprover} currentUserId={me} onReviewed={onReviewed} />
    </main>
  );
}
