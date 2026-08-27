import { apiFetch } from '../utils/api';
import { useState, useEffect, Fragment } from 'react';
import {
  CalendarClock, Plus, Trash2, Play, Pause, RefreshCw, Zap, Square,
  Pencil, ChevronDown, ChevronRight, Search, AlertTriangle, Radio,
} from 'lucide-react';
import GlowInput from '../components/ui/GlowInput';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useApp } from '../context/AppContext';

const FREQ_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const FREQ_OPTIONS = ['daily', 'weekly', 'monthly'];
const STATUS_FILTERS = ['all', 'active', 'paused', 'running'];

const RUN_STATUS_BADGE = {
  completed: 'Passed',
  failed: 'Failed',
  cancelled: 'Failed',
  running: 'Running',
  pending: 'Running',
};

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
    daily:   'bg-teal/10 text-teal',
    weekly:  'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    monthly: 'bg-amber/10 text-amber',
  }[freq] || 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400';
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
    <span className={`text-xs font-semibold ${status === 'active' ? 'text-sage' : 'text-body dark:text-gray-500'}`}>
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
    <tr className="bg-gray-50 dark:bg-white/[0.02]">
      <td colSpan={7} className="px-4 py-3">
        {runs === null && !error && (
          <p className="text-xs text-body dark:text-gray-400">Loading run history…</p>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
        {runs && runs.length === 0 && (
          <p className="text-xs text-body dark:text-gray-400">No runs recorded for this schedule yet.</p>
        )}
        {runs && runs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-body dark:text-gray-500 mb-1">
              Recent runs
            </p>
            {runs.map((run) => (
              <div
                key={run.crawl_id}
                className="flex items-center justify-between gap-3 text-xs cursor-pointer hover:text-teal transition-colors"
                onClick={() => { setCrawlId(run.crawl_id); navigate('crawl-results'); }}
              >
                <span className="text-body dark:text-gray-400">{formatDate(run.created_at)}</span>
                <span className="text-body dark:text-gray-500">
                  {run.total_scanned ?? 0} scanned{run.total_failed ? `, ${run.total_failed} failed` : ''}
                </span>
                <StatusBadge status={RUN_STATUS_BADGE[run.status] || 'Needs review'} />
              </div>
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // In-flight action trackers
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [stoppingId, setStoppingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadSchedules(); }, []);

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
    setNewFreq(item.frequency);
    setNewTime(item.time_of_day || '');
    setCreateError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!editingId && !url) { setCreateError('URL is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      if (editingId) {
        const res = await apiFetch(`/api/crawl-schedules/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), frequency: newFreq, timeOfDay: newTime }),
        });
        const data = await res.json();
        if (data.ok) { resetForm(); loadSchedules(); }
        else setCreateError(data.error || 'Failed to update schedule');
      } else {
        const res = await apiFetch('/api/crawl-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: newName.trim(), frequency: newFreq, timeOfDay: newTime }),
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
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[1040px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">
              Crawl Schedules
            </h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Automatically run site crawls on a recurring schedule. Duplicate crawls for the same URL are skipped.
            </p>
          </div>
          <button
            onClick={() => (showForm ? resetForm() : openCreateForm())}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            {showForm ? 'Cancel' : 'New Schedule'}
          </button>
        </div>

        {/* KPIs */}
        {!loading && available && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard title="Active Schedules" value={activeCount} icon={CalendarClock} color="teal" />
            <MetricCard title="Running Now" value={runningCount} icon={Radio} color="sage" />
            <MetricCard title="Needs Attention" value={attentionCount} icon={AlertTriangle} color={attentionCount ? 'coral' : 'sage'} />
          </div>
        )}

        {/* Create / edit form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-charcoal border border-teal/20 rounded-2xl shadow-soft p-5 space-y-4"
          >
            <p className="font-heading font-semibold text-sm text-ink dark:text-white">
              {editingId ? 'Edit Crawl Schedule' : 'New Crawl Schedule'}
            </p>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
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
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
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
            <div className="flex gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
                  Frequency
                </label>
                <select
                  className="h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  value={newFreq}
                  onChange={(e) => setNewFreq(e.target.value)}
                >
                  {FREQ_OPTIONS.map((f) => (
                    <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
                  Time of day <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="time"
                  className="h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                />
              </div>
            </div>
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
                {creating ? 'Saving…' : editingId ? 'Save Changes' : 'Create Schedule'}
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
                      : 'bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'
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
              <div key={i} className="h-16 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">
            {error}
          </p>
        )}

        {!loading && !error && !available && (
          <p className="text-sm text-body dark:text-gray-400 bg-teal/10 px-4 py-3 rounded-xl border border-teal">
            Database not configured — schedules require MSSQL to persist.
          </p>
        )}

        {!loading && !error && available && items.length === 0 && !showForm && (
          <div className="mt-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center">
              <CalendarClock className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">No schedules yet</p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs leading-relaxed">
              Create a schedule to automatically crawl a site daily, weekly, or monthly.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-body dark:text-gray-400 text-center py-10">
            No schedules match your search or filter.
          </p>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <div className="bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-night border-b border-gray-100 dark:border-white/[0.06]">
                  <tr>
                    {['', 'Site', 'Frequency', 'Status', 'Last Run', 'Next Run', ''].map((h, i) => (
                      <th key={i} className="py-3 px-4 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
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
                          className={`border-b border-gray-100 dark:border-white/[0.06] last:border-b-0 transition-colors ${
                            item.enabled ? '' : 'opacity-60'
                          }`}
                        >
                          <td className="py-3 px-2">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}
                              className="p-1 rounded text-body dark:text-gray-400 hover:text-teal"
                              title="Toggle run history"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="py-3 px-4 max-w-[240px]">
                            {item.name && (
                              <span className="block truncate text-sm font-semibold text-ink dark:text-white" title={item.name}>
                                {item.name}
                              </span>
                            )}
                            <span className="block truncate text-teal text-xs font-medium" title={item.root_url}>
                              {item.root_url}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <FrequencyBadge freq={item.frequency} />
                            {item.time_of_day && (
                              <span className="block text-[10px] text-body dark:text-gray-500 mt-1">at {item.time_of_day}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <ScheduleStatusBadge status={item.status} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              className="text-xs text-body dark:text-gray-400 hover:text-teal transition-colors text-left disabled:hover:text-body"
                              disabled={!item.last_run_crawl_id}
                              onClick={() => { setCrawlId(item.last_run_crawl_id); navigate('crawl-results'); }}
                            >
                              {formatDate(item.last_run_at)}
                            </button>
                            {item.last_run_status && (
                              <div className="mt-1">
                                <StatusBadge status={RUN_STATUS_BADGE[item.last_run_status] || 'Needs review'} />
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs text-body dark:text-gray-400">
                            {item.enabled ? formatDate(item.next_run_at) : '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isRunning ? (
                                <button
                                  title="Stop this run"
                                  onClick={() => handleStop(item)}
                                  disabled={stoppingId === item.id}
                                  className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors disabled:opacity-40"
                                >
                                  {stoppingId === item.id
                                    ? <RefreshCw size={14} className="animate-spin" />
                                    : <Square size={14} />}
                                </button>
                              ) : (
                                <button
                                  title="Run now"
                                  onClick={() => handleRunNow(item)}
                                  disabled={runningId === item.id}
                                  className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40"
                                >
                                  {runningId === item.id
                                    ? <RefreshCw size={14} className="animate-spin" />
                                    : <Zap size={14} />}
                                </button>
                              )}
                              <button
                                title="Edit schedule"
                                onClick={() => openEditForm(item)}
                                className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                title={item.enabled ? 'Pause schedule' : 'Resume schedule'}
                                onClick={() => handleToggle(item)}
                                disabled={togglingId === item.id}
                                className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40"
                              >
                                {togglingId === item.id
                                  ? <RefreshCw size={14} className="animate-spin" />
                                  : item.enabled
                                  ? <Pause size={14} />
                                  : <Play size={14} />
                                }
                              </button>
                              <button
                                title="Delete schedule"
                                onClick={() => handleDelete(item.id)}
                                disabled={deletingId === item.id}
                                className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors disabled:opacity-40"
                              >
                                {deletingId === item.id
                                  ? <RefreshCw size={14} className="animate-spin" />
                                  : <Trash2 size={14} />
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
        <div className="text-xs text-body dark:text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-xl p-4 space-y-1">
          <p className="font-semibold text-ink dark:text-gray-300">How scheduling works</p>
          <p>The scheduler checks every minute for due schedules, firing at the optional time of day you set.</p>
          <p>If a crawl for the same URL is already running, the scheduled trigger is skipped and the next run time advances.</p>
          <p>"Run Now" starts an immediate crawl without changing the schedule's next automatic run.</p>
        </div>

      </div>
    </main>
  );
}
