import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2, XCircle, GitBranch } from 'lucide-react';
import { apiFetch } from '../../utils/api';

const AUTO_FIX_STEP_NAMES = ['Locate source', 'Generate fix', 'Validate patch', 'Run tests', 'Build', 'Re-scan', 'Push branch', 'Open PR', 'Auto-merge'];

// Same POST /api/auto-fix flow as the regular-scan AutoFixControl
// (src/components/newscan/ViolationList.jsx), trimmed to local state — this
// page has no scanSessions/sessionId concept for a session-backed run to key
// off, so a fix in progress won't survive navigating away and back here.
export default function AssistiveAutoFixControl({ pageUrl, rule, node }) {
  const [fix, setFix] = useState({ status: 'idle', result: null });

  if (!pageUrl) return null;

  async function handleAutoFix() {
    setFix({ status: 'running', result: null });
    let result;
    try {
      const res = await apiFetch('/api/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_url: pageUrl, rule, node: node || {} }),
      });
      const data = await res.json();
      result = data.ok ? data : { status: 'failed', error: data.error || 'Auto-Fix failed', steps: [] };
    } catch {
      result = { status: 'failed', error: 'Could not reach the server', steps: [] };
    }
    setFix({ status: 'done', result });
  }

  if (fix.status === 'idle') {
    return (
      <button type="button" onClick={handleAutoFix}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-teal text-white hover:bg-teal/90 transition-colors">
        <Wand2 size={13} /> Auto Fix
      </button>
    );
  }

  if (fix.status === 'running') {
    return (
      <div className="flex flex-col gap-1.5 shrink-0 min-w-0 max-w-[220px]">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal">
          <Loader2 size={13} className="animate-spin" /> Running Auto Fix…
        </span>
        <div className="flex flex-wrap gap-1.5">
          {AUTO_FIX_STEP_NAMES.map(name => (
            <span key={name} className="text-[10.5px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
              {name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // done
  const result = fix.result;
  return (
    <div className="flex flex-col gap-2 shrink-0 min-w-0 max-w-[220px]">
      {result.status === 'verified' ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-sage">
          <CheckCircle2 size={14} /> {result.merged ? 'Fix Verified & Merged' : 'Fix Verified'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-coral">
          <XCircle size={14} /> Auto Fix Failed
        </span>
      )}
      {(result.steps || []).length > 0 && (
        <div className="flex flex-col gap-1">
          {result.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px] min-w-0">
              {s.ok ? <CheckCircle2 size={11} className="text-sage flex-shrink-0 mt-0.5" /> : <XCircle size={11} className="text-coral flex-shrink-0 mt-0.5" />}
              <span className="text-body min-w-0 break-words">
                {s.name}
                {s.detail && <span className="text-gray-400"> — {s.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {result.status === 'verified' && result.pr_url && (
        <a href={result.pr_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline w-fit">
          <GitBranch size={12} /> {result.merged ? 'View merged Pull Request' : 'View Pull Request'}
        </a>
      )}
      {result.status === 'verified' && !result.pr_url && result.branch_url && (
        <a href={result.branch_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline w-fit">
          <GitBranch size={12} /> View branch
        </a>
      )}
      {result.status !== 'verified' && result.error && (
        <p className="text-[11.5px] text-coral m-0 break-words">{result.error}</p>
      )}
      <button type="button" onClick={handleAutoFix}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-teal hover:underline w-fit">
        <Wand2 size={11} /> Run again
      </button>
    </div>
  );
}
