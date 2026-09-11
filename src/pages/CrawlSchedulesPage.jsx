import { apiFetch } from '../utils/api';
import { useState, useEffect, Fragment } from 'react';
import {
  CalendarClock, Plus, Trash2, Play, RefreshCw, Square,
  Pencil, ChevronDown, ChevronRight, Search, AlertTriangle, Radio,
  ToggleLeft, ToggleRight, ExternalLink,
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
    <tr className="bg-gray-50">
      <td colSpan={9} className="px-4 py-3">
        {runs === null && !error && (
          <p className="text-xs text-body">Loading run history…</p>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
        {runs && runs.length === 0 && (
          <p className="text-xs text-body">No runs recorded for this schedule yet.</p>
        )}
        {runs && runs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-body mb-1">
              Recent runs
            </p>
            {runs.map((run) => (
              <button
                type="button"
                key={run.crawl_id}
                className="w-full flex items-center justify-between gap-3 text-xs text-left hover:text-teal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 rounded px-1 py-0.5"
                onClick={() => { setCrawlId(run.crawl_id); navigate('crawl-results'); }}
              >
                <span className="text-body">{formatDate(run.created_at)}</span>
                <span className="text-body">
                  {run.total_scanned ?? 0} scanned{run.total_failed ? `, ${run.total_failed} failed` : ''}
                </span>
                <StatusBadge status={RUN_STATUS_BADGE[run.status] || 'Needs review'} />
              </button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
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
    try {
      await apiFetch(`/api/crawl-schedules/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      loadSchedules();
    } catch {}
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

  return (
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0"role="main">
      <div className="max-w-[1040px] mx-auto space-y-6">

        <PageHeader
          title="Crawl schedules"
          description="Keep accessibility monitoring running automatically"
          actions={
            <button
              onClick={() => (showForm ? resetForm() : openCreateForm())}
              className="btn-primary flex items-center gap-2 shrink-0"
            >
              {showForm ? <Plus className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
              {showForm ? 'Cancel' : 'Create schedule'}
            </button>
          }
        />

        {/* KPIs */}
        {!loading && available && items.length > 0 && (
          <div className="card p-5">
            <div className="flex flex-col divide-y divide-gray-100 sm:flex-row sm:divide-y-0 sm:divide-x">
              {[
                { title: 'Active schedules', value: activeCount, icon: CalendarClock },
                { title: 'Pages monitored', value: runningCount, icon: Radio },
                { title: 'Issues found this week', value: attentionCount, icon: AlertTriangle },
              ].map(({ title, value, icon: Icon }) => (
                <div key={title} className="flex flex-1 items-center gap-3 py-3 first:pt-0 last:pb-0 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                  <div className="w-10 h-10 rounded-xl bg-ivory flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-teal" />
                  </div>
                  <div>
                    <p className="text-sm text-body">{title}</p>
                    <p className="text-2xl font-bold font-heading text-ink mt-0.5">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create / edit form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-teal/20 rounded-2xl p-5 space-y-4"
          >
            <p className="font-heading font-semibold text-sm text-ink">
              {editingId ? 'Edit Crawl Schedule' : 'New Crawl Schedule'}
            </p>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-body mb-1">
                  Root URL
                </label>
                <GlowInput
                  type="url"
                  placeholder="https://example.com"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  disabled={!!editingId}
                  required
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-semibold text-body mb-1">
                  Name <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <GlowInput
                  type="text"
                  placeholder="e.g. Homepage — weekly"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-body mb-1">
                Schedule Type
              </label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 gap-1">
                {[['simple', 'Simple Time'], ['cron', 'Cron Expression']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setNewScheduleType(val)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      newScheduleType === val ? 'bg-white text-teal shadow-sm' : 'text-body hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {newScheduleType === 'simple' ? (
              <div className="flex gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-semibold text-body mb-1">
                    Frequency
                  </label>
                  <select
                    className="select-base h-10 text-sm"
                    value={newFreq}
                    onChange={(e) => setNewFreq(e.target.value)}
                  >
                    {FREQ_OPTIONS.map((f) => (
                      <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-body mb-1">
                    {newFreq === 'hourly' ? 'Run at minute' : 'Time of day'} <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="time"
                    className="input-base h-10 text-sm"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-3 flex-wrap items-end">
                  {[
                    ['Minute', cronMin, setCronMin],
                    ['Hour (UTC)', cronHour, setCronHour],
                    ['Day', cronDom, setCronDom],
                    ['Month', cronMonth, setCronMonth],
                    ['Weekday', cronDow, setCronDow],
                  ].map(([label, val, setVal]) => (
                    <div key={label} className="w-20">
                      <label className="block text-xs font-semibold text-body mb-1">{label}</label>
                      <input
                        type="text"
                        className="input-base h-10 text-sm text-center font-mono"
                        value={val}
                        onChange={(e) => setVal(e.target.value.trim() || '*')}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-body">
                  {cronToEnglish(`${cronMin} ${cronHour} ${cronDom} ${cronMonth} ${cronDow}`)} — times are UTC.
                </p>
              </div>
            )}
            {newScheduleType === 'simple' && newFreq === 'hourly' && (
              <p className="text-[11px] text-body -mt-2">
                {newTime ? `Runs every hour, at minute ${newTime.split(':')[1]}.` : 'Runs once every hour from whenever this schedule is created.'}
              </p>
            )}
            {createError && (
              <p className="text-xs text-coral">{createError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="btn-primary flex items-center gap-2 text-sm py-2 px-4"
              >
                {creating ? <RefreshCw size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                {creating ? 'Saving…' : editingId ? 'Save Changes' : 'Create schedule'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary text-sm py-2 px-4"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {actionError && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">
            {actionError}
          </p>
        )}

        {/* Search / filter */}
        {!loading && available && items.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[220px] max-w-xs">
              <GlowInput
                icon={Search}
                type="text"
                placeholder="Search by name or URL…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
                    statusFilter === f
                      ? 'bg-teal text-white'
                      :'bg-white border border-gray-200 text-body hover:text-ink'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse"/>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">
            {error}
          </p>
        )}

        {!loading && !error && !available && (
          <p className="text-sm text-body bg-teal/10 px-4 py-3 rounded-xl border border-teal">
            Database not configured — schedules require MSSQL to persist.
          </p>
        )}

        {!loading && !error && available && items.length === 0 && !showForm && (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center flex flex-col items-center gap-3 mt-8">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center">
              <CalendarClock className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink">No additional schedules yet</p>
            <p className="text-sm text-body max-w-xs leading-relaxed">
              Create a schedule to keep your sites monitored automatically.
            </p>
            <button
              onClick={openCreateForm}
              className="btn-primary flex items-center gap-2 mt-1"
            >
              <CalendarClock className="w-4 h-4" />
              Create schedule
            </button>
          </div>
        )}

        {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-body text-center py-10">
            No schedules match your search or filter.
          </p>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-teal/10 border-b-2 border-teal/25">
                  <tr>
                    {['', 'Schedule', 'URL', 'Frequency', 'Next Run', 'Status', 'Run Now', 'Enable', 'Edit'].map((h, i) => (
                      <th key={i} className="py-3 px-4 text-left text-xs font-bold text-teal-800 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isExpanded = expandedId === item.id;
                    const isRunning = item.status === 'running';
                    return (
                      <Fragment key={item.id}>
                        <tr
                          className={`border-b border-gray-100 last:border-b-0 transition-colors ${
                            item.enabled ? '' : 'opacity-60'
                          }`}
                        >
                          <td className="py-3 px-2">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}
                              className="p-1 rounded text-body hover:text-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                              aria-label={isExpanded ? `Hide run history for ${item.name || item.root_url}` : `Show run history for ${item.name || item.root_url}`}
                              aria-expanded={isExpanded}
                              title="Toggle run history"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="py-3 px-4 max-w-[200px]">
                            {item.name ? (
                              <span className="block truncate text-sm font-semibold text-ink" title={item.name}>
                                {item.name}
                              </span>
                            ) : (
                              <span className="text-sm text-body">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 max-w-[200px]">
                            <span className="flex items-center gap-1 min-w-0" title={item.root_url}>
                              <span className="truncate min-w-0 flex-1 text-teal text-xs font-medium">{item.root_url}</span>
                              <ExternalLink size={11} className="flex-shrink-0 text-teal" />
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {item.schedule_type === 'cron' ? (
                              <span
                                className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-600 font-mono"
                                title={cronToEnglish(item.cron_expression)}
                              >
                                {item.cron_expression}
                              </span>
                            ) : (
                              <FrequencyBadge freq={item.frequency} />
                            )}
                            {item.schedule_type !== 'cron' && item.time_of_day && (
                              <span className="block text-[10px] text-body mt-1">at {utcTimeToLocal(item.time_of_day)}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs">
                            {item.enabled ? (
                              <>
                                <span className="block font-semibold text-ink">{timeUntil(item.next_run_at, nowTick)}</span>
                                <span className="block text-[10px] text-body">{formatDate(item.next_run_at)}</span>
                              </>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <ScheduleStatusBadge status={item.status} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {isRunning ? (
                              <button
                                title="Stop this run"
                                aria-label={`Stop the running crawl for ${item.name || item.root_url}`}
                                onClick={() => handleStop(item)}
                                disabled={stoppingId === item.id}
                                className="p-2.5 rounded-lg border border-gray-300 bg-gray-50 shadow-sm text-body hover:text-amber hover:border-amber/40 hover:bg-amber/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/40"
                              >
                                {stoppingId === item.id
                                  ? <RefreshCw size={20} className="animate-spin" />
                                  : <Square size={20} />}
                              </button>
                            ) : (
                              <button
                                title="Run now"
                                aria-label={`Run ${item.name || item.root_url} now`}
                                onClick={() => handleRunNow(item)}
                                disabled={runningId === item.id}
                                className="p-2.5 rounded-lg border border-gray-300 bg-gray-50 shadow-sm text-teal hover:border-teal/40 hover:bg-teal/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                              >
                                {runningId === item.id
                                  ? <RefreshCw size={20} className="animate-spin" />
                                  : <Play size={20} />}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              title={item.enabled ? 'Pause schedule' : 'Resume schedule'}
                              aria-label={`${item.enabled ? 'Pause' : 'Resume'} ${item.name || item.root_url}`}
                              onClick={() => handleToggle(item)}
                              disabled={togglingId === item.id}
                              className="p-2.5 rounded-lg border border-gray-300 bg-gray-50 shadow-sm text-body hover:text-teal hover:border-teal/40 hover:bg-teal/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              {togglingId === item.id
                                ? <RefreshCw size={20} className="animate-spin" />
                                : item.enabled
                                ? <ToggleRight size={20} />
                                : <ToggleLeft size={20} />
                              }
                            </button>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <button
                                title="Edit schedule"
                                aria-label={`Edit ${item.name || item.root_url}`}
                                onClick={() => openEditForm(item)}
                                className="p-2.5 rounded-lg border border-gray-300 bg-gray-50 shadow-sm text-body hover:text-teal hover:border-teal/40 hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                              >
                                <Pencil size={20} />
                              </button>
                              <button
                                title="Delete schedule"
                                aria-label={`Delete ${item.name || item.root_url}`}
                                onClick={() => handleDelete(item.id)}
                                disabled={deletingId === item.id}
                                className="p-2.5 rounded-lg border border-gray-300 bg-gray-50 shadow-sm text-body hover:text-coral hover:border-coral/40 hover:bg-coral/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
                              >
                                {deletingId === item.id
                                  ? <RefreshCw size={20} className="animate-spin" />
                                  : <Trash2 size={20} />
                                }
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && <RunHistoryRow scheduleId={item.id} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="text-xs text-body bg-gray-50 rounded-xl p-4 space-y-1">
          <p className="font-semibold text-ink">How scheduling works</p>
          <p>The scheduler checks every minute for due schedules, firing at the optional time of day you set.</p>
          <p>If a crawl for the same URL is already running, the scheduled trigger is skipped and the next run time advances.</p>
          <p>"Run Now" starts an immediate crawl without changing the schedule's next automatic run.</p>
        </div>

      </div>
    </main>
  );
}
