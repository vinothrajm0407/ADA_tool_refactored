import { apiFetch } from '../../utils/api';
import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

function DeltaBadge({ delta, invert = false }) {
  const isPositive = delta > 0;
  const isGood = invert ? !isPositive : isPositive;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold flex-shrink-0 ${isGood ? 'text-sage' : 'text-coral'}`}>
      {isGood ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {isPositive ? '+' : ''}{delta}
    </span>
  );
}

function TrendsTable({ title, pages, icon: Icon, iconClass, emptyMsg, deltaKey = 'violation_delta', invertGood = false }) {
  if (pages.length === 0) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2">
          <Icon size={15} className={iconClass} />
          <p className="font-heading font-semibold text-sm text-ink dark:text-white">{title}</p>
        </div>
        <p className="px-5 py-8 text-sm text-body dark:text-gray-500 text-center">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2">
        <Icon size={15} className={iconClass} />
        <p className="font-heading font-semibold text-sm text-ink dark:text-white">{title}</p>
        <span className="ml-auto text-xs text-body dark:text-gray-500">{pages.length}</span>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
        {pages.map((page, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-3">
            <span className="text-[10px] text-body dark:text-gray-500 w-4 flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-ink dark:text-white truncate" title={page.url}>
                {page.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 50) || '/'}
              </p>
              <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">
                Violations: {page.prev_violations} → <strong className={page.violation_delta < 0 ? 'text-sage' : 'text-coral'}>{page.curr_violations}</strong>
                {' '}· Pass rate: {page.prev_pass_rate}% → {page.curr_pass_rate}%
              </p>
            </div>
            <DeltaBadge delta={page[deltaKey]} invert={invertGood} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PageTrendsPanel({ crawlId, isComplete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!crawlId || !isComplete) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/crawl/${crawlId}/page-trends`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok) setData(json);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crawlId, isComplete]);

  if (!isComplete) return null;
  if (!loading && (!data || !data.has_comparison)) return null;

  if (loading) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-5 space-y-3">
            <div className="h-3 w-40 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
            {[1, 2, 3].map((j) => <div key={j} className="h-10 bg-gray-50 dark:bg-white/[0.03] rounded-xl animate-pulse" />)}
          </div>
        ))}
      </div>
    );
  }

  const improved = data?.most_improved || [];
  const regressed = data?.most_regressed || [];

  if (improved.length === 0 && regressed.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-body dark:text-gray-500" />
        <p className="font-heading font-semibold text-sm uppercase tracking-wider text-body dark:text-gray-400 leading-none">
          Page Trends vs Previous Crawl
        </p>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <TrendsTable
          title="Most Regressed Pages"
          pages={regressed}
          icon={TrendingDown}
          iconClass="text-coral"
          emptyMsg="No pages regressed since last crawl."
          deltaKey="violation_delta"
          invertGood
        />
        <TrendsTable
          title="Most Improved Pages"
          pages={improved}
          icon={TrendingUp}
          iconClass="text-sage"
          emptyMsg="No improvements detected since last crawl."
          deltaKey="violation_delta"
          invertGood
        />
      </div>
    </div>
  );
}
