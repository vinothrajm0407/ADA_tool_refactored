import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, FileText, Download, ScanLine, Network, ClipboardList, Wrench, GitMerge, BellRing, Send, Settings2, Search,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../../utils/api';

// Fix History → "All activity" tab: every piece of work in the tool as one timeline (GET /api/activity).
export const KINDS = {
  scan:      { label: 'Page scans',      icon: ScanLine },
  crawl:     { label: 'Site crawls',     icon: Network },
  assistive: { label: 'Assistive tests', icon: ClipboardList },
  fix:       { label: 'Auto-Fixes',      icon: Wrench },
  review:    { label: 'PR reviews',      icon: GitMerge },
  alert:     { label: 'Alerts',          icon: BellRing },
  report:    { label: 'Reports sent',    icon: Send },
  setup:     { label: 'Setup',           icon: Settings2 },
};

const STATUS_DOT = { ok: 'bg-sage', fail: 'bg-coral', info: 'bg-gray-300' };

// Same filter the backend applies to exports (app.api_activity).
export function filterEvents(events, { kinds, q, from, to }) {
  const needle = q.trim().toLowerCase();
  return events.filter(e => {
    const day = e.at.slice(0, 10);
    if (kinds.size && !kinds.has(e.kind)) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (needle && ![e.action, e.target, e.result, e.by, e.ref].join(' ').toLowerCase().includes(needle)) return false;
    return true;
  });
}

function localDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function localTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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

export default function ActivityTimeline() {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [kinds, setKinds]     = useState(new Set());
  const [q, setQ]             = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await (await apiFetch('/api/activity')).json();
      if (data.ok) setEvents(data.events || []);
      else setError(data.error || 'Could not load activity');
    } catch { setError('Could not load activity'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => filterEvents(events, { kinds, q, from, to }), [events, kinds, q, from, to]);
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.kind] = (c[e.kind] || 0) + 1;
    return c;
  }, [events]);
  const days = useMemo(() => {
    const groups = [];
    for (const e of shown) {
      const day = localDay(e.at);
      if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
      groups.at(-1).items.push(e);
    }
    return groups;
  }, [shown]);

  function toggleKind(k) {
    setKinds(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  async function exportAs(format) {
    setExporting(format);
    setError('');
    const params = new URLSearchParams({ format });
    if (kinds.size) params.set('kind', [...kinds].join(','));
    if (q.trim()) params.set('q', q.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      await download(`/api/activity?${params}`, `activity-history-${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (e) { setError(e.message); } finally { setExporting(''); }
  }

  const failed = shown.filter(e => e.status === 'fail').length;

  return (
    <div className="space-y-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[13px] text-body">Scans, crawls, tests, fixes, PR approvals and merges, alerts, reports sent and setup changes.</p>
              <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => exportAs('pdf')} disabled={!!exporting || !shown.length}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                <FileText size={14} /> {exporting === 'pdf' ? 'Building…' : 'Export PDF'}
              </button>
              <button onClick={() => exportAs('csv')} disabled={!!exporting || !shown.length}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50">
                <Download size={14} /> {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
              </button>
              <button onClick={load} disabled={loading}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
              </div>
            </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            {Object.entries(KINDS).map(([k, { label, icon: Icon }]) => (
              <button key={k} type="button" onClick={() => toggleKind(k)} aria-pressed={kinds.has(k)}
                className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  kinds.has(k) ? 'bg-teal text-white border-teal' : 'bg-white text-body border-gray-200 hover:border-teal'}`}>
                <Icon size={12} /> {label} <span className="opacity-70">{counts[k] || 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[220px]">
              <span className="block text-[11px] font-semibold text-body mb-1">Search</span>
              <span className="relative block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="URL, rule, person, reference…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg" />
              </span>
            </label>
            <label>
              <span className="block text-[11px] font-semibold text-body mb-1">From</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </label>
            <label>
              <span className="block text-[11px] font-semibold text-body mb-1">To</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </label>
            {(kinds.size > 0 || q || from || to) && (
              <button type="button" onClick={() => { setKinds(new Set()); setQ(''); setFrom(''); setTo(''); }}
                className="text-[12px] font-medium text-teal hover:underline pb-2">Clear filters</button>
            )}
          </div>
          <p className="text-[12px] text-body" aria-live="polite">
            Showing <b>{shown.length}</b> of {events.length} events
            {failed > 0 && <> · <span className="text-coral font-semibold">{failed} failed or need attention</span></>}
          </p>
        </div>

        {error && <p className="text-[12px] text-coral" role="alert">{error}</p>}

        {/* Timeline */}
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-[64px] rounded-2xl bg-gray-100 animate-pulse" />)}</div>
        ) : !shown.length ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-body">
            {events.length ? 'No activity matches these filters.' : 'No activity yet. Run a scan to get started.'}
          </div>
        ) : (
          days.map(({ day, items }) => (
            <section key={day} aria-label={day}>
              <h2 className="text-[12px] font-bold text-ink uppercase tracking-wide mb-2">
                {day} <span className="font-normal text-body normal-case">· {items.length} event{items.length !== 1 ? 's' : ''}</span>
              </h2>
              <ol className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
                {items.map((e, i) => {
                  const Icon = KINDS[e.kind]?.icon || Settings2;
                  return (
                    <li key={`${e.at}-${i}`} className="flex items-start gap-3 px-4 py-3">
                      <span className="text-[11px] text-body w-12 flex-shrink-0 pt-0.5">{localTime(e.at)}</span>
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[e.status] || STATUS_DOT.info}`}
                        aria-label={e.status === 'ok' ? 'succeeded' : e.status === 'fail' ? 'failed' : 'info'} role="img" />
                      <Icon size={14} className="text-body mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-ink">
                          {e.action}
                          {e.ref && <span className="ml-2 font-mono text-[10px] font-normal text-body">{e.ref}</span>}
                        </p>
                        {e.target && <p className="text-[12px] text-body truncate">{e.target}</p>}
                        {e.result && <p className={`text-[12px] ${e.status === 'fail' ? 'text-coral' : 'text-ink'}`}>{e.result}</p>}
                      </div>
                      <div className="text-right flex-shrink-0 space-y-1">
                        {e.by && <p className="text-[11px] text-body">{e.by}</p>}
                        {e.link && (
                          <a href={e.link} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal hover:underline">
                            Open <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
    </div>
  );
}
