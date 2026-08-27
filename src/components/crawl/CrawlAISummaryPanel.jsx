import { apiFetch } from '../../utils/api';
import { useState, useEffect } from 'react';
import { Sparkles, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';

function SectionBlock({ title, items, bulletColor = 'bg-teal' }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-body dark:text-gray-500 mb-2">
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-ink dark:text-gray-200 leading-relaxed">
            <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${bulletColor}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CrawlAISummaryPanel({ crawlId, isComplete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!crawlId || !isComplete) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/crawl/${crawlId}/summary`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok && json.available && json.summary) {
          setData(json.summary);
        } else if (json.ok && !json.available) {
          setData(null); // AI not configured — hide panel
        } else {
          setError(json.error || 'Failed to load AI summary');
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crawlId, isComplete]);

  if (!isComplete) return null;
  if (!loading && !data && !error) return null; // AI not enabled

  if (error) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 flex items-center gap-3 text-sm text-body dark:text-gray-400">
        <AlertCircle size={15} className="text-amber flex-shrink-0" />
        AI summary unavailable: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={15} className="text-teal animate-pulse" />
          <div className="h-3 w-32 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
        </div>
        <div className="space-y-2">
          {[120, 80, 160, 100].map((w, i) => (
            <div key={i} className="h-3 bg-gray-100 dark:bg-white/5 rounded animate-pulse" style={{ width: w }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-teal/10 dark:border-teal/20 shadow-soft overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-teal flex-shrink-0" />
          <p className="font-heading font-semibold text-sm text-ink dark:text-white">
            AI Accessibility Summary
          </p>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal font-semibold">
            Claude
          </span>
        </div>
        <ChevronRight
          size={15}
          className={`text-body dark:text-gray-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        />
      </button>

      {!collapsed && (
        <div className="p-5 space-y-5">
          {/* Overall health */}
          {data.overall_health && (
            <div className="bg-teal/5 dark:bg-teal/[0.08] rounded-xl px-4 py-3">
              <p className="text-sm text-ink dark:text-gray-100 leading-relaxed">
                {data.overall_health}
              </p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            <SectionBlock
              title="Major Risks"
              items={data.major_risks}
              bulletColor="bg-coral"
            />
            <SectionBlock
              title="Most Affected Areas"
              items={data.most_affected_areas}
              bulletColor="bg-amber"
            />
            <SectionBlock
              title="Positive Findings"
              items={data.positive_findings}
              bulletColor="bg-sage"
            />
            <SectionBlock
              title="Recommended Priorities"
              items={data.recommended_priorities}
              bulletColor="bg-teal"
            />
          </div>

          <p className="text-[10px] text-body dark:text-gray-600 pt-1 border-t border-gray-100 dark:border-white/[0.05]">
            Generated by Claude · Based on axe-core scan results · Not a substitute for manual accessibility review
          </p>
        </div>
      )}
    </div>
  );
}
