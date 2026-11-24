import { useEffect, useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { apiFetch } from '../../utils/api';

// Site fixes still running, by crawl. Module-level: leaving the crawl page and
// coming back mid-run shows "Fixing…" instead of starting a second run and PR.
const running = new Map();

// Fix everything: every auto-fixable issue on every page of the crawl, in ONE
// pull request (POST /api/crawl/<id>/fix-site). `left` = issues nothing handles yet.
export default function SiteFixButton({ crawlId, left, onDone }) {
  const [busy, setBusy] = useState(running.has(crawlId));
  const [result, setResult] = useState(null);
  useEffect(() => {
    const p = running.get(crawlId);
    if (!p) return;
    let live = true;
    p.then(r => { if (live) { setBusy(false); setResult(r); onDone?.(); } });
    return () => { live = false; };
  }, [crawlId]);

  function run() {
    const p = apiFetch(`/api/crawl/${crawlId}/fix-site`, { method: 'POST' })
      .then(r => r.json())
      .then(d => (d.ok ? d : { error: d.error || 'Fix all failed' }))
      .catch(() => ({ error: 'Could not reach the server' }))
      .finally(() => running.delete(crawlId));
    running.set(crawlId, p);
    setBusy(true); setResult(null);
    p.then(r => { setBusy(false); setResult(r); onDone?.(); });
  }

  if (!busy && !result && left <= 0) return null;
  return (
    <div className="flex flex-col items-end gap-1 max-w-[340px]" aria-live="polite">
      {(busy || left > 0) && (
        <button type="button" onClick={run} disabled={busy}
          title="Every auto-fixable issue on every page: one copy of the repo, one build, each page re-scanned, one pull request"
          className="btn-primary text-sm inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {busy ? 'Fixing every page…' : `Fix all ${left} — one PR`}
        </button>
      )}
      {busy && <p className="text-[11px] text-body m-0 text-right">A few minutes. You can leave this page; it keeps running.</p>}
      {result && (result.pr_url
        ? <p className="text-[11.5px] m-0 text-sage font-semibold inline-flex items-center gap-1 flex-wrap justify-end"><CheckCircle2 size={12} />
            {result.duplicate ? 'Already in an open PR' : `One PR for ${result.fixed_pages} page${result.fixed_pages !== 1 ? 's' : ''}`}
            <a href={result.pr_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline inline-flex items-center gap-0.5">
              #{result.pr_url.split('/').pop()} <ExternalLink size={10} /></a></p>
        : result.duplicate ? <p className="text-[11.5px] m-0 text-sage font-semibold">{result.message || 'Every issue already has an open PR'}</p>
        : <p className="text-[11.5px] m-0 text-coral inline-flex items-start gap-1 text-right" role="alert"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{result.error || 'Fix all failed'}</p>)}
      {result?.other_repo?.length > 0 && (
        <p className="text-[10.5px] text-body m-0 text-right">{result.other_repo.length} page{result.other_repo.length !== 1 ? 's' : ''} of another site left out</p>
      )}
    </div>
  );
}
