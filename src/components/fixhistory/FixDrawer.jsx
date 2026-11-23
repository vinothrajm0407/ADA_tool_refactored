import { useEffect, useRef, useState } from 'react';
import { X, GitBranch, ExternalLink, Check, Ban, MessageSquareWarning, Send } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import FixProof from '../ui/FixProof';
import { formatDate, StatusBadge, PrBadge, WaitingNote } from './FixTable';
import { prStateOf, isFailed, daysBetween, approvalOf } from './fixHistoryUtils';

function Step({ done, warn, label, children }) {
  return (
    <li className="relative pl-6 pb-4 last:pb-0">
      <span className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 ${
        warn ? 'border-coral bg-coral' : done ? 'border-sage bg-sage' : 'border-gray-300 bg-white'}`} aria-hidden="true" />
      <span className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200" aria-hidden="true" />
      <p className={`text-[12.5px] font-semibold ${done || warn ? 'text-ink' : 'text-gray-400'}`}>
        {label}<span className="sr-only">{warn ? ' (failed)' : done ? ' (done)' : ' (not yet)'}</span>
      </p>
      <div className={`text-[12px] ${done || warn ? 'text-body' : 'text-gray-400'}`}>{children}</div>
    </li>
  );
}

function Code({ label, text, tone }) {
  if (!text) return null;
  return (
    <div>
      <p className={`text-[10.5px] font-semibold uppercase tracking-wide mb-1 ${tone}`}>{label}</p>
      <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg p-2.5 whitespace-pre-wrap break-all max-h-40 overflow-auto">{text}</pre>
    </div>
  );
}

const REVIEW_LABEL = { changes_requested: 'Changes requested', resubmitted: 'Resubmitted', approved: 'Approved', rejected: 'Rejected' };

// Approver only: approve (merges the PR), request changes (PR stays open, back to
// the developer) or reject (closes it). A comment is required for the last two.
function ReviewPanel({ fix, onReviewed }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function decide(decision) {
    if (decision === 'reject' && !comment.trim()) { setError('Write a reason before rejecting.'); return; }
    if (decision === 'changes' && !comment.trim()) { setError('Say what needs to change.'); return; }
    setBusy(decision); setError('');
    try {
      const res = await apiFetch(`/api/fixes/${fix.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment: comment.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Review failed');
      onReviewed(data.fix, data.git_approval);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  return (
    <section className="bg-white rounded-2xl border-2 border-amber/40 p-4 space-y-3" aria-label="Approve or reject this fix">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Your approval is needed</h3>
        <p className="text-[12px] text-body">Check the code change and the before/after proof below.
          {fix.fixed_by && <> Fixed by <b className="text-ink">{fix.fixed_by}</b>.</>}</p>
        <p className="text-[11px] text-body mt-1">Your decision is made with <b className="text-ink">your own</b> connected git account:
          approving posts an approval review on the pull request, then merges it.</p>
      </div>
      <label className="block">
        <span className="block text-[11px] font-semibold text-body mb-1">Comment (required to request changes or reject)</span>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={1000}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="e.g. Label text is wrong — use “Search products”" />
      </label>
      {error && <p className="text-[12px] text-coral" role="alert">{error}</p>}
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => decide('approve')} disabled={!!busy}
          className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
          <Check size={14} /> {busy === 'approve' ? 'Merging…' : 'Approve & merge'}
        </button>
        <button type="button" onClick={() => decide('changes')} disabled={!!busy}
          className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
          <MessageSquareWarning size={14} /> {busy === 'changes' ? 'Sending…' : 'Request changes'}
        </button>
        <button type="button" onClick={() => decide('reject')} disabled={!!busy}
          className="btn-secondary text-sm flex items-center gap-1.5 text-coral disabled:opacity-50">
          <Ban size={14} /> {busy === 'reject' ? 'Rejecting…' : 'Reject & close PR'}
        </button>
      </div>
    </section>
  );
}

// Developer: the Approver asked for changes — update the PR, then send it back.
function ResubmitPanel({ fix, onReviewed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  async function resubmit() {
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`/api/fixes/${fix.id}/resubmit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: note.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Resubmit failed');
      onReviewed(data.fix);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="bg-white rounded-2xl border-2 border-amber/40 p-4 space-y-3" aria-label="Changes requested">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Changes requested{fix.reviewed_by && <> by {fix.reviewed_by}</>}</h3>
        {fix.review_comment && <p className="text-[13px] text-ink mt-1">“{fix.review_comment}”</p>}
        <p className="text-[12px] text-body mt-1">Update the pull request
          {fix.pr_url && <> (<a href={fix.pr_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">open it</a>)</>},
          then send it back to the Approver.</p>
      </div>
      <label className="block">
        <span className="block text-[11px] font-semibold text-body mb-1">What did you change? (optional, goes in the audit trail)</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="e.g. Changed the label to “Open menu”" />
      </label>
      {error && <p className="text-[12px] text-coral" role="alert">{error}</p>}
      <button type="button" onClick={resubmit} disabled={busy} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
        <Send size={14} /> {busy ? 'Sending…' : 'Resubmit for approval'}
      </button>
    </section>
  );
}

// Side panel for one fix: timeline, approval, code change and before/after proof.
export default function FixDrawer({ fix, onClose, isApprover = false, currentUserId = null, onReviewed }) {
  const [proof, setProof] = useState(null); // null, 'loading', 'error' or the proof
  const [notice, setNotice] = useState(null); // what happened on the git provider after Approve
  useEffect(() => { setNotice(null); }, [fix?.id]);

  function reviewed(updated, gitApproval) {
    if (gitApproval) {
      setNotice(gitApproval === 'posted'
        ? { ok: true, text: 'Approved on the pull request from your account, then merged.' }
        : gitApproval === 'own_pr'
          ? { ok: false, text: 'Merged. GitHub did not record an approval review because your account opened this pull request — '
              + 'ask the developer to connect their own access token so their pull requests come from their account.' }
          : { ok: false, text: `Merged. The approval review could not be posted (${gitApproval}) — it is recorded here.` });
    }
    onReviewed(updated);
  }
  const closeRef = useRef(null);

  useEffect(() => {
    if (!fix) return undefined;
    closeRef.current?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    let cancelled = false;
    setProof(fix.has_proof ? 'loading' : null);
    if (fix.has_proof) {
      apiFetch(`/api/fixes/${fix.id}/proof`).then(r => r.json())
        .then(d => { if (!cancelled) setProof(d.ok ? d.proof : 'error'); })
        .catch(() => { if (!cancelled) setProof('error'); });
    }
    return () => { cancelled = true; document.removeEventListener('keydown', onKey); };
  }, [fix, onClose]);

  if (!fix) return null;
  const pr = prStateOf(fix);
  const failed = isFailed(fix);
  const approvers = fix.approved_by?.join(', ');
  const p = proof && typeof proof === 'object' ? proof : {};
  const days = pr === 'merged' ? daysBetween(fix.created_at, fix.merged_at) : null;
  const approval = approvalOf(fix);
  const canReview = isApprover && pr === 'open' && approval === 'pending';
  const history = fix.reviews || [];
  // Whoever made the fix resubmits it — a developer, or an Approver who fixed it themselves.
  const canResubmit = pr === 'open' && approval === 'changes_requested'
    && (!isApprover || (currentUserId != null && fix.user_id === currentUserId));

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-labelledby="fix-drawer-title"
        className="fixed right-0 top-0 h-full w-full max-w-[560px] bg-ivory shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-body">Fix #{fix.id}</p>
            <h2 id="fix-drawer-title" className="text-[16px] font-bold text-ink">
              {fix.help || p.help || fix.rule_id}
            </h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="font-mono text-[11px] font-semibold bg-gray-100 px-2 py-0.5 rounded">{fix.rule_id}</span>
              <StatusBadge fix={fix} /> <PrBadge fix={fix} /> <WaitingNote fix={fix} />
              {(fix.wcag?.length > 0) && <span className="text-[11px] text-body">WCAG {fix.wcag.join(', ')}</span>}
              {fix.impact && <span className="text-[11px] font-semibold uppercase text-coral">{fix.impact}</span>}
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close details"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-body"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-1">
            <p className="text-[12px] text-body break-all"><b className="text-ink">Page:</b> <a href={fix.page_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">{fix.page_url}</a></p>
            {fix.selector && <p className="text-[12px] text-body"><b className="text-ink">Element:</b> <span className="font-mono">{fix.selector}</span></p>}
            {(fix.file || p.file) && <p className="text-[12px] text-body"><b className="text-ink">Source file:</b> <span className="font-mono text-teal">{fix.file || p.file}</span></p>}
            {fix.fixed_by && <p className="text-[12px] text-body"><b className="text-ink">Fixed by:</b> {fix.fixed_by}</p>}
            {fix.source_pages && (
              <p className="text-[12px] text-body"><b className="text-ink">Fixed at the source:</b> one change for {fix.source_pages} pages
                {fix.source_pages_checked ? ` · re-scanned ${fix.source_pages_checked} other pages, ${fix.source_pages_clean ?? 0} clean` : ''}</p>
            )}
          </section>

          {notice && (
            <p role="status" className={`text-[12px] rounded-xl px-3 py-2 border ${notice.ok
              ? 'text-sage bg-sage/10 border-sage/20' : 'text-ink bg-amber/10 border-amber/30'}`}>{notice.text}</p>
          )}
          {canReview && <ReviewPanel fix={fix} onReviewed={reviewed} />}
          {canResubmit && <ResubmitPanel fix={fix} onReviewed={onReviewed} />}

          <section className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="text-[13px] font-semibold text-ink mb-3">Timeline</h3>
            <ol className="list-none m-0 p-0">
              <Step done={!failed} warn={failed} label={failed ? 'Auto-Fix failed' : 'Fixed and re-scan verified'}>
                {formatDate(fix.created_at)}{failed && fix.error_message && <p className="text-coral mt-0.5">{fix.error_message}</p>}
              </Step>
              <Step done={!!fix.pr_url} label="Pull request opened">
                {fix.pr_url ? <a href={fix.pr_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal hover:underline">
                  <GitBranch size={11} /> #{fix.pr_url.replace(/\/$/, '').split('/').pop()} <ExternalLink size={10} /></a>
                  : fix.branch_url ? <a href={fix.branch_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">Branch only</a> : 'No pull request'}
              </Step>
              {/* every decision in order (changes requested → resubmitted → …); approval itself is the step below */}
              {history.filter(r => r.kind !== 'approved' && r.kind !== 'rejected').map((r, i) => (
                <Step key={i} done label={REVIEW_LABEL[r.kind] || r.kind}>
                  {`by ${r.by || '—'}${r.at ? ` on ${formatDate(r.at)}` : ''}`}
                  {r.comment && <p className="text-ink mt-0.5">“{r.comment}”</p>}
                </Step>
              ))}
              {approval === 'changes_requested' && !history.length && (
                <Step warn={false} done label="Changes requested">
                  {`by ${fix.reviewed_by || 'Approver'}${fix.reviewed_at ? ` on ${formatDate(fix.reviewed_at)}` : ''}`}
                  {fix.review_comment && <p className="text-ink mt-0.5">“{fix.review_comment}”</p>}
                </Step>
              )}
              {approval === 'changes_requested' && pr === 'open' && (
                <li className="pl-6 pb-3 text-[12px] text-body">Waiting for the developer to update the pull request.</li>
              )}
              {approval === 'rejected' ? (
                <Step warn label="Rejected">
                  {`by ${fix.reviewed_by || 'Approver'}${fix.reviewed_at ? ` on ${formatDate(fix.reviewed_at)}` : ''}`}
                  {fix.review_comment && <p className="text-ink mt-0.5">“{fix.review_comment}”</p>}
                </Step>
              ) : (
                <Step done={!!approvers} label="Approved">
                  {approvers ? `by ${approvers}${fix.approved_at ? ` on ${formatDate(fix.approved_at)}` : ''}`
                    : pr === 'merged' ? 'Merged without a review approval' : pr === 'open' ? 'Waiting for an Approver' : '—'}
                  {approval === 'approved' && fix.review_comment && <p className="text-ink mt-0.5">“{fix.review_comment}”</p>}
                  {approval === 'pending' && history.some(r => r.kind === 'resubmitted') && pr === 'open' && (
                    <p className="mt-0.5">Resubmitted — waiting for the Approver again.</p>
                  )}
                </Step>
              )}
              <Step done={pr === 'merged'} warn={pr === 'closed'} label={pr === 'closed' ? 'Closed without merging' : 'Merged'}>
                {pr === 'merged' ? <>{formatDate(fix.merged_at)}{fix.merged_by && ` by ${fix.merged_by}`}{days !== null && ` · ${days} day${days !== 1 ? 's' : ''} after the fix`}</>
                  : pr === 'closed' ? 'The pull request was closed' : 'Not yet'}
              </Step>
            </ol>
            {pr === 'open' && !isApprover && (
              <p className="text-[11px] text-body mt-2">An Approver reviews this fix; approving merges the pull request.</p>
            )}
          </section>

          {(p.code_before || p.code_after) && (
            <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <h3 className="text-[13px] font-semibold text-ink">Code change</h3>
              <Code label="Before" text={p.code_before} tone="text-coral" />
              <Code label="After" text={p.code_after} tone="text-sage" />
            </section>
          )}

          {proof === 'loading' && <p className="text-[12px] text-body">Loading before/after proof…</p>}
          {proof === 'error' && <p className="text-[12px] text-coral">Could not load the proof for this fix.</p>}
          {proof && typeof proof === 'object' && (
            <section>
              <h3 className="text-[13px] font-semibold text-ink mb-2">Before / after proof</h3>
              <FixProof proof={proof} />
            </section>
          )}
          {!fix.has_proof && !failed && <p className="text-[12px] text-body">No before/after screenshots were saved for this fix (it was made before proof capture existed).</p>}
        </div>
      </aside>
    </>
  );
}
