import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import { BellRing, CheckCheck, TrendingDown, AlertTriangle, ShieldAlert, BarChart2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

const ALERT_META = {
  score_decrease:       { label: 'Score Decrease',       icon: TrendingDown, color: 'text-coral',  bg: 'bg-coral/10'  },
  violation_increase:   { label: 'Violation Increase',   icon: BarChart2,    color: 'text-amber',  bg: 'bg-amber/10'  },
  critical_introduced:  { label: 'Critical Introduced',  icon: ShieldAlert,  color: 'text-coral',  bg: 'bg-coral/10'  },
  regression_detected:  { label: 'Regression Detected',  icon: AlertTriangle, color: 'text-amber', bg: 'bg-amber/10'  },
};

const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, info: 3 };

function SeverityChip({ severity }) {
  const cls = {
    critical: 'bg-coral/10 text-coral',
    serious:  'bg-amber/10 text-amber',
    moderate: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    info:     'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400',
  }[severity] || 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400';
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {severity?.charAt(0).toUpperCase() + severity?.slice(1)}
    </span>
  );
}

function AlertCard({ alert, onAcknowledge, acknowledging }) {
  const meta = ALERT_META[alert.alert_type] || { label: alert.alert_type, icon: AlertTriangle, color: 'text-body', bg: 'bg-gray-100' };
  const Icon = meta.icon;
  const isActive = alert.status === 'active';
  const details = alert.details || {};

  return (
    <div className={`bg-white dark:bg-charcoal rounded-xl border shadow-soft transition-opacity ${
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
                <span className="text-xs text-body dark:text-gray-500">Acknowledged</span>
              )}
            </div>
          </div>

          {/* Details */}
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

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[10px] text-body dark:text-gray-500">{formatDate(alert.created_at)}</span>
            {isActive && (
              <button
                onClick={() => onAcknowledge(alert.id)}
                disabled={acknowledging === alert.id}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-body dark:text-gray-400 hover:text-teal transition-colors disabled:opacity-40"
              >
                <CheckCheck size={13} />
                {acknowledging === alert.id ? 'Marking…' : 'Acknowledge'}
              </button>
            )}
          </div>
        </div>
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
  const [filter, setFilter] = useState('active');
  const [acknowledging, setAcknowledging] = useState(null);

  useEffect(() => { loadAlerts(); }, [filter]);

  async function loadAlerts() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filter !== 'all') params.set('status', filter);
      const res = await apiFetch(`/api/alerts?${params}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
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
      loadAlerts();
    } catch {}
    setAcknowledging(null);
  }

  const sortedItems = [...items].sort((a, b) => {
    const sA = SEVERITY_ORDER[a.severity] ?? 9;
    const sB = SEVERITY_ORDER[b.severity] ?? 9;
    if (sA !== sB) return sA - sB;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[860px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">
              Accessibility Notifications
            </h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Notifications are generated automatically when significant regressions are detected after each crawl.
            </p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {['active', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-teal text-white'
                  : 'bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'
              }`}
            >
              {f === 'active' ? 'Active' : 'All notifications'}
            </button>
          ))}
        </div>

        {/* DB unavailable */}
        {!available && !loading && (
          <p className="text-sm text-body dark:text-gray-400 bg-teal/10 px-4 py-3 rounded-xl border border-teal">
            Notifications require database (MSSQL) to be configured.
          </p>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">{error}</p>
        )}

        {!loading && !error && sortedItems.length === 0 && available && (
          <div className="mt-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-sage/10 flex items-center justify-center">
              <BellRing className="w-8 h-8 text-sage" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">
              {filter === 'active' ? 'No active notifications' : 'No notifications yet'}
            </p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs leading-relaxed">
              {filter === 'active'
                ? 'All notifications have been acknowledged. Notifications are generated automatically after crawl completion.'
                : 'Notifications appear here after crawls detect significant accessibility regressions.'}
            </p>
          </div>
        )}

        {!loading && !error && sortedItems.length > 0 && (
          <div className="space-y-3">
            {sortedItems.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={handleAcknowledge}
                acknowledging={acknowledging}
              />
            ))}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-body dark:text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-xl p-4 space-y-1">
          <p className="font-semibold text-ink dark:text-gray-300">When are notifications created?</p>
          <p>Site score drops ≥ 5 points · Total violations increase ≥ 10 · New critical issues introduced · Page regressions detected</p>
          <p>These thresholds are configurable via environment variables: <code className="font-mono text-[10px]">ALERT_SCORE_DROP_THRESHOLD</code>, <code className="font-mono text-[10px]">ALERT_VIOLATION_INCREASE_THRESHOLD</code></p>
        </div>

      </div>
    </main>
  );
}
