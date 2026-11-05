import { useEffect, useState } from 'react';
import { Lock, LockOpen, Loader2, ArrowRight } from 'lucide-react';
import { apiFetch } from '../../utils/api';

// A "compare" login crawl is two linked crawls of the same site, run side by
// side: one signed out, one logged in. This panel lines their pages up.

const isFailed = (p) => /fail|error/i.test(p?.status || '');
const score = (p) => (p && !isFailed(p) && p.pass_rate != null ? Math.round(p.pass_rate) : null);
const issues = (p) => (p && !isFailed(p) && typeof p.violations === 'number' ? p.violations : null);

function pathOf(url = '') {
  try { const u = new URL(url); return (u.pathname + u.search) || '/'; } catch { return url; }
}

function summary(pages) {
  const ok = pages.filter((p) => score(p) != null);
  return {
    pages: pages.length,
    avg: ok.length ? Math.round(ok.reduce((n, p) => n + score(p), 0) / ok.length) : null,
    violations: ok.reduce((n, p) => n + issues(p), 0),
  };
}

const bare = (url = '') => url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/** Rows: pages on both sides, only when logged in, only when signed out.
 *  `loginUrl`: the logged-in crawl scans its login page signed out, so that
 *  page counts as a signed-out page. */
export function compareRows(signedOut, loggedIn, loginUrl = '') {
  const byUrl = new Map(signedOut.map((p) => [p.normalized_url || p.url, p]));
  const used = new Set();
  const rows = [];
  for (const p of loggedIn) {
    const key = p.normalized_url || p.url;
    // A logged-in page that sends a signed-out visitor away is only reachable
    // logged in, even if the signed-out crawl recorded the same address.
    if (p.section === 'after_login') {
      used.add(key);
      rows.push({ group: 'logged_in', url: p.url, loggedIn: p });
    } else if (byUrl.has(key)) {
      used.add(key);
      rows.push({ group: 'both', url: p.url, signedOut: byUrl.get(key), loggedIn: p });
    } else if (loginUrl && bare(p.url) === bare(loginUrl)) {
      rows.push({ group: 'signed_out', url: p.url, signedOut: p });
    } else {
      // Public, but only the logged-in crawl reached it.
      rows.push({ group: 'both', url: p.url, loggedIn: p });
    }
  }
  for (const p of signedOut) {
    if (!used.has(p.normalized_url || p.url)) rows.push({ group: 'signed_out', url: p.url, signedOut: p });
  }
  return rows;
}

const GROUPS = [
  ['both', 'Public pages', 'Open to everyone — scanned signed out and logged in'],
  ['logged_in', 'Members-only pages', 'Only open after logging in'],
  ['signed_out', 'Only when signed out', 'Pages a logged-in user is not shown, e.g. the login page'],
];

function Cell({ page }) {
  if (!page) return <span className="text-body">—</span>;
  if (isFailed(page)) return <span className="text-body" title={page.failure_reason || ''}>Not scanned</span>;
  return (
    <span className="tabular-nums">
      <strong className="text-ink">{score(page) ?? '—'}</strong>
      <span className="text-body"> · </span>
      <span className={issues(page) > 0 ? 'text-coral font-semibold' : 'text-sage font-semibold'}>{issues(page)} issue{issues(page) === 1 ? '' : 's'}</span>
    </span>
  );
}

function Diff({ row }) {
  const a = issues(row.signedOut), b = issues(row.loggedIn);
  if (a == null || b == null) return <span className="text-body">—</span>;
  const d = b - a;
  if (d === 0) return <span className="text-body">Same</span>;
  return <span className={`font-semibold ${d > 0 ? 'text-coral' : 'text-sage'}`}>{d > 0 ? `+${d}` : d} when logged in</span>;
}

export default function LoginComparePanel({ job, pages, onOpenCrawl }) {
  const pair = job?.pair;
  const [other, setOther] = useState({ job: null, pages: [] });

  useEffect(() => {
    if (!pair?.crawl_id) return undefined;
    let stop = false;
    let timer;
    async function load() {
      try {
        const [j, p] = await Promise.all([
          apiFetch(`/api/crawl/${pair.crawl_id}`).then((r) => r.json()),
          apiFetch(`/api/crawl/${pair.crawl_id}/pages`).then((r) => r.json()),
        ]);
        if (stop) return;
        setOther({ job: j.job || null, pages: Array.isArray(p.pages) ? p.pages : [] });
        if (['running', 'pending'].includes(j.job?.status)) timer = setTimeout(load, 4000);
      } catch { /* keep what we have */ }
    }
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [pair?.crawl_id]);

  if (!pair?.crawl_id) return null;
  const thisIsLoggedIn = pair.role === 'logged_in';
  const loggedIn = thisIsLoggedIn ? pages : other.pages;
  const signedOut = thisIsLoggedIn ? other.pages : pages;
  const loggedInJob = thisIsLoggedIn ? job : other.job;
  const rows = compareRows(signedOut, loggedIn, loggedInJob?.login?.url);
  const sides = [
    { id: 'signed_out', label: 'Signed out', Icon: LockOpen, stats: summary(rows.map((r) => r.signedOut).filter(Boolean)), job: thisIsLoggedIn ? other.job : job },
    { id: 'logged_in', label: 'Logged in', Icon: Lock, stats: summary(rows.map((r) => r.loggedIn).filter(Boolean)), job: thisIsLoggedIn ? job : other.job },
  ];
  const otherRunning = ['running', 'pending'].includes(other.job?.status);

  return (
    <section className="card p-6" aria-labelledby="login-compare-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="login-compare-title" className="text-lg font-heading font-bold text-ink leading-snug m-0">Signed out vs logged in</h3>
          <p className="text-sm text-body mt-1 mb-0">The same site crawled twice, side by side: as a visitor and as a logged-in user.</p>
        </div>
        {onOpenCrawl && (
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => onOpenCrawl(pair.crawl_id)}>
            Open the {thisIsLoggedIn ? 'signed-out' : 'logged-in'} crawl <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {sides.map(({ id, label, Icon, stats, job: sideJob }) => (
          <div key={id} className="rounded-2xl border-2 border-solid border-gray-100 p-5">
            <p className="inline-flex items-center gap-2 font-heading font-semibold text-ink m-0">
              <Icon size={16} aria-hidden="true" /> {label}
              {['running', 'pending'].includes(sideJob?.status) && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-body"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> crawling…</span>
              )}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              {[[stats.pages, 'Pages'], [stats.avg ?? '—', 'Avg score'], [stats.violations, 'Violations']].map(([v, l]) => (
                <div key={l}><p className="font-heading font-bold text-2xl text-ink tabular-nums m-0">{v}</p><p className="text-[11px] text-body m-0">{l}</p></div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!otherRunning && !['running', 'pending'].includes(job?.status) && rows.length > 0 && !rows.some((r) => r.group === 'logged_in') && (
        <p role="note" className="text-sm text-ink bg-amber/10 rounded-xl px-4 py-3 mt-4 mb-0">
          The login worked, but no members-only pages were found: the logged-in crawl only reached public pages, so both
          columns show the same pages. Start the crawl from a page inside the members area (for example the account
          or dashboard URL) to compare members-only pages.
        </p>
      )}

      {otherRunning && <p className="text-xs text-body mt-3 mb-0">The other crawl is still running — this comparison fills in as its pages finish.</p>}

      <div className="overflow-x-auto mt-5">
        <table className="w-full text-sm">
          <caption className="sr-only">Pages compared signed out and logged in</caption>
          <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-widest text-body">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Page</th>
              <th scope="col" className="px-3 py-2 font-semibold">Signed out</th>
              <th scope="col" className="px-3 py-2 font-semibold">Logged in</th>
              <th scope="col" className="px-3 py-2 font-semibold">Difference</th>
            </tr>
          </thead>
          {GROUPS.map(([id, label, hint]) => {
            const groupRows = rows.filter((r) => r.group === id);
            if (!groupRows.length) return null;
            return (
              <tbody key={id} className="divide-y divide-gray-50">
                <tr className="bg-gray-50">
                  <th scope="colgroup" colSpan={4} className="px-3 py-2 text-left">
                    <span className="font-semibold text-ink">{label} · {groupRows.length}</span>
                    <span className="ml-2 text-xs font-normal text-body">{hint}</span>
                  </th>
                </tr>
                {groupRows.map((r) => (
                  <tr key={`${id}-${r.url}`}>
                    <td className="px-3 py-2 max-w-xs"><span className="block truncate font-medium text-ink" title={r.url}>{pathOf(r.url)}</span></td>
                    <td className="px-3 py-2"><Cell page={r.signedOut} /></td>
                    <td className="px-3 py-2"><Cell page={r.loggedIn} /></td>
                    <td className="px-3 py-2">{id === 'both' ? <Diff row={r} /> : <span className="text-body">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}
