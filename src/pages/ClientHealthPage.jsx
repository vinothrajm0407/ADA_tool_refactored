import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import { Globe, FileText, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { formatShortDate } from '../utils/format';

function PageRow({ page }) {
  const total = page.open_issues + page.fixed_issues;
  const fixedPct = total > 0 ? Math.round((page.fixed_issues / total) * 100) : 100;
  return (
    <div className="flex items-center gap-4 py-2.5 pl-10 pr-3 border-t border-gray-50 text-sm">
      <FileText size={14} className="text-gray-300 flex-shrink-0" />
      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 truncate text-ink hover:text-teal hover:underline flex items-center gap-1"
        title={page.url}
      >
        {page.url}
        <ExternalLink size={11} className="flex-shrink-0 text-gray-300" />
      </a>
      <span className="text-xs text-coral font-semibold w-16 text-right">{page.open_issues} open</span>
      <span className="text-xs text-sage-700 font-semibold w-16 text-right">{page.fixed_issues} fixed</span>
      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0" aria-hidden="true">
        <div className="h-full bg-sage" style={{ width: `${fixedPct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-24 text-right flex-shrink-0">
        {page.last_scanned ? formatShortDate(page.last_scanned) : '—'}
      </span>
    </div>
  );
}

function WebsiteGroup({ site }) {
  const [open, setOpen] = useState(false);
  const total = site.open_issues + site.fixed_issues;
  const fixedPct = total > 0 ? Math.round((site.fixed_issues / total) * 100) : 100;
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <Globe size={16} className="text-teal flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate font-semibold text-ink">{site.domain}</span>
        <span className="text-xs text-gray-400 w-24 text-right">{site.page_count} page{site.page_count === 1 ? '' : 's'}</span>
        <span className="text-xs text-coral font-semibold w-20 text-right flex items-center justify-end gap-1">
          <AlertCircle size={12} /> {site.open_issues} open
        </span>
        <span className="text-xs text-sage-700 font-semibold w-20 text-right flex items-center justify-end gap-1">
          <CheckCircle2 size={12} /> {site.fixed_issues} fixed
        </span>
        <div className="w-28 h-2 bg-gray-100 rounded-full overflow-hidden flex-shrink-0" aria-hidden="true">
          <div className="h-full bg-sage" style={{ width: `${fixedPct}%` }} />
        </div>
      </button>
      {open && (
        <div className="pb-1">
          {site.pages.map((page) => (
            <PageRow key={page.url} page={page} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClientHealthPage() {
  const [websites, setWebsites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch('/api/health-tree');
        const json = await res.json().catch(() => ({ ok: false }));
        if (cancelled) return;
        if (json.ok && json.available) {
          setWebsites(Array.isArray(json.websites) ? json.websites : []);
        } else {
          setAvailable(false);
        }
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalOpen = websites.reduce((s, w) => s + w.open_issues, 0);
  const totalFixed = websites.reduce((s, w) => s + w.fixed_issues, 0);
  const totalPages = websites.reduce((s, w) => s + w.page_count, 0);

  return (
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="font-heading font-bold text-2xl text-ink">Client Health</h1>
          <p className="text-sm text-body mt-1">
            Every website scanned, every page, what's open and what's already fixed — drill in by clicking a website.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-ink">{totalPages}</p>
            <p className="text-[11px] text-body mt-0.5">Pages tracked</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-coral">{totalOpen}</p>
            <p className="text-[11px] text-body mt-0.5">Open issues</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-sage-700">{totalFixed}</p>
            <p className="text-[11px] text-body mt-0.5">Fixes merged</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 bg-gray-50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !available ? (
          <div className="card p-10 text-center text-body text-sm">
            Health data isn't available right now — database not configured.
          </div>
        ) : websites.length === 0 ? (
          <div className="card p-10 text-center text-body text-sm">
            No scans yet. Run an audit to start building this report.
          </div>
        ) : (
          <div className="space-y-3">
            {websites.map((site) => (
              <WebsiteGroup key={site.domain} site={site} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
