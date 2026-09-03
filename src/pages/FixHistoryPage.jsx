import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, GitBranch, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/api';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function StatusBadge({ status }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sage bg-sage/10 px-2.5 py-1 rounded-full whitespace-nowrap">
        <CheckCircle2 size={12} /> Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-coral bg-coral/10 px-2.5 py-1 rounded-full whitespace-nowrap">
      <XCircle size={12} /> Failed
    </span>
  );
}

function FixRow({ fix }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-mono text-[11px] font-semibold text-ink dark:text-white bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded">
            {fix.rule_id}
          </span>
          <StatusBadge status={fix.status} />
          {fix.merged && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-full whitespace-nowrap">
              Auto-merged
            </span>
          )}
        </div>
        <p className="text-[12px] text-body dark:text-gray-500 truncate">{fix.page_url}</p>
        {fix.status !== 'verified' && fix.error_message && (
          <p className="text-[12px] text-coral mt-1">{fix.error_message}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          {fix.pr_url && (
            <a href={fix.pr_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline">
              <GitBranch size={12} /> {fix.merged ? 'View merged Pull Request' : 'View Pull Request'}
            </a>
          )}
          {!fix.pr_url && fix.branch_url && (
            <a href={fix.branch_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline">
              <GitBranch size={12} /> View branch
            </a>
          )}
        </div>
      </div>
      <span className="text-[11px] text-body dark:text-gray-500 whitespace-nowrap flex-shrink-0 pt-0.5">
        {formatDate(fix.created_at)}
      </span>
    </div>
  );
}

export default function FixHistoryPage() {
  const [fixes, setFixes]     = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiFetch('/api/fixes');
      const data = await res.json();
      if (data.ok) setFixes(data.fixes || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[900px] mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">Fix History</h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Every Auto Fix attempt — verified and failed — across all your connected repos.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-[84px] rounded-2xl bg-gray-100 dark:bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : fixes.length === 0 ? (
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-10 text-center">
            <GitBranch size={28} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-body dark:text-gray-400">No Auto Fix attempts yet. Click Auto Fix on a violation to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fixes.map(fix => <FixRow key={fix.id} fix={fix} />)}
          </div>
        )}
      </div>
    </main>
  );
}
