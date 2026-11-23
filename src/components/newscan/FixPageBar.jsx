import { Wand2, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import { useAutoFixSupport, autoFixUnavailableReason } from '../../utils/autoFixSupport';
import { nsAutoFixKey } from './scanUtils';

const PAGE_KEY = 'fixpage';

// Same elements the backend can fix: ones with markup to locate.
const fixableNodes = v => (v.nodes || []).filter(n => (n?.html || '').trim());

// The per-row state key each issue row already reads (ViolationList's
// AutoFixControl / FixAllControl), so rows show progress and results by themselves.
const rowKey = (v, nodes) => (nodes.length >= 2 ? `fixall::${v.id}` : nsAutoFixKey(v.id, nodes[0]?.html));

function rowDone(state) {
  if (!state) return false;
  if (state.results) return state.status === 'done' && state.results.every(r => r.status === 'verified' || r.status === 'already_fixed');
  return state.status === 'done' && ['verified', 'already_fixed', 'partial'].includes(state.result?.status);
}

// Fix all: every auto-fixable issue on this page in one run and ONE pull request.
export default function FixPageBar({ violations, pageUrl, sessionId }) {
  const { scanSessions, updateSessionAutoFix } = useApp();
  const support = useAutoFixSupport();
  const session = scanSessions.find(s => s.id === sessionId);
  const fixState = session?.autoFixState || {};
  const page = fixState[PAGE_KEY] || { status: 'idle' };

  if (!pageUrl || !violations.length) return null;
  const candidates = violations.filter(v => fixableNodes(v).length && !autoFixUnavailableReason(support, v.id, true));
  const todo = candidates.filter(v => !rowDone(fixState[rowKey(v, fixableNodes(v))]));
  const manual = violations.length - candidates.length;

  // targets: every remaining issue (Fix all) or one leftover (Retry)
  async function fixAll(targets = todo) {
    const prev = page;
    updateSessionAutoFix(sessionId, PAGE_KEY, { ...prev, status: 'running' });
    for (const v of targets) {
      const nodes = fixableNodes(v);
      updateSessionAutoFix(sessionId, rowKey(v, nodes), nodes.length >= 2
        ? { status: 'running', results: nodes.map(() => ({ status: 'running' })) }
        : { status: 'running', result: null });
    }
    let data;
    try {
      const res = await apiFetch('/api/auto-fix-page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_url: pageUrl, violations: targets.map(v => ({ rule: v, nodes: fixableNodes(v) })) }),
      });
      data = await res.json();
      if (!data.ok) data = { status: 'failed', error: data.error || 'Fix all failed', by_rule: {} };
    } catch {
      data = { status: 'failed', error: 'Could not reach the server', by_rule: {} };
    }
    const shared = { steps: data.steps, pr_url: data.pr_url, branch_url: data.branch_url, merged: data.merged };
    const toRow = r => (r?.status === 'patched' ? { ...shared, status: 'verified', file_path: r.file_path, line_no: r.line_no, proof: r.proof }
      : r?.status === 'already_fixed' ? { ...shared, status: 'already_fixed', file_path: r.file_path, line_no: r.line_no }
      // the run's steps describe the PR, not this issue — a failed issue shows only its reason
      : { status: 'failed', error: r?.error || data.error || 'Auto-Fix failed', steps: data.pr_url ? [] : data.steps });
    let fixed = 0;
    const leftovers = [];
    for (const v of targets) {
      const nodes = fixableNodes(v);
      const rows = (data.by_rule || {})[v.id] || [];
      const mapped = nodes.map((_, i) => toRow(rows[i]));
      if (mapped.some(r => r.status === 'verified')) fixed += 1;
      const failedEls = mapped.filter(r => r.status === 'failed');
      if (failedEls.length) {
        leftovers.push({ id: v.id, help: v.help || v.id, error: failedEls[0].error, failed: failedEls.length, total: nodes.length });
      }
      updateSessionAutoFix(sessionId, rowKey(v, nodes), nodes.length >= 2
        ? { status: 'done', results: mapped }
        : { status: 'done', result: mapped[0] });
    }
    // leftovers from earlier runs stay listed until they're retried
    const ids = new Set(targets.map(v => v.id));
    const failed = [...(prev.failed || []).filter(f => !ids.has(f.id)), ...leftovers];
    updateSessionAutoFix(sessionId, PAGE_KEY, { status: 'done', fixed, tried: targets.length, pr_url: data.pr_url,
      error: data.pr_url ? null : data.error, duplicate: data.duplicate, failed });
  }

  function showHowToFix(ruleId) {
    window.dispatchEvent(new CustomEvent('ns-open-rule', { detail: ruleId }));
  }

  const running = page.status === 'running';
  return (
    <div className="mb-4 rounded-xl border border-teal/30 bg-teal-50/60 px-4 py-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink">
          <b>{violations.length}</b> issue{violations.length !== 1 ? 's' : ''} on this page ·{' '}
          <b className="text-teal">{todo.length}</b> can be auto-fixed{todo.length !== candidates.length && ` (${candidates.length - todo.length} already fixed)`}
          {manual > 0 && <span className="text-body"> · {manual} need a manual fix</span>}
        </p>
        {todo.length > 0 && (
          <button type="button" onClick={() => fixAll()} disabled={running}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {running ? `Fixing ${todo.length} issues…` : `Fix all ${todo.length} issue${todo.length !== 1 ? 's' : ''} — one PR`}
          </button>
        )}
      </div>
      {running && <p className="text-[11.5px] text-body mt-1.5">Finding each issue in the code, building once and re-scanning the page — this takes a few minutes. Each issue below updates when it’s done.</p>}
      {page.status === 'done' && (
        page.pr_url ? (
          <p className="text-[12px] mt-1.5 flex items-center gap-1.5 flex-wrap text-sage font-semibold">
            <CheckCircle2 size={13} />
            {page.duplicate ? 'These issues already have an open pull request.' : `Fixed ${page.fixed} of ${page.tried} issues in one pull request.`}
            <a href={page.pr_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline inline-flex items-center gap-0.5">Open PR <ExternalLink size={10} /></a>
            {!page.duplicate && <span className="font-normal text-body">· waits for an Approver in Fix History</span>}
          </p>
        ) : page.duplicate ? (
          <p className="text-[12px] mt-1.5 text-sage font-semibold flex items-center gap-1.5"><CheckCircle2 size={13} /> Every issue already has an open pull request.</p>
        ) : (
          <p className="text-[12px] mt-1.5 text-coral flex items-start gap-1.5" role="alert"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{page.error || 'Fix all failed'}</p>
        )
      )}
      {page.failed?.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white border border-amber/30 px-3 py-2">
          <p className="text-[12px] font-semibold text-ink flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber" aria-hidden="true" />
            {page.failed.length} issue{page.failed.length !== 1 ? 's' : ''} not fixed automatically
          </p>
          <ul className="list-none m-0 p-0 mt-1 divide-y divide-gray-100">
            {page.failed.map(f => (
              <li key={f.id} className="py-1.5 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink m-0">{f.help}
                    {f.total > 1 && <span className="text-body"> · {f.failed} of {f.total} elements</span>}</p>
                  <p className="text-[11px] text-body m-0">{f.error}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" disabled={running}
                    onClick={() => { const v = violations.find(x => x.id === f.id); if (v) fixAll([v]); }}
                    className="text-[11.5px] font-semibold text-teal hover:underline disabled:opacity-50 inline-flex items-center gap-1">
                    <Wand2 size={11} /> Retry
                  </button>
                  <button type="button" onClick={() => showHowToFix(f.id)}
                    className="text-[11.5px] font-semibold text-teal hover:underline">How to fix</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
