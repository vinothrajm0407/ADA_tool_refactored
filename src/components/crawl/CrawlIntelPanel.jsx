import { apiFetch } from '../../utils/api';
import { useState, useEffect } from 'react';
import { Activity, AlertCircle } from 'lucide-react';

const SEVERITY_CONFIG = [
  { key: 'critical', label: 'Critical', bg: 'bg-coral',    text: 'text-coral' },
  { key: 'serious',  label: 'Serious',  bg: 'bg-amber',    text: 'text-amber' },
  { key: 'moderate', label: 'Moderate', bg: 'bg-blue-400', text: 'text-blue-400' },
  { key: 'minor',    label: 'Minor',    bg: 'bg-gray-400', text: 'text-gray-400' },
];

const PRINCIPLE_COLORS = {
  Perceivable:    '#0F766E',
  Operable:       '#6BA368',
  Understandable: '#F59E0B',
  Robust:         '#E76F51',
};

const PRINCIPLE_ORDER = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

function formatRuleId(id) {
  return (id || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06]">
        <p className="font-heading font-semibold text-sm text-ink dark:text-white">{title}</p>
        {subtitle && <p className="text-xs text-body dark:text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function LoadingSkeleton({ rows = 4 }) {
  return (
    <div className="px-5 py-4 space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse" style={{ width: `${48 + (i % 3) * 16}px` }} />
            <div className="h-3 w-6 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
          </div>
          <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function BarRow({ label, sub, count, max, barColor, textColor }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-medium text-ink dark:text-white">{label}</span>
          {sub && <span className="ml-1.5 text-[10px] text-body dark:text-gray-500">{sub}</span>}
        </div>
        <span className={`text-xs font-semibold flex-shrink-0 ${count > 0 ? textColor : 'text-gray-400 dark:text-gray-600'}`}>{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: barColor, opacity: 0.75 }} />
      </div>
    </div>
  );
}

function EmptyState({ message = 'No data available' }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-body dark:text-gray-500">{message}</p>
    </div>
  );
}

export default function CrawlIntelPanel({ crawlId, isComplete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!crawlId || !isComplete) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/crawl/${crawlId}/intelligence`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.ok) setData(json);
        else setError(json.message || json.error || 'Could not load intelligence data');
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Network error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crawlId, isComplete]);

  if (!isComplete) return null;

  const severity = data?.severity_breakdown ?? null;
  const principles = data?.wcag_principles ?? null;
  const topIssues = data?.top_issue_types ?? [];
  const wcagCriteria = data?.wcag_breakdown ?? [];
  const hasViolations = severity && Object.values(severity).some(v => v > 0);

  const maxSeverity = severity ? Math.max(...SEVERITY_CONFIG.map(c => severity[c.key] ?? 0), 1) : 1;
  const maxPrinciple = principles ? Math.max(...PRINCIPLE_ORDER.map(p => principles[p] ?? 0), 1) : 1;
  const maxIssue = topIssues[0]?.count ?? 1;

  if (error) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 flex items-center gap-3 text-sm text-body dark:text-gray-400">
        <AlertCircle size={16} className="text-amber flex-shrink-0" />
        Accessibility intelligence unavailable: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-body dark:text-gray-500" />
        <span className="font-heading font-semibold text-sm uppercase tracking-wider text-body dark:text-gray-400 leading-none">
          Accessibility Intelligence
        </span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">

        {/* Severity Distribution */}
        <SectionCard title="Severity Distribution" subtitle="Affected DOM nodes by impact level">
          {loading ? <LoadingSkeleton rows={4} /> : !hasViolations ? (
            <EmptyState message="No violations found in this crawl" />
          ) : (
            <div className="px-5 py-4 space-y-4">
              {SEVERITY_CONFIG.map(cfg => (
                <BarRow
                  key={cfg.key}
                  label={cfg.label}
                  count={severity[cfg.key] ?? 0}
                  max={maxSeverity}
                  barColor={cfg.bg === 'bg-coral' ? '#E76F51' : cfg.bg === 'bg-amber' ? '#F59E0B' : cfg.bg === 'bg-blue-400' ? '#60A5FA' : '#9CA3AF'}
                  textColor={cfg.text}
                />
              ))}
            </div>
          )}
        </SectionCard>

        {/* WCAG Principles */}
        <SectionCard title="WCAG Principles" subtitle="Violations by accessibility principle">
          {loading ? <LoadingSkeleton rows={4} /> : !principles || !Object.values(principles).some(v => v > 0) ? (
            <EmptyState message="No WCAG data available" />
          ) : (
            <>
              <div className="px-5 py-4 space-y-4">
                {PRINCIPLE_ORDER.map(p => (
                  <BarRow
                    key={p}
                    label={p}
                    count={principles[p] ?? 0}
                    max={maxPrinciple}
                    barColor={PRINCIPLE_COLORS[p]}
                    textColor="text-ink dark:text-white"
                  />
                ))}
              </div>
              {wcagCriteria.length > 0 && (
                <div className="px-5 pb-4 border-t border-gray-100 dark:border-white/5 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-body dark:text-gray-500 mb-2">
                    Top Criteria
                  </p>
                  <div className="space-y-1.5">
                    {wcagCriteria.slice(0, 5).map(c => (
                      <div key={c.criterion} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink dark:text-gray-300 truncate" title={c.name}>
                          <span className="font-mono text-[10px] text-body dark:text-gray-500 mr-1">{c.criterion}</span>
                          {c.name}
                        </span>
                        <span className="text-xs font-semibold text-coral flex-shrink-0">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>

        {/* Top Issue Types */}
        <SectionCard title="Top Issue Types" subtitle="Most common axe rule violations">
          {loading ? <LoadingSkeleton rows={5} /> : topIssues.length === 0 ? (
            <EmptyState message="No violations found" />
          ) : (
            <div className="px-5 py-4 space-y-3">
              {topIssues.slice(0, 7).map(item => {
                const pct = maxIssue > 0 ? Math.round((item.count / maxIssue) * 100) : 0;
                return (
                  <div key={item.rule_id}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink dark:text-white truncate" title={item.rule_id}>
                          {formatRuleId(item.rule_id)}
                        </p>
                        <p className="text-[10px] text-body dark:text-gray-500">
                          {item.affected_pages} page{item.affected_pages !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-coral flex-shrink-0">{item.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-coral/50 transition-all duration-300" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
