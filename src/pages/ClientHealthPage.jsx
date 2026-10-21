import { apiFetch } from '../utils/api';
import { useState, useEffect, useMemo } from 'react';
import {
  Globe, FileText, CheckCircle2, AlertCircle, ExternalLink, ChevronDown, Search,
  ScanLine, ArrowRight, Layers, ShieldCheck,
} from 'lucide-react';
import { formatShortDate } from '../utils/format';
import { useApp } from '../context/AppContext';

const SORTS = [
  { value: 'open-desc', label: 'Most open issues' },
  { value: 'open-asc',  label: 'Fewest open issues' },
  { value: 'pages-desc', label: 'Most pages' },
  { value: 'name',      label: 'Name (A–Z)' },
];

const pct = (fixed, open) => (fixed + open > 0 ? Math.round((fixed / (fixed + open)) * 100) : 100);

// One plain-language health label per website, so the list reads at a glance.
function health(open, fixedPct) {
  if (open === 0) return { label: 'All clear', cls: 'bg-sage/15 text-sage-700', bar: 'bg-sage' };
  if (fixedPct >= 50) return { label: 'In progress', cls: 'bg-amber/15 text-amber-800', bar: 'bg-amber' };
  return { label: 'Needs attention', cls: 'bg-coral/15 text-coral-700', bar: 'bg-coral' };
}

function Progress({ value, bar, className = '' }) {
  return (
    <div className={`h-2 bg-gray-100 rounded-full overflow-hidden ${className}`} role="img" aria-label={`${value}% of issues fixed`}>
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${value}%`, transition: 'width .6s ease' }} />
    </div>
  );
}

function PageRow({ page }) {
  const fixedPct = pct(page.fixed_issues, page.open_issues);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 pl-12 pr-4 border-t border-gray-100 text-sm hover:bg-gray-50/60">
      <FileText size={14} className="text-gray-300 flex-shrink-0 -ml-6" aria-hidden="true" />
      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-[200px] truncate text-ink hover:text-teal hover:underline inline-flex items-center gap-1.5"
        title={page.url}
      >
        <span className="truncate">{page.url}</span>
        <ExternalLink size={11} className="flex-shrink-0 text-gray-300" aria-label="opens in new tab" />
      </a>
      <span className="text-xs font-semibold text-coral-700 whitespace-nowrap">{page.open_issues} open</span>
      <span className="text-xs font-semibold text-sage-700 whitespace-nowrap">{page.fixed_issues} fixed</span>
      <Progress value={fixedPct} bar="bg-sage" className="w-20 flex-shrink-0 !h-1.5" />
      <span className="text-xs text-body w-24 text-right flex-shrink-0">
        {page.last_scanned ? formatShortDate(page.last_scanned) : '—'}
      </span>
    </div>
  );
}

function WebsiteGroup({ site, open, onToggle }) {
  const fixedPct = pct(site.fixed_issues, site.open_issues);
  const h = health(site.open_issues, fixedPct);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-5 gap-y-3 p-5 text-left hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/40"
      >
        <span className="w-10 h-10 rounded-xl bg-teal/10 flex items-center justify-center flex-shrink-0">
          <Globe size={18} className="text-teal" />
        </span>
        <span className="flex-1 min-w-[180px]">
          <span className="block font-heading font-semibold text-ink truncate">{site.domain}</span>
          <span className="block text-xs text-body mt-0.5">{site.page_count} page{site.page_count === 1 ? '' : 's'} tracked</span>
        </span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${h.cls}`}>{h.label}</span>
        <span className="flex items-center gap-4 text-xs font-semibold whitespace-nowrap">
          <span className="text-coral-700 inline-flex items-center gap-1"><AlertCircle size={13} /> {site.open_issues} open</span>
          <span className="text-sage-700 inline-flex items-center gap-1"><CheckCircle2 size={13} /> {site.fixed_issues} fixed</span>
        </span>
        <span className="flex items-center gap-2 w-36 flex-shrink-0">
          <Progress value={fixedPct} bar={h.bar} className="flex-1" />
          <span className="text-xs font-semibold text-ink tabular-nums w-9 text-right">{fixedPct}%</span>
        </span>
        <ChevronDown size={18} className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="bg-ivory/50">
          {site.pages.map((page) => <PageRow key={page.url} page={page} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, tone, value, label, hint }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${tone}`}><Icon size={20} /></span>
      <div className="min-w-0">
        <p className="font-heading text-2xl font-bold text-ink leading-none tabular-nums m-0">{value}</p>
        <p className="text-sm font-medium text-ink mt-1.5 mb-0">{label}</p>
        <p className="text-xs text-body mt-0.5 mb-0">{hint}</p>
      </div>
    </div>
  );
}

export default function ClientHealthPage() {
  const { navigate } = useApp();
  const [websites, setWebsites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('open-desc');
  const [openSites, setOpenSites] = useState(() => new Set());

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
  const overall = pct(totalFixed, totalOpen);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? websites.filter(w => w.domain.toLowerCase().includes(q)) : [...websites];
    return list.sort((a, b) => {
      switch (sort) {
        case 'open-asc':   return a.open_issues - b.open_issues;
        case 'pages-desc': return b.page_count - a.page_count;
        case 'name':       return a.domain.localeCompare(b.domain);
        default:           return b.open_issues - a.open_issues;
      }
    });
  }, [websites, query, sort]);

  const toggle = (domain) => setOpenSites(prev => {
    const next = new Set(prev);
    next.has(domain) ? next.delete(domain) : next.add(domain);
    return next;
  });
  const allOpen = visible.length > 0 && visible.every(w => openSites.has(w.domain));

  return (
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading font-bold text-2xl text-ink m-0">Client Health</h1>
            <p className="text-sm text-body mt-1 mb-0 max-w-2xl">
              See how every website is doing, which pages still have problems, and how much has already been fixed.
            </p>
          </div>
          <button onClick={() => navigate('new-scan')} className="btn-primary">
            <ScanLine size={15} /> Run new audit
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat icon={Globe} tone="bg-teal/10 text-teal" value={loading ? '…' : websites.length} label="Websites" hint="Being tracked" />
          <Stat icon={Layers} tone="bg-brand-blue/10 text-brand-blue-700" value={loading ? '…' : totalPages} label="Pages tracked" hint="Across all websites" />
          <Stat icon={AlertCircle} tone="bg-coral/10 text-coral-700" value={loading ? '…' : totalOpen} label="Open issues" hint="Still need fixing" />
          <Stat icon={ShieldCheck} tone="bg-sage/10 text-sage-700" value={loading ? '…' : `${overall}%`} label="Resolved" hint={`${totalFixed} issue${totalFixed === 1 ? '' : 's'} fixed`} />
        </div>

        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading client health">
            {[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : !available ? (
          <div className="card p-10 text-center">
            <AlertCircle size={24} className="text-amber mx-auto mb-3" />
            <p className="font-heading font-semibold text-ink m-0">Health data isn&apos;t available right now</p>
            <p className="text-sm text-body mt-1 mb-0">The database isn&apos;t reachable. Try again in a moment.</p>
          </div>
        ) : websites.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-teal/10 flex items-center justify-center mx-auto mb-4">
              <ScanLine size={22} className="text-teal" />
            </div>
            <h2 className="font-heading font-semibold text-lg text-ink m-0">Nothing to show yet</h2>
            <p className="text-sm text-body mt-1 mb-5">Run an audit and each website will appear here with its health.</p>
            <button onClick={() => navigate('new-scan')} className="btn-primary">Run an audit <ArrowRight size={15} /></button>
          </div>
        ) : (
          <section aria-label="Websites">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div className="flex-1 min-w-[220px] flex items-center gap-2 h-10 px-3 rounded-lg border border-solid border-gray-300 bg-white focus-within:ring-2 focus-within:ring-teal/40">
                <Search size={15} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
                <label className="sr-only" htmlFor="health-search">Search websites</label>
                <input
                  id="health-search"
                  type="search"
                  placeholder="Search websites…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full border-0 p-0 bg-transparent text-sm text-ink placeholder-gray-400 focus:outline-none"
                />
              </div>
              <label className="sr-only" htmlFor="health-sort">Sort websites</label>
              <select
                id="health-sort"
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="h-10 px-3 rounded-lg border border-solid border-gray-300 bg-white text-sm text-ink cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
              >
                {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setOpenSites(allOpen ? new Set() : new Set(visible.map(w => w.domain)))}
                className="btn-secondary !py-2 text-xs"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>

            {visible.length === 0 ? (
              <div className="card p-8 text-center text-sm text-body">No websites match &ldquo;{query}&rdquo;.</div>
            ) : (
              <div className="space-y-3">
                {visible.map((site) => (
                  <WebsiteGroup key={site.domain} site={site} open={openSites.has(site.domain)} onToggle={() => toggle(site.domain)} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
