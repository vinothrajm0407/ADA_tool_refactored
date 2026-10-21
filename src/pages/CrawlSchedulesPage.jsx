import { apiFetch } from '../utils/api';
import { useState, useEffect, Fragment } from 'react';
import {
  CalendarClock, Plus, Trash2, Play, RefreshCw, Square,
  Pencil, ChevronDown, Search, AlertTriangle, Radio, X,
  ExternalLink, Clock, History, CheckCircle2,
} from 'lucide-react';
import GlowInput from '../components/ui/GlowInput';
import PageHeader from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useApp } from '../context/AppContext';

const FREQ_LABELS = { hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const FREQ_OPTIONS = ['hourly', 'daily', 'weekly', 'monthly'];
const STATUS_FILTERS = ['all', 'active', 'paused', 'running'];

const RUN_STATUS_BADGE = {
  completed: 'Passed',
  failed: 'Failed',
  cancelled: 'Failed',
  running: 'Running',
  pending: 'Running',
};

// The "time of day" / "run at minute" picker shows the browser's LOCAL wall
// clock, but the backend computes next-run times in UTC — so the value has to
// cross that boundary converted, in both directions, or the schedule fires at
// the wrong instant (this is exactly what was happening: a local 15:08 was
// being stored and used as if it meant 15:08 UTC). Using today's date as the
// reference handles fractional-hour offsets (e.g. IST's +5:30) correctly via
// the JS Date engine's own UTC arithmetic — no manual offset math needed.
function localTimeToUtc(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function utcTimeToLocal(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

// Best-effort English summary of a 5-field cron expression — covers the common
// shapes (every-N via "*/N", a fixed time, a fixed weekday/day-of-month) and
// falls back to echoing the raw expression for anything more exotic, so the
// preview never lies, it just gets less chatty for unusual patterns.
function cronToEnglish(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `Runs every ${minStep[1]} minutes`;
  }
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep && !isNaN(Number(min)) && dom === '*' && month === '*' && dow === '*') {
    return `Runs every ${hourStep[1]} hours, at minute ${min}`;
  }
  const fixedTime = !isNaN(Number(min)) && !isNaN(Number(hour));
  if (fixedTime && dom === '*' && month === '*' && /^\d$/.test(dow)) {
    return `Runs at ${pad2(hour)}:${pad2(min)} UTC, only on ${DOW_NAMES[Number(dow)]}`;
  }
  if (fixedTime && !isNaN(Number(dom)) && month === '*' && dow === '*') {
    return `Runs at ${pad2(hour)}:${pad2(min)} UTC, on day ${dom} of the month`;
  }
  if (fixedTime && dom === '*' && month === '*' && dow === '*') {
    return `Runs daily at ${pad2(hour)}:${pad2(min)} UTC`;
  }
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Runs every minute';
  }
  return `Runs on schedule: ${expr}`;
}

// Countdown text for the "Time Until Run" column — recomputed every 60s from
// a shared `now` tick so every row updates together without per-row timers.
function timeUntil(iso, now) {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - now;
  if (diffMs <= 0) return 'Due now';
  const mins = Math.floor(diffMs / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${remMins}m`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function FrequencyBadge({ freq }) {
  const cls = {
    hourly:  'bg-terracotta/10 text-terracotta',
    daily:   'bg-teal/10 text-teal',
    weekly:'bg-blue-50 text-blue-600',
    monthly: 'bg-amber/10 text-amber',
  }[freq] ||'bg-gray-100 text-body';
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {FREQ_LABELS[freq] || freq}
    </span>
  );
}

function ScheduleStatusBadge({ status }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal">
        <Radio size={11} className="animate-pulse" /> Running
      </span>
    );
  }
  return (
    <span className={`text-xs font-semibold ${status ==='active'?'text-sage':'text-body'}`}>
      {status === 'active' ? 'Active' : 'Paused'}
    </span>
  );
}

function RunHistoryRow({ scheduleId }) {
  const { navigate, setCrawlId } = useApp();
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/crawl-schedules/${scheduleId}/runs?limit=5`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) setRuns(data.items || []);
        else setError(data.error || 'Failed to load run history');
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [scheduleId]);

  return (
    <div className="border-t border-solid border-gray-100 bg-ivory/60 px-5 py-4">
      {runs === null && !error && <p className="text-xs text-body m-0">Loading run history…</p>}
      {error && <p className="text-xs text-coral-700 m-0">{error}</p>}
      {runs && runs.length === 0 && <p className="text-xs text-body m-0">No runs yet. Use &ldquo;Run now&rdquo; to start one.</p>}
      {runs && runs.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-body mt-0 mb-2">Recent runs</p>
          <ul className="space-y-1 list-none p-0 m-0">
            {runs.map((run) => (
              <li key={run.crawl_id}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-3 text-sm text-left rounded-lg px-3 py-2 bg-white border border-solid border-gray-100 hover:border-teal/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                  onClick={() => { setCrawlId(run.crawl_id); navigate('crawl-results'); }}
                >
                  <span className="text-ink">{formatDate(run.created_at)}</span>
                  <span className="text-body text-xs">
                    {run.total_scanned ?? 0} scanned{run.total_failed ? `, ${run.total_failed} failed` : ''}
                  </span>
                  <StatusBadge status={RUN_STATUS_BADGE[run.status] || 'Needs review'} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-10 h-6 rounded-full border-0 p-0 transition-colors flex-shrink-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-2 ${checked ? 'bg-teal' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

const ICON_BTN = 'inline-flex items-center justify-center w-9 h-9 rounded-lg text-body border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40';

// "Weekly at 09:00" / "Runs daily at 09:00 UTC" — the schedule in plain words.
function describeSchedule(item) {
  if (item.schedule_type === 'cron') return cronToEnglish(item.cron_expression);
  const freq = FREQ_LABELS[item.frequency] || item.frequency;
  const t = item.time_of_day ? utcTimeToLocal(item.time_of_day) : null;
  if (item.frequency === 'hourly') return t ? `Every hour, at minute ${t.split(':')[1]}` : 'Every hour';
  return t ? `${freq} at ${t}` : freq;
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export default function CrawlSchedulesPage() {
  const { navigate, setCrawlId } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(true);

  // Search / filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Create / edit form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newFreq, setNewFreq] = useState('weekly');
  const [newTime, setNewTime] = useState('');
  const [newScheduleType, setNewScheduleType] = useState('simple');
  const [cronMin, setCronMin] = useState('*');
  const [cronHour, setCronHour] = useState('*');
  const [cronDom, setCronDom] = useState('*');
  const [cronMonth, setCronMonth] = useState('*');
  const [cronDow, setCronDow] = useState('*');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());

  // In-flight action trackers
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [stoppingId, setStoppingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadSchedules(); }, []);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  async function loadSchedules() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/crawl-schedules');
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setAvailable(data.available !== false);
      } else {
        setError(data.error || 'Failed to load schedules');
      }
    } catch (e) {
      setError(e.message || 'Network error');
    }
    setLoading(false);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setNewUrl('');
    setNewName('');
    setNewFreq('weekly');
    setNewTime('');
    setNewScheduleType('simple');
    setCronMin('*'); setCronHour('*'); setCronDom('*'); setCronMonth('*'); setCronDow('*');
    setCreateError('');
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(item) {
    setEditingId(item.id);
    setNewUrl(item.root_url);
    setNewName(item.name || '');
    setNewFreq(item.frequency === 'cron' ? 'weekly' : item.frequency);
    setNewTime(item.time_of_day ? utcTimeToLocal(item.time_of_day) : '');
    if (item.schedule_type === 'cron' && item.cron_expression) {
      setNewScheduleType('cron');
      const [min, hour, dom, month, dow] = item.cron_expression.trim().split(/\s+/);
      setCronMin(min || '*'); setCronHour(hour || '*'); setCronDom(dom || '*');
      setCronMonth(month || '*'); setCronDow(dow || '*');
    } else {
      setNewScheduleType('simple');
      setCronMin('*'); setCronHour('*'); setCronDom('*'); setCronMonth('*'); setCronDow('*');
    }
    setCreateError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!editingId && !url) { setCreateError('URL is required'); return; }
    setCreating(true);
    setCreateError('');
    const timeOfDayUtc = localTimeToUtc(newTime);
    const cronExpression = `${cronMin} ${cronHour} ${cronDom} ${cronMonth} ${cronDow}`;
    const body = newScheduleType === 'cron'
      ? { name: newName.trim(), scheduleType: 'cron', cronExpression }
      : { name: newName.trim(), scheduleType: 'simple', frequency: newFreq, timeOfDay: timeOfDayUtc };
    try {
      if (editingId) {
        const res = await apiFetch(`/api/crawl-schedules/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) { resetForm(); loadSchedules(); }
        else setCreateError(data.error || 'Failed to update schedule');
      } else {
        const res = await apiFetch('/api/crawl-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, ...body }),
        });
        const data = await res.json();
        if (data.ok) { resetForm(); loadSchedules(); }
        else setCreateError(data.error || 'Failed to create schedule');
      }
    } catch (e) {
      setCreateError(e.message);
    }
    setCreating(false);
  }

  async function handleToggle(item) {
    setTogglingId(item.id);
    setActionError('');
    try {
      const res = await apiFetch(`/api/crawl-schedules/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      const data = await res.json();
      if (data.ok) loadSchedules();
      else setActionError(data.error || 'Failed to update schedule');
    } catch (e) {
      setActionError(e.message || 'Network error');
    }
    setTogglingId(null);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this schedule?')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/crawl-schedules/${id}`, { method: 'DELETE' });
      loadSchedules();
    } catch {}
    setDeletingId(null);
  }

  async function handleRunNow(item) {
    setRunningId(item.id);
    setActionError('');
    try {
      const res = await apiFetch(`/api/crawl-schedules/${item.id}/run-now`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setCrawlId(data.crawl_id);
        navigate('crawl-results');
      } else {
        setActionError(data.error || 'Failed to start crawl');
      }
    } catch (e) {
      setActionError(e.message || 'Network error');
    }
    setRunningId(null);
  }

  async function handleStop(item) {
    setStoppingId(item.id);
    setActionError('');
    try {
      const res = await apiFetch(`/api/crawl-schedules/${item.id}/stop`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) loadSchedules();
      else setActionError(data.error || 'Failed to stop run');
    } catch (e) {
      setActionError(e.message || 'Network error');
    }
    setStoppingId(null);
  }

  const filteredItems = items.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${item.name || ''} ${item.root_url}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const activeCount = items.filter((i) => i.enabled).length;
  const runningCount = items.filter((i) => i.status === 'running').length;
  const attentionCount = items.filter((i) => i.last_run_status === 'failed' || i.last_run_status === 'cancelled').length;

  const filterCounts = {
    all: items.length,
    active: items.filter((i) => i.status === 'active').length,
    paused: items.filter((i) => i.status === 'paused').length,
    running: runningCount,
  };

  return (
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0" role="main">
      <div className="max-w-[1040px] mx-auto space-y-6">

        <PageHeader
          title="Crawl schedules"
          description="Check your sites for accessibility problems automatically, on a schedule you choose."
          actions={
            <button
              onClick={() => (showForm ? resetForm() : openCreateForm())}
              className="btn-primary flex items-center gap-2 shrink-0"
            >
              {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showForm ? 'Cancel' : 'New schedule'}
            </button>
          }
        />

        {/* KPIs */}
        {!loading && available && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Active schedules', hint: 'Running automatically', value: activeCount, icon: CalendarClock, tone: 'bg-teal/10 text-teal' },
              { title: 'Running now', hint: 'Crawls in progress', value: runningCount, icon: Radio, tone: 'bg-brand-blue/10 text-brand-blue-700' },
              { title: 'Needs attention', hint: 'Last run failed', value: attentionCount, icon: AlertTriangle, tone: attentionCount > 0 ? 'bg-coral/10 text-coral-700' : 'bg-sage/10 text-sage-700' },
            ].map(({ title, hint, value, icon: Icon, tone }) => (
              <div key={title} className="card p-5 flex items-center gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${tone}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-heading text-2xl font-bold text-ink leading-none m-0 tabular-nums">{value}</p>
                  <p className="text-sm font-medium text-ink mt-1.5 mb-0">{title}</p>
                  <p className="text-xs text-body mt-0.5 mb-0">{hint}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / edit form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="card p-6 space-y-5 !border-teal/30">
            <div>
              <h2 className="font-heading font-semibold text-base text-ink m-0">
                {editingId ? 'Edit schedule' : 'New schedule'}
              </h2>
              <p className="text-xs text-body mt-1 mb-0">
                {editingId ? 'Change when this site is checked.' : 'Pick a site and how often it should be checked.'}
              </p>
            </div>
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-ink mb-1.5">Website to crawl</label>
                <GlowInput
                  type="url"
                  placeholder="https://example.com"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  disabled={!!editingId}
                  required
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold text-ink mb-1.5">
                  Name <span className="font-normal text-body">(optional)</span>
                </label>
                <GlowInput
                  type="text"
                  placeholder="e.g. Marketing site — weekly"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1.5">How often?</label>
              <div role="tablist" aria-label="Schedule type" className="inline-flex rounded-lg border border-solid border-gray-200 bg-gray-50 p-1 gap-1 mb-3">
                {[['simple', 'Simple'], ['cron', 'Advanced (cron)']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="tab"
                    aria-selected={newScheduleType === val}
                    onClick={() => setNewScheduleType(val)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold border-0 cursor-pointer transition-colors ${
                      newScheduleType === val ? 'bg-white text-teal shadow-sm' : 'bg-transparent text-body hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {newScheduleType === 'simple' ? (
                <div className="flex gap-4 flex-wrap items-end">
                  <div className="flex gap-2 flex-wrap">
                    {FREQ_OPTIONS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setNewFreq(f)}
                        aria-pressed={newFreq === f}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold border border-solid cursor-pointer transition-colors ${
                          newFreq === f ? 'bg-teal text-white border-teal' : 'bg-white text-body border-gray-200 hover:border-teal/50'
                        }`}
                      >
                        {FREQ_LABELS[f]}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink mb-1.5">
                      {newFreq === 'hourly' ? 'At minute' : 'Time of day'} <span className="font-normal text-body">(optional)</span>
                    </label>
                    <input type="time" className="input-base h-10 text-sm" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 flex-wrap items-end">
                  {[
                    ['Minute', cronMin, setCronMin],
                    ['Hour (UTC)', cronHour, setCronHour],
                    ['Day', cronDom, setCronDom],
                    ['Month', cronMonth, setCronMonth],
                    ['Weekday', cronDow, setCronDow],
                  ].map(([label, val, setVal]) => (
                    <div key={label} className="w-20">
                      <label className="block text-xs font-semibold text-ink mb-1.5">{label}</label>
                      <input
                        type="text"
                        className="input-base h-10 text-sm text-center font-mono"
                        value={val}
                        onChange={(e) => setVal(e.target.value.trim() || '*')}
                      />
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 mb-0 inline-flex items-center gap-2 text-sm text-teal-800 bg-teal/10 rounded-lg px-3 py-2">
                <Clock size={14} className="flex-shrink-0" />
                {newScheduleType === 'cron'
                  ? `${cronToEnglish(`${cronMin} ${cronHour} ${cronDom} ${cronMonth} ${cronDow}`)} (times are UTC)`
                  : describeSchedule({ schedule_type: 'simple', frequency: newFreq, time_of_day: newTime ? localTimeToUtc(newTime) : null })}
              </p>
            </div>

            {createError && <p role="alert" className="text-sm text-coral-700 m-0">{createError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={creating} className="btn-primary flex items-center gap-2 text-sm py-2 px-4">
                {creating ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {creating ? 'Saving…' : editingId ? 'Save changes' : 'Create schedule'}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary text-sm py-2 px-4">Cancel</button>
            </div>
          </form>
        )}

        {actionError && (
          <p role="alert" className="text-sm text-coral-700 bg-coral/10 px-4 py-3 rounded-xl border border-solid border-coral/30 m-0">
            {actionError}
          </p>
        )}

        {/* Search / filter */}
        {!loading && available && items.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[220px] max-w-xs">
              <GlowInput icon={Search} type="text" placeholder="Search by name or URL…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2 flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize border border-solid cursor-pointer transition-colors ${
                    statusFilter === f ? 'bg-teal text-white border-teal' : 'bg-white border-gray-200 text-body hover:text-ink'
                  }`}
                >
                  {f} · {filterCounts[f]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="space-y-3" role="status" aria-label="Loading schedules">
            {[1, 2].map((i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-coral-700 bg-coral/10 px-4 py-3 rounded-xl border border-solid border-coral/30 m-0">{error}</p>
        )}

        {!loading && !error && !available && (
          <p className="text-sm text-body bg-teal/10 px-4 py-3 rounded-xl border border-solid border-teal/30 m-0">
            Database not configured — schedules require MSSQL to persist.
          </p>
        )}

        {!loading && !error && available && items.length === 0 && !showForm && (
          <div className="card p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-4">
              <CalendarClock className="w-7 h-7 text-teal" />
            </div>
            <h2 className="font-heading font-semibold text-lg text-ink m-0">No schedules yet</h2>
            <p className="text-sm text-body mt-1 mb-5 max-w-sm mx-auto">
              Set up a schedule and we&apos;ll crawl your site for accessibility issues automatically, then alert you to changes.
            </p>
            <button onClick={openCreateForm} className="btn-primary">
              <Plus className="w-4 h-4" /> Create your first schedule
            </button>
          </div>
        )}

        {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-body text-center py-10 m-0">No schedules match your search or filter.</p>
        )}

        {/* Schedule cards */}
        {!loading && !error && filteredItems.length > 0 && (
          <ul className="space-y-3 list-none p-0 m-0">
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id;
              const isRunning = item.status === 'running';
              const label = item.name || domainOf(item.root_url);
              const failed = item.last_run_status === 'failed' || item.last_run_status === 'cancelled';
              return (
                <li key={item.id} className={`card overflow-hidden ${item.enabled ? '' : 'opacity-75'}`}>
                  <div className="p-5 flex flex-wrap items-start gap-x-6 gap-y-4">
                    <div className="flex items-start gap-4 flex-1 min-w-[260px]">
                      <span className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${isRunning ? 'bg-brand-blue/10 text-brand-blue-700' : failed ? 'bg-coral/10 text-coral-700' : 'bg-teal/10 text-teal'}`}>
                        {isRunning ? <Radio size={20} className="animate-pulse" /> : failed ? <AlertTriangle size={20} /> : <CalendarClock size={20} />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-heading font-semibold text-ink text-base m-0 truncate max-w-[280px]" title={label}>{label}</h3>
                          <ScheduleStatusBadge status={item.status} />
                        </div>
                        <a href={item.root_url} target="_blank" rel="noreferrer" title={item.root_url}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-teal hover:underline max-w-full">
                          <span className="truncate">{item.root_url}</span>
                          <ExternalLink size={11} className="flex-shrink-0" aria-label="opens in new tab" />
                        </a>
                        <p className="mt-2 mb-0 text-sm text-ink inline-flex items-center gap-1.5">
                          <Clock size={13} className="text-body flex-shrink-0" /> {describeSchedule(item)}
                        </p>
                      </div>
                    </div>

                    <dl className="flex gap-8 m-0 text-sm">
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-body">Next run</dt>
                        <dd className="m-0 mt-1">
                          {item.enabled && item.next_run_at ? (
                            <>
                              <span className="block font-semibold text-ink">in {timeUntil(item.next_run_at, nowTick)}</span>
                              <span className="block text-xs text-body">{formatDate(item.next_run_at)}</span>
                            </>
                          ) : <span className="text-body">Paused</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-body">Last result</dt>
                        <dd className="m-0 mt-1">
                          {item.last_run_status ? (
                            <>
                              <StatusBadge status={RUN_STATUS_BADGE[item.last_run_status] || item.last_run_status} />
                              <span className="block text-xs text-body mt-1">{formatDate(item.last_run_at)}</span>
                            </>
                          ) : <span className="text-body">Not run yet</span>}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex items-center gap-2 ml-auto">
                      {isRunning ? (
                        <button
                          onClick={() => handleStop(item)}
                          disabled={stoppingId === item.id}
                          aria-label={`Stop the running crawl for ${label}`}
                          className="btn-secondary !py-2 text-sm"
                        >
                          {stoppingId === item.id ? <RefreshCw size={14} className="animate-spin" /> : <Square size={14} />} Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRunNow(item)}
                          disabled={runningId === item.id}
                          aria-label={`Run ${label} now`}
                          className="btn-secondary !py-2 text-sm !text-teal"
                        >
                          {runningId === item.id ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Run now
                        </button>
                      )}
                      <Switch
                        checked={!!item.enabled}
                        onChange={() => handleToggle(item)}
                        disabled={togglingId === item.id}
                        label={`${item.enabled ? 'Pause' : 'Resume'} ${label}`}
                      />
                      <button title="Edit schedule" aria-label={`Edit ${label}`} onClick={() => openEditForm(item)} className={`${ICON_BTN} hover:text-teal hover:bg-teal/10`}>
                        <Pencil size={16} />
                      </button>
                      <button title="Delete schedule" aria-label={`Delete ${label}`} onClick={() => handleDelete(item.id)} disabled={deletingId === item.id} className={`${ICON_BTN} hover:text-coral hover:bg-coral/10`}>
                        {deletingId === item.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    aria-expanded={isExpanded}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-body hover:text-teal bg-gray-50/70 border-0 border-t border-solid border-gray-100 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/40"
                  >
                    <History size={13} /> {isExpanded ? 'Hide recent runs' : 'Show recent runs'}
                    <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {isExpanded && <RunHistoryRow scheduleId={item.id} />}
                </li>
              );
            })}
          </ul>
        )}

        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">How scheduling works</summary>
          <ul className="mt-3 mb-0 space-y-1.5 text-body text-xs pl-4">
            <li>The scheduler checks every minute for due schedules and starts them at the time you set.</li>
            <li>If a crawl for the same site is already running, that trigger is skipped and the next run is rescheduled.</li>
            <li>&ldquo;Run now&rdquo; starts a crawl immediately without changing the next automatic run.</li>
          </ul>
        </details>

      </div>
    </main>
  );
}
