import { apiFetch } from '../utils/api';
import { useState, useEffect, useMemo } from 'react';
import { BellRing, CheckCheck, TrendingDown, AlertTriangle, ShieldAlert, BarChart2, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

const ALERT_META = {
  score_decrease:       { label: 'Score Decrease',       icon: TrendingDown,  color: 'text-coral',  bg: 'bg-coral/10'  },
  violation_increase:   { label: 'Violation Increase',   icon: BarChart2,     color: 'text-amber',  bg: 'bg-amber/10'  },
  critical_introduced:  { label: 'Critical Introduced',  icon: ShieldAlert,   color: 'text-coral',  bg: 'bg-coral/10'  },
  regression_detected:  { label: 'Regression Detected',  icon: AlertTriangle, color: 'text-amber',  bg: 'bg-amber/10'  },
};

const LEFT_BAR = {
  critical: 'border-l-coral',
  serious:  'border-l-amber',
  moderate: 'border-l-blue-400 dark:border-l-blue-500',
  info:     'border-l-teal',
};

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'critical', label: 'Critical' },
];

function SeverityChip({ severity }) {
  const cls = {
    critical: 'bg-coral/10 text-coral-700 dark:text-coral-300',
    serious:  'bg-amber/10 text-amber-700 dark:text-amber-300',
    moderate: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    info:     'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400',
  }[severity] || 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400';
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {severity?.charAt(0).toUpperCase() + severity?.slice(1)}
    </span>
  );
}

function AlertCard({ alert, onAcknowledge, onViewResults, acknowledging }) {
  const meta = ALERT_META[alert.alert_type] || { label: alert.alert_type, icon: AlertTriangle, color: 'text-body', bg: 'bg-gray-100' };
  const Icon = meta.icon;
  const isActive = alert.status === 'active';
  const details = alert.details || {};
  const leftBar = LEFT_BAR[alert.severity] || 'border-l-gray-200 dark:border-l-white/10';

  return (
    <div className={`bg-white dark:bg-charcoal rounded-xl border border-l-4 shadow-soft transition-opacity ${leftBar} ${
      isActive
        ? 'border-gray-100 dark:border-white/[0.06]'
        : 'border-gray-100 dark:border-white/[0.04] opacity-60'
    }`}>
      <div className="px-5 py-4 flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
          <Icon size={15} className={meta.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="font-semibold text-sm text-ink dark:text-white">{meta.label}</p>
              <p className="text-xs text-body dark:text-gray-400 truncate mt-0.5" title={alert.root_url}>
                {alert.root_url || '—'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <SeverityChip severity={alert.severity} />
              {!isActive && (
                <span className="text-xs text-body dark:text-gray-500">Read</span>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-body dark:text-gray-400">
            {details.previous_score != null && details.current_score != null && (
              <span>Score: {details.previous_score} → <strong className="text-coral">{details.current_score}</strong></span>
            )}
            {details.previous_violations != null && details.current_violations != null && (
              <span>Violations: {details.previous_violations} → <strong className="text-coral">{details.current_violations}</strong></span>
            )}
            {details.new_critical != null && (
              <span><strong className="text-coral">{details.new_critical}</strong> new critical issue(s)</span>
            )}
            {details.regressed_page_count != null && (
              <span><strong>{details.regressed_page_count}</strong> page(s) regressed</span>
            )}
            {details.drop != null && (
              <span>Dropped by <strong className="text-coral">{details.drop}</strong> pts</span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[10px] text-body dark:text-gray-500" title={formatDate(alert.created_at)}>
              {isToday(alert.created_at) ? formatTime(alert.created_at) : formatDate(alert.created_at)}
            </span>
            <div className="flex items-center gap-4">
              {alert.crawl_id && (
                <button
                  type="button"
                  onClick={() => onViewResults(alert.crawl_id)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-teal hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                >
                  View results <ArrowRight size={12} />
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={() => onAcknowledge(alert.id)}
                  disabled={acknowledging === alert.id}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-body dark:text-gray-400 hover:text-teal transition-colors disabled:opacity-40"
                >
                  <CheckCheck size={13} />
                  {acknowledging === alert.id ? 'Marking…' : 'Mark as read'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertGroup({ title, items, onAcknowledge, onViewResults, acknowledging }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-body dark:text-gray-500">{title}</h2>
      <div className="space-y-3">
        {items.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onAcknowledge={onAcknowledge}
            onViewResults={onViewResults}
            acknowledging={acknowledging}
          />
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { navigate, setCrawlId } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(true);
  const [filter, setFilter] = useState('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const [acknowledging, setAcknowledging] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [integrations, setIntegrations] = useState([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);

  useEffect(() => { loadAlerts(filter); }, [filter]);

  useEffect(() => {
    apiFetch('/api/integrations')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setIntegrations(d.integrations || []); })
      .catch(() => {})
      .finally(() => setIntegrationsLoading(false));
  }, []);

  async function loadAlerts(tab) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (tab === 'unread') params.set('status', 'active');
      const res = await apiFetch(`/api/alerts?${params}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setUnreadCount(data.unread_count ?? 0);
        setAvailable(data.available !== false);
      } else {
        setError(data.error || 'Failed to load notifications');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleAcknowledge(id) {
    setAcknowledging(id);
    try {
      await apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PATCH' });
      loadAlerts(filter);
    } catch {}
    setAcknowledging(null);
  }

  async function handleMarkAllRead() {
    const activeIds = items.filter((a) => a.status === 'active').map((a) => a.id);
    if (activeIds.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(activeIds.map((id) => apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PATCH' })));
      loadAlerts(filter);
    } catch {}
    setMarkingAll(false);
  }

  function handleViewResults(crawlId) {
    setCrawlId(crawlId);
    navigate('crawl-results');
  }

  const displayedItems = useMemo(() => {
    let list = [...items];
    if (filter === 'critical') list = list.filter((a) => a.severity === 'critical');
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [items, filter]);

  const todayItems = displayedItems.filter((a) => isToday(a.created_at));
  const earlierItems = displayedItems.filter((a) => !isToday(a.created_at));
  const hasUnreadInView = items.some((a) => a.status === 'active');

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-6xl mx-auto space-y-6">

        <div>
          <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">
            Notifications
          </h1>
          <p className="text-body dark:text-gray-400 text-[0.9375rem]">
            Stay informed about accessibility changes that need attention.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0 w-full space-y-6">

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div role="tablist" aria-label="Notification filter" className="flex gap-1 bg-gray-100 dark:bg-white/5 p-1 rounded-xl">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === t.id}
                    onClick={() => setFilter(t.id)}
                    className={filter === t.id ? 'tab-active' : 'tab'}
                  >
                    {t.label}
                    {t.id === 'unread' && unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-coral text-white text-[10px] font-bold">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markingAll || !hasUnreadInView}
                className="btn-secondary text-xs py-2"
              >
                <CheckCheck size={14} />
                {markingAll ? 'Marking…' : 'Mark all as read'}
              </button>
            </div>

            {!available && !loading && (
              <div className="alert-info">
                Notifications require the database to be configured.
              </div>
            )}

            {loading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
              </div>
            )}

            {error && <p className="error-text bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">{error}</p>}

            {!loading && !error && displayedItems.length === 0 && available && (
              <div className="empty-state">
                <div className="w-16 h-16 rounded-2xl bg-sage/10 flex items-center justify-center mb-4">
                  <BellRing className="w-8 h-8 text-sage" />
                </div>
                <p className="font-heading font-bold text-xl text-ink dark:text-white mb-1">
                  {filter === 'unread' ? 'No unread notifications' : filter === 'critical' ? 'No critical notifications' : 'No notifications yet'}
                </p>
                <p className="text-sm max-w-xs leading-relaxed">
                  Notifications are generated automatically after a crawl detects a significant accessibility regression.
                </p>
              </div>
            )}

            {!loading && !error && displayedItems.length > 0 && (
              <div className="space-y-6">
                <AlertGroup title="Today" items={todayItems} onAcknowledge={handleAcknowledge} onViewResults={handleViewResults} acknowledging={acknowledging} />
                <AlertGroup title="Earlier" items={earlierItems} onAcknowledge={handleAcknowledge} onViewResults={handleViewResults} acknowledging={acknowledging} />
              </div>
            )}

            <div className="text-xs text-body dark:text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-xl p-4 space-y-1">
              <p className="font-semibold text-ink dark:text-gray-300">When are notifications created?</p>
              <p>Site score drops ≥ 5 points · Total violations increase ≥ 10 · New critical issues introduced · Page regressions detected</p>
              <p>These thresholds are configurable via environment variables: <code className="font-mono text-[10px]">ALERT_SCORE_DROP_THRESHOLD</code>, <code className="font-mono text-[10px]">ALERT_VIOLATION_INCREASE_THRESHOLD</code></p>
            </div>
          </div>

          <aside className="w-full lg:w-72 flex-shrink-0">
            <div className="card p-5">
              <h2 className="font-heading font-semibold text-sm text-ink dark:text-white mb-1">Connected channels</h2>
              <p className="text-xs text-body dark:text-gray-400 mb-4">
                Accessibility reports are delivered to these workspaces after each crawl.
              </p>
              {integrationsLoading ? (
                <div className="space-y-2 mb-3">
                  <div className="skeleton h-9" />
                  <div className="skeleton h-9" />
                </div>
              ) : integrations.length === 0 ? (
                <p className="text-xs text-body dark:text-gray-500 mb-4">No channels connected yet.</p>
              ) : (
                <ul className="space-y-2 mb-4">
                  {integrations.map((integ) => (
                    <li key={integ.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                      <span className="text-ink dark:text-white font-medium capitalize truncate">{integ.workspace_name || integ.platform}</span>
                      <span className="text-body dark:text-gray-500 flex-shrink-0">
                        {integ.channel_count} channel{integ.channel_count !== 1 ? 's' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => navigate('integrations')} className="btn-secondary w-full justify-center text-xs py-2">
                Manage channels
              </button>
            </div>
          </aside>
        </div>

      </div>
    </main>
  );
}
