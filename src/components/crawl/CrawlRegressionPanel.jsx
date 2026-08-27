import { apiFetch } from '../../utils/api';
import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingDown, TrendingUp, Plus } from 'lucide-react';
import { formatUrl } from '../../utils/format';

function DeltaChip({ delta, good = false }) {
  const cls = good
    ? 'bg-sage/10 text-sage'
    : 'bg-coral/10 text-coral';
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cls}`}>
      {delta > 0 ? '+' : ''}{delta}
    </span>
  );
}

function CardHeader({ icon: Icon, iconClass, title, badge }) {
  return (
    <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2">
      <Icon className={`w-4 h-4 flex-shrink-0 ${iconClass}`} />
      <p className="font-heading font-semibold text-sm text-ink dark:text-white">{title}</p>
      {badge != null && badge > 0 && (
        <span className="ml-auto text-xs font-semibold text-body dark:text-gray-400">{badge}</span>
      )}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="px-5 py-3.5 space-y-1.5">
      <div className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-40" />
      <div className="h-2.5 bg-gray-100 dark:bg-white/5 rounded animate-pulse w-24" />
    </div>
  );
}

export default function CrawlRegressionPanel({ crawlId, isComplete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!crawlId || !isComplete) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/crawl/${crawlId}/regressions`)
      .then(r => r.json())
      .then(json => {
        if (!cancelled && json.ok) setData(json);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crawlId, isComplete]);

  if (!isComplete) return null;
  if (!loading && (!data || !data.has_comparison)) return null;

  const regressions = data?.regressions ?? [];
  const improvements = data?.improvements ?? [];
  const newPages = data?.new_pages ?? [];

  const cardBase = "bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft";

  return (
    <div className="grid lg:grid-cols-2 gap-4">

      {/* Needs Attention — regressions */}
      <div className={cardBase}>
        <CardHeader icon={AlertTriangle} iconClass="text-coral" title="Needs Attention" />

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </div>
        ) : regressions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
            <div className="w-10 h-10 rounded-full bg-sage/10 flex items-center justify-center mb-2">
              <TrendingUp className="w-5 h-5 text-sage" />
            </div>
            <p className="text-sm font-medium text-ink dark:text-white">No regressions</p>
            <p className="text-xs text-body dark:text-gray-500 mt-1">
              All pages stable or improved vs previous crawl
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            {regressions.slice(0, 7).map((item, idx) => (
              <div key={idx} className="px-5 py-3.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-ink dark:text-white truncate" title={item.url}>
                    {formatUrl(item.url)}
                  </p>
                  <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">
                    <span className="text-coral font-semibold">{item.current_violations}</span>
                    {' violations · was '}
                    <span>{item.previous_violations}</span>
                  </p>
                </div>
                <DeltaChip delta={item.delta} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Improvements + New Pages */}
      <div className="space-y-4">

        <div className={cardBase}>
          <CardHeader icon={TrendingDown} iconClass="text-sage" title="Improvements" badge={improvements.length} />
          {loading ? (
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
              <RowSkeleton /><RowSkeleton />
            </div>
          ) : improvements.length === 0 ? (
            <p className="px-5 py-4 text-xs text-body dark:text-gray-500">
              No improvements detected vs previous crawl
            </p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
              {improvements.slice(0, 5).map((item, idx) => (
                <div key={idx} className="px-5 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink dark:text-white truncate" title={item.url}>
                      {formatUrl(item.url)}
                    </p>
                    <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">
                      <span className="text-sage font-semibold">{item.current_violations}</span>
                      {' · was '}{item.previous_violations}
                    </p>
                  </div>
                  <DeltaChip delta={item.delta} good />
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && newPages.length > 0 && (
          <div className={cardBase}>
            <CardHeader icon={Plus} iconClass="text-teal" title="New Pages" badge={newPages.length} />
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
              {newPages.slice(0, 5).map((item, idx) => (
                <div key={idx} className="px-5 py-3 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink dark:text-white truncate" title={item.url}>
                    {formatUrl(item.url)}
                  </p>
                  {item.violations > 0 && (
                    <span className="text-xs font-semibold text-coral flex-shrink-0">
                      {item.violations} issue{item.violations !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
