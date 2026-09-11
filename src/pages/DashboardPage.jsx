import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import {
  AlertCircle, FileText, CheckCircle2, Shield, ScanLine, Upload, ArrowRight,
} from 'lucide-react';
import { formatUrl, formatShortDate } from '../utils/format';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useApp } from '../context/AppContext';

const QUICK_ACTIONS = [
  { label: 'Run audit', sub: 'Start a new accessibility scan', page: 'new-scan', icon: ScanLine },
  { label: 'Upload results', sub: 'Import results from a tool', page: 'scan-history', icon: Upload },
];

const TREND_RANGES = [
  { days: 15, label: 'Last 15 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 45, label: 'Last 45 days' },
  { days: 90, label: 'Last 90 days' },
];

const TREND_METRICS = {
  total_violations: { label: 'Total issues', color: '#1a7a6a' },
  critical:          { label: 'Critical',    color: '#dc2626' },
  serious:           { label: 'Serious',     color: '#ea580c' },
  moderate:          { label: 'Moderate',    color: '#2563eb' },
  minor:             { label: 'Minor',       color: '#6b7280' },
};

/* ─── page ─── */
export default function DashboardPage() {
  const { navigate, user } = useApp();
  const [historyItems, setHistoryItems] = useState([]);
  const [trendData, setTrendData]       = useState([]);
  const [trendSummary, setTrendSummary] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [trendAvail, setTrendAvail]     = useState(true);
  const [severityBreakdown, setSeverityBreakdown] = useState(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const [fixesApplied, setFixesApplied] = useState(0);
  const [trendDays, setTrendDays] = useState(30);
  const [trendMetric, setTrendMetric] = useState('total_violations');
  const [trendLoading, setTrendLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const fallback = { ok: false };
        const safeJson = (res) => res.json().catch(() => fallback);
        const histJson = await apiFetch('/api/history').then(safeJson).catch(() => fallback);
        if (histJson.ok && Array.isArray(histJson.items)) {
          setHistoryItems(histJson.items);
        }
      } catch {
        // network failure — all states remain at empty defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrendLoading(true);
      try {
        const fallback = { ok: false };
        const trendJson = await apiFetch(`/api/trends?days=${trendDays}`).then(res => res.json()).catch(() => fallback);
        if (cancelled) return;
        if (trendJson.ok && trendJson.available && Array.isArray(trendJson.data)) {
          setTrendData(trendJson.data);
          setTrendSummary(trendJson.summary ?? null);
          setTrendAvail(true);
        } else {
          setTrendData([]);
          setTrendAvail(false);
        }
      } catch {
        if (!cancelled) setTrendAvail(false);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trendDays]);

  useEffect(() => {
    (async () => {
      setIntelLoading(true);
      try {
        const res  = await apiFetch('/api/violations/summary?limit=25');
        const json = await res.json().catch(() => ({ ok: false }));
        if (json.ok && json.available) {
          setSeverityBreakdown(json.severity_breakdown ?? null);
        }
      } catch {
        // leave at defaults
      } finally {
        setIntelLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/fixes?limit=200')
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.ok || !Array.isArray(data.fixes)) return;
        setFixesApplied(data.fixes.filter(f => f.merged).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* ── base metrics ── */
  const totalScans      = historyItems.length;

  const avgPassRate = trendSummary?.avg_pass_rate != null
    ? Math.round(trendSummary.avg_pass_rate)
    : historyItems.length > 0
      ? Math.round(historyItems.reduce((s, i) => s + (i.passRate ?? 0), 0) / historyItems.length)
      : null;

  const recentAudits = [...historyItems]
    .sort((a, b) => new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0))
    .slice(0, 5);

  const getStatusValue = (item) => (item.passRate ?? 0) >= 70 ? 'Passed' : 'Needs review';

  const STAT_CARDS = [
    {
      label: 'Critical issues', icon: AlertCircle, color: 'text-coral-700', bg: 'bg-coral/10', iconColor: '#dc2626',
      value: severityBreakdown?.critical ?? 0, sub: 'Needs immediate attention', loading: intelLoading,
    },
    {
      label: 'Serious issues', icon: AlertCircle, color: 'text-amber-800', bg: 'bg-amber/10', iconColor: '#ea580c',
      value: severityBreakdown?.serious ?? 0, sub: 'Should be addressed', loading: intelLoading,
    },
    {
      label: 'Pages scanned', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', iconColor: '#2563eb',
      value: totalScans, sub: 'Across all audits', loading,
    },
    {
      label: 'Fixes applied', icon: CheckCircle2, color: 'text-sage-700', bg: 'bg-sage/10', iconColor: '#059669',
      value: fixesApplied, sub: 'Since last 30 days', loading: false,
    },
  ];

  /* ─── render ─── */
  return (
    <div className="flex-1 overflow-auto bg-ivory">
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        <h1 className="font-heading font-bold text-2xl text-ink">
          Good morning{user?.firstName ? `, ${user.firstName}` : ''}
        </h1>

        {/* ── HERO SCORE + QUICK ACTIONS ── */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <div className="rounded-2xl p-6 text-white bg-gradient-to-br from-teal to-teal-900 relative overflow-hidden">
            <p className="text-sm font-medium text-white/80 mb-2">Accessibility health at a glance</p>
            <div className="flex items-end gap-4">
              {loading ? (
                <div className="h-14 w-24 bg-white/15 rounded animate-pulse" />
              ) : (
                <span className="font-heading text-6xl font-bold leading-none">
                  {avgPassRate != null ? avgPassRate : '—'}
                </span>
              )}
              <div className="mb-1.5">
                <span className="text-sm text-white/90 font-medium">Improving from last scan</span>
              </div>
              <Shield className="w-20 h-20 text-white/10 ml-auto hidden sm:block" />
            </div>
            <button
              onClick={() => navigate('new-scan')}
              className="mt-4 bg-white text-teal-800 font-semibold text-sm px-5 py-2 rounded-lg hover:bg-white/90 transition-colors flex items-center gap-2"
            >
              Run new audit <ArrowRight size={14} />
            </button>
          </div>

          <div className="card p-4 space-y-2">
            <h3 className="font-heading font-semibold text-sm text-ink px-1">Quick actions</h3>
            {QUICK_ACTIONS.map(({ label, sub, page, icon: Icon }) => (
              <button
                key={label}
                onClick={() => navigate(page)}
                className="w-full flex items-center gap-3 p-2 rounded-xl border border-gray-100 hover:border-teal hover:bg-teal/5 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-teal/10 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-teal" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-ink">{label}</p>
                  <p className="text-[11px] text-body truncate">{sub}</p>
                </div>
                <ArrowRight size={13} className="text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* ── STAT CARDS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {STAT_CARDS.map((s) => (
            <div key={s.label} className="card p-4">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 ${s.bg} rounded-lg flex items-center justify-center shrink-0`}>
                  <s.icon size={18} color={s.iconColor} />
                </div>
                <div>
                  <p className="text-[11px] text-body">{s.label}</p>
                  {s.loading
                    ? <div className="h-7 w-10 bg-gray-100 rounded animate-pulse my-0.5" />
                    : <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  }
                  <p className="text-[11px] text-gray-400">{s.sub}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── ISSUE TREND + RECENT AUDITS ── */}
        <div className="grid lg:grid-cols-2 gap-4">

          {/* Issue trend */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm text-ink">Issue trend</h3>
              <div className="flex gap-2">
                <select
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 text-body"
                  value={trendMetric}
                  onChange={(e) => setTrendMetric(e.target.value)}
                >
                  {Object.entries(TREND_METRICS).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <select
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 text-body"
                  value={trendDays}
                  onChange={(e) => setTrendDays(Number(e.target.value))}
                >
                  {TREND_RANGES.map(({ days, label }) => (
                    <option key={days} value={days}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            {trendLoading ? (
              <div className="h-[180px] bg-gray-50 rounded-xl animate-pulse" />
            ) : !trendAvail || trendData.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-body text-sm">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 10 }} stroke="#e5e7eb" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#e5e7eb" />
                  <Tooltip formatter={(val) => [val, TREND_METRICS[trendMetric].label]} labelFormatter={(d) => d} />
                  <Line
                    type="monotone"
                    dataKey={trendMetric}
                    name={TREND_METRICS[trendMetric].label}
                    stroke={TREND_METRICS[trendMetric].color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="flex gap-4 mt-2">
              <span className="flex items-center gap-1 text-[11px] text-body">
                <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: TREND_METRICS[trendMetric].color }} />
                {TREND_METRICS[trendMetric].label}
              </span>
            </div>
          </div>

          {/* Recent audits */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm text-ink">Recent audits</h3>
              <button onClick={() => navigate('scan-history')} className="text-xs text-teal font-medium hover:underline">View all</button>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : recentAudits.length === 0 ? (
              <p className="text-sm text-body py-8 text-center">No scans yet. Go to New Scan to get started.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    {['Website', 'Score', 'Issues', 'Status', 'Date'].map(h => (
                      <th key={h} className="text-left pb-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentAudits.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-2 font-medium text-ink">{formatUrl(item.url ?? '')}</td>
                      <td className="py-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          (item.passRate ?? 0) >= 80 ? 'bg-sage/15 text-sage-700'
                          : (item.passRate ?? 0) >= 65 ? 'bg-amber/15 text-amber-800'
                          : 'bg-coral/15 text-coral-700'
                        }`}>{item.passRate ?? '—'}</span>
                      </td>
                      <td className="py-2 text-body">{item.violations ?? 0}</td>
                      <td className="py-2"><StatusBadge status={getStatusValue(item)} /></td>
                      <td className="py-2 text-gray-400">{item.timestamp ? formatShortDate(item.timestamp) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button onClick={() => navigate('scan-history')} className="text-xs text-teal font-medium hover:underline mt-3 flex items-center gap-1">
              View full history <ArrowRight size={11} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
