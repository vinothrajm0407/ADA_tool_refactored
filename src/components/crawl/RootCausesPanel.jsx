import { useCallback, useEffect, useState } from 'react';
import { Layers, Wrench, Wand2, ExternalLink, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { useAutoFixSupport, autoFixUnavailableReason } from '../../utils/autoFixSupport';
import { coveredFix, remainingFixable } from '../../utils/fixState';

const IMPACT = { critical: 'text-coral bg-coral/10', serious: 'text-amber bg-amber/10', moderate: 'text-blue-600 bg-blue-50', minor: 'text-body bg-gray-100' };

function pathOf(url) {
  try { const u = new URL(url); return u.pathname === '/' ? u.hostname : u.pathname; } catch { return url; }
}

function FixState({ fix }) {
  if (!fix) return null;
  const [label, cls] = fix.pr_state === 'merged' && fix.still_live ? ['Merged, but still on the live site', 'text-amber bg-amber/10']
    : fix.pr_state === 'merged' ? ['Fixed — merged', 'text-sage bg-sage/10']
    : fix.pr_state === 'open' ? [fix.approval_status === 'changes_requested' ? 'Changes requested' : 'PR awaiting approval', 'text-amber bg-amber/10']
    : fix.pr_state === 'closed' ? ['PR closed', 'text-body bg-gray-100']
    : fix.status === 'failed' ? ['Last fix failed', 'text-coral bg-coral/10'] : [null, null];
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}
      title={fix.still_live ? 'This crawl ran after the merge and still found the problem — the fix was merged into a branch the live site is not built from yet (for example a QA branch), or it is not deployed.' : undefined}>
      {label}
      {fix.pr_url && <a href={fix.pr_url} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-center gap-0.5"
        onClick={e => e.stopPropagation()}>#{fix.pr_url.split('/').pop()}<ExternalLink size={9} /></a>}
    </span>
  );
}

function Outcome({ result }) {
  if (result.error && !result.pr_url) {
    return <p className="text-[12px] text-coral flex items-start gap-1.5" role="alert"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{result.error}</p>;
  }
  const checked = (result.pages_checked || []).filter(p => p.fixed !== null);
  const clean = checked.filter(p => p.fixed).length;
  return (
    <div className="text-[12px] space-y-1" role="status">
      <p className="text-sage font-semibold flex items-center gap-1.5"><CheckCircle2 size={13} />
        {result.duplicate ? 'A pull request for this root cause is already open.' : 'Fixed once at the source — one pull request for every affected page.'}
        {result.pr_url && <a href={result.pr_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline inline-flex items-center gap-0.5">
          Open PR <ExternalLink size={10} /></a>}
      </p>
      {checked.length > 0 && (
        <p className="text-body">Re-scanned {checked.length} other affected page{checked.length !== 1 ? 's' : ''} against the patched build:
          <b className={clean === checked.length ? ' text-sage' : ' text-amber'}> {clean} of {checked.length} clean</b>.</p>
      )}
      {!result.duplicate && <p className="text-body">It now waits for an Approver in Fix History.</p>}
    </div>
  );
}

function RootCauseRow({ rc, crawlId, repoConnected, support, onFixed }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const unavailable = autoFixUnavailableReason(support, rc.rule_id, true);
  const hasOpenPr = rc.fix?.pr_state === 'open' || rc.fix?.pr_state === 'merged';

  async function fix() {
    setBusy(true); setResult(null);
    try {
      const res = await apiFetch(`/api/crawl/${crawlId}/root-causes/${rc.id}/fix`, { method: 'POST' });
      const data = await res.json();
      setResult(data.ok ? data : { error: data.error || 'Auto Fix failed' });
      if (data.ok) onFixed();
    } catch (e) { setResult({ error: e.message }); } finally { setBusy(false); }
  }

  return (
    <li className="px-5 py-4 border-t border-gray-100 first:border-t-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] font-semibold text-ink">{rc.help || rc.rule_id}</p>
            {rc.impact && <span className={`text-[10.5px] font-semibold uppercase px-1.5 py-0.5 rounded ${IMPACT[rc.impact] || IMPACT.minor}`}>{rc.impact}</span>}
            <FixState fix={rc.fix} />
          </div>
          <p className="text-[12px] text-body mt-0.5">
            <b className="text-ink">{rc.page_count} pages</b> · {rc.occurrences} element{rc.occurrences !== 1 ? 's' : ''} ·
            <span className="font-mono"> {rc.rule_id}</span>
          </p>
          <code className="block mt-1.5 text-[11px] bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-ink truncate" title={rc.html}>{rc.html}</code>
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="mt-1.5 text-[11.5px] font-medium text-teal hover:underline inline-flex items-center gap-1">
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? 'Hide' : 'Show'} affected pages
          </button>
          {open && (
            <ul className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[11.5px] text-body list-none pl-0">
              {rc.pages.map(u => <li key={u} className="truncate" title={u}>{pathOf(u)}</li>)}
              {rc.page_count > rc.pages.length && <li>…and {rc.page_count - rc.pages.length} more</li>}
            </ul>
          )}
        </div>
        <div className="shrink-0 text-right max-w-[260px]">
          {unavailable ? <p className="text-[11.5px] text-body">{unavailable}</p>
            : !repoConnected ? <p className="text-[11.5px] text-body">Connect this site’s repo under Connected Repos to fix it at the source.</p>
            : (
              <button type="button" onClick={fix} disabled={busy || hasOpenPr}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                title={hasOpenPr ? 'This root cause already has a pull request' : undefined}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                {busy ? 'Fixing…' : `Fix once · ${rc.page_count} pages`}
              </button>
            )}
          {busy && <p className="text-[11px] text-body mt-1.5">Finding the source, building, then re-scanning other affected pages — this takes a few minutes.</p>}
        </div>
      </div>
      {result && <div className="mt-3"><Outcome result={result} /></div>}
    </li>
  );
}

// Site fixes still running, by crawl. Module-level: leaving the crawl page and
// coming back mid-run shows "Fixing…" instead of starting a second run and PR.
const runningSiteFixes = new Map();

// One page's fix status, from page-summary: open PRs, merged, failed, left to fix.
function PageFixStatus({ url, s }) {
  const fixes = Object.values(s.fixes || {});
  const open = [...new Set(fixes.filter(f => coveredFix(f) && f.pr_state === 'open').map(f => f.pr_url))];
  const merged = fixes.filter(f => f.pr_state === 'merged').length;
  const failed = fixes.filter(f => f.status === 'failed' && !f.pr_url).length;
  const left = remainingFixable(s);
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 border-t border-gray-100 first:border-t-0 text-[12px]">
      <span className="truncate text-ink min-w-0" title={url}>{pathOf(url)}</span>
      <span className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap justify-end shrink-0">
        {open.map(u => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-sage font-semibold hover:underline inline-flex items-center gap-0.5">
            PR #{u.split('/').pop()} open <ExternalLink size={9} />
          </a>
        ))}
        {merged > 0 && <span className="text-sage">{merged} merged</span>}
        {failed > 0 && <span className="text-coral" title="Open the page in Fix these first to see why">{failed} failed</span>}
        {left > 0 ? <span className="text-body">{left} left to fix</span>
          : !open.length && !merged && !failed && <span className="text-body">nothing auto-fixable</span>}
      </span>
    </li>
  );
}

// Fix everything: every auto-fixable issue on every page, one pull request.
function SiteFix({ crawlId, summary, onDone }) {
  const [running, setRunning] = useState(runningSiteFixes.has(crawlId));
  const [result, setResult] = useState(null);
  useEffect(() => {
    const p = runningSiteFixes.get(crawlId);
    if (!p) return;
    let live = true;
    p.then(r => { if (live) { setRunning(false); setResult(r); onDone(); } });
    return () => { live = false; };
  }, [crawlId]);

  const pages = Object.entries(summary || {}).filter(([, s]) => s.fixable > 0 || Object.keys(s.fixes || {}).length);
  const left = pages.reduce((n, [, s]) => n + remainingFixable(s), 0);
  const pagesLeft = pages.filter(([, s]) => remainingFixable(s) > 0).length;
  if (!pages.length) return null;

  function run() {
    const p = apiFetch(`/api/crawl/${crawlId}/fix-site`, { method: 'POST' })
      .then(r => r.json())
      .then(d => (d.ok ? d : { error: d.error || 'Fix all failed' }))
      .catch(() => ({ error: 'Could not reach the server' }))
      .finally(() => runningSiteFixes.delete(crawlId));
    runningSiteFixes.set(crawlId, p);
    setRunning(true); setResult(null);
    p.then(r => { setRunning(false); setResult(r); onDone(); });
  }

  return (
    <div className="px-5 py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink m-0">
          {left > 0
            ? <><b>{left}</b> auto-fixable issue{left !== 1 ? 's' : ''} left on <b>{pagesLeft}</b> page{pagesLeft !== 1 ? 's' : ''} — fix them all in one pull request.</>
            : <>Every auto-fixable issue already has a pull request.</>}
        </p>
        {(running || left > 0) && (
          <button type="button" onClick={run} disabled={running} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {running ? 'Fixing every page…' : `Fix all ${left} — one PR`}
          </button>
        )}
      </div>
      {running && <p className="text-[11.5px] text-body mt-1.5 mb-0">Patching every page in one copy of the repo, building once and re-scanning each page — this takes a few minutes. You can leave this page; it keeps running.</p>}
      {result && (result.pr_url
        ? <p className="text-[12px] mt-1.5 mb-0 text-sage font-semibold flex items-center gap-1.5 flex-wrap"><CheckCircle2 size={13} />
            {result.duplicate ? 'These issues already have an open pull request.' : `One pull request for ${result.fixed_pages} page${result.fixed_pages !== 1 ? 's' : ''}.`}
            <a href={result.pr_url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline inline-flex items-center gap-0.5">Open PR <ExternalLink size={10} /></a>
            {!result.duplicate && <span className="font-normal text-body">· waits for an Approver in Fix History</span>}</p>
        : result.duplicate ? <p className="text-[12px] mt-1.5 mb-0 text-sage font-semibold">{result.message || 'Every issue already has an open pull request.'}</p>
        : <p className="text-[12px] mt-1.5 mb-0 text-coral flex items-start gap-1.5" role="alert"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{result.error || 'Fix all failed'}</p>)}
      {result?.other_repo?.length > 0 && (
        <p className="text-[11px] text-body mt-1 mb-0">{result.other_repo.length} page{result.other_repo.length !== 1 ? 's' : ''} belong to another site and {result.other_repo.length !== 1 ? 'were' : 'was'} left out.</p>
      )}
      <ul className="list-none m-0 mt-3 p-0">
        {pages.map(([url, s]) => <PageFixStatus key={url} url={url} s={s} />)}
      </ul>
    </div>
  );
}

// Fix at the source: problems shared by many crawled pages, each traced to one
// piece of markup (a shared header, footer or component) and fixed with one PR.
// Below them: fix every remaining issue on every page in one PR, with each
// page's fix status.
export default function RootCausesPanel({ crawlId, isComplete, summary, onSiteFixed }) {
  const [data, setData] = useState(null); // null = loading
  const [showAll, setShowAll] = useState(false);
  const support = useAutoFixSupport();

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/crawl/${crawlId}/root-causes`);
      const d = await res.json();
      setData(d.ok ? d : { error: d.error || 'Could not load root causes' });
    } catch { setData({ error: 'Could not load root causes' }); }
  }, [crawlId]);

  useEffect(() => { if (crawlId && isComplete) load(); }, [crawlId, isComplete, load]);

  if (!isComplete) return null;
  const list = data?.root_causes || [];
  const shown = showAll ? list : list.slice(0, 5);
  const pagesHit = list.length ? Math.max(...list.map(r => r.page_count)) : 0;

  return (
    <section className="bg-white rounded-2xl border border-gray-100" aria-labelledby="root-causes-title">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal flex items-center justify-center shrink-0"><Layers size={16} /></span>
        <div>
          <h3 id="root-causes-title" className="font-heading font-semibold text-sm text-ink m-0">Fix at the source</h3>
          <p className="text-xs text-body mt-0.5">
            {data === null ? 'Tracing problems back to shared components…'
              : data.error ? data.error
              : list.length ? <>{list.length} problem{list.length !== 1 ? 's' : ''} repeat across pages — up to <b className="text-ink">{pagesHit} of {data.scanned_pages}</b> pages from one piece of shared markup. Fix each once and every page is fixed.</>
              : 'No markup repeats across pages, so each page needs its own change — fix them all at once below.'}
          </p>
        </div>
      </div>
      {data === null && <div className="px-5 py-4"><div className="h-14 rounded-xl bg-gray-100 animate-pulse" /></div>}
      {list.length > 0 && (
        <ul className="list-none m-0 p-0">
          {shown.map(rc => (
            <RootCauseRow key={rc.id} rc={rc} crawlId={crawlId} repoConnected={rc.repo_connected ?? data.repo_connected} support={support} onFixed={load} />
          ))}
        </ul>
      )}
      {list.length > 5 && (
        <div className="px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={() => setShowAll(s => !s)} className="text-[12px] font-medium text-teal hover:underline">
            {showAll ? 'Show top 5' : `Show all ${list.length}`}
          </button>
        </div>
      )}
      {data && !data.error && (list.length === 0 || data.repo_connected) && (
        <div className={list.length ? 'border-t border-gray-100' : ''}>
          <SiteFix crawlId={crawlId} summary={summary} onDone={() => { onSiteFixed?.(); load(); }} />
        </div>
      )}
    </section>
  );
}
