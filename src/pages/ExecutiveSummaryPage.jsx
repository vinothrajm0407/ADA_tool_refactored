import { apiFetch } from '../utils/api';
import { useState, useEffect, useRef } from 'react';
import { Printer, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return iso; }
}

function ScoreGauge({ score }) {
  const pct = Math.min(100, Math.max(0, score || 0));
  const color = pct >= 80 ? '#6BA368' : pct >= 60 ? '#F59E0B' : '#E76F51';
  return (
    <div className="flex flex-col items-center gap-2 print:gap-1">
      <svg viewBox="0 0 120 70" className="w-36 print:w-28" aria-hidden="true">
        <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M10 65 A50 50 0 0 1 110 65"
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * 157} 157`}
        />
        <text x="60" y="62" textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>{score ?? '—'}</text>
      </svg>
      <p className="text-xs text-gray-500 print:text-gray-400">Site Score</p>
    </div>
  );
}

function MetricBox({ label, value, sub, color = '' }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 text-center print:border-gray-300">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SeverityBar({ label, count, max, color }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="font-semibold" style={{ color }}>{count}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }} />
      </div>
    </div>
  );
}

export default function ExecutiveSummaryPage() {
  const { navigate, crawlId } = useApp();
  const printRef = useRef(null);

  const [job, setJob] = useState(null);
  const [intel, setIntel] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [regressions, setRegressions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!crawlId) { setError('No crawl selected.'); setLoading(false); return; }
    let cancelled = false;

    async function load() {
      try {
        const [jobRes, intelRes, aiRes, regRes] = await Promise.all([
          apiFetch(`/api/crawl/${crawlId}`).then((r) => r.json()),
          apiFetch(`/api/crawl/${crawlId}/intelligence`).then((r) => r.json()),
          apiFetch(`/api/crawl/${crawlId}/summary`).then((r) => r.json()),
          apiFetch(`/api/crawl/${crawlId}/regressions`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (jobRes.ok) setJob(jobRes.job);
        if (intelRes.ok) setIntel(intelRes);
        if (aiRes.ok && aiRes.available) setAiSummary(aiRes.summary);
        if (regRes.ok) setRegressions(regRes);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [crawlId]);

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {[1,2,3].map((i) => <div key={i} className="h-24 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />)}
        </div>
      </main>
    );
  }

  if (error || !job) {
    return (
      <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => navigate('crawl-results')} className="flex items-center gap-2 text-sm text-body dark:text-gray-400 hover:text-teal mb-4">
            <ArrowLeft size={14} /> Back to results
          </button>
          <p className="text-coral">{error || 'Crawl not found.'}</p>
        </div>
      </main>
    );
  }

  const severity = intel?.severity_breakdown || {};
  const principles = intel?.wcag_principles || {};
  const topIssues = intel?.top_issue_types || [];
  const maxSev = Math.max(...Object.values(severity), 1);
  const regressionList = regressions?.regressions || [];
  const improvementList = regressions?.improvements || [];

  const printDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <main className="flex-1 overflow-auto bg-white dark:bg-night print:bg-white" role="main">
      {/* Screen-only controls */}
      <div className="print:hidden sticky top-0 z-10 bg-white dark:bg-charcoal border-b border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center justify-between gap-4">
        <button
          onClick={() => navigate('crawl-results')}
          className="flex items-center gap-2 text-sm text-body dark:text-gray-400 hover:text-teal transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Crawl Results
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-body dark:text-gray-500 hidden sm:block">
            Use browser print (Ctrl+P / Cmd+P) to save as PDF
          </span>
          <button
            onClick={handlePrint}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Printer size={14} />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Report body */}
      <div ref={printRef} className="max-w-4xl mx-auto px-8 py-10 print:px-6 print:py-8 text-gray-900">

        {/* Cover */}
        <div className="border-b-2 border-gray-200 pb-8 mb-8 print:pb-6 print:mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-teal flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-lg text-gray-900">ADA Accessibility Monitor</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Executive Accessibility Summary</h1>
              <p className="text-gray-500 text-sm">{job.root_url}</p>
              <p className="text-gray-400 text-xs mt-1">Report generated: {printDate} · Crawl date: {formatDate(job.created_at)}</p>
            </div>
            <ScoreGauge score={job.site_score} />
          </div>
        </div>

        {/* KPIs */}
        <section className="mb-8">
          <h2 className="text-base font-bold text-gray-700 uppercase tracking-wider mb-4">Key Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricBox
              label="Pages Scanned"
              value={job.total_scanned}
              sub={job.total_failed ? `${job.total_failed} failed` : undefined}
            />
            <MetricBox
              label="Avg Pass Rate"
              value={job.avg_pass_rate != null ? `${job.avg_pass_rate}%` : null}
            />
            <MetricBox
              label="Total Violations"
              value={job.total_violations}
              color={job.total_violations > 0 ? 'text-red-600' : 'text-green-600'}
            />
            <MetricBox
              label="Scan Duration"
              value={job.duration_seconds != null ? `${Math.round(job.duration_seconds)}s` : null}
            />
          </div>
        </section>

        {/* AI Summary */}
        {aiSummary && (
          <section className="mb-8 bg-gray-50 border border-gray-200 rounded-xl p-5 print:border-gray-300">
            <h2 className="text-base font-bold text-gray-700 uppercase tracking-wider mb-4">AI Accessibility Assessment</h2>
            {aiSummary.overall_health && (
              <p className="text-sm text-gray-700 mb-4 leading-relaxed">{aiSummary.overall_health}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[
                { key: 'major_risks', title: 'Major Risks', bullet: '#E76F51' },
                { key: 'most_affected_areas', title: 'Most Affected Areas', bullet: '#F59E0B' },
                { key: 'positive_findings', title: 'Positive Findings', bullet: '#6BA368' },
                { key: 'recommended_priorities', title: 'Recommended Priorities', bullet: '#0F766E' },
              ].map(({ key, title, bullet }) =>
                aiSummary[key]?.length ? (
                  <div key={key}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}</p>
                    <ul className="space-y-1">
                      {aiSummary[key].map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-700 leading-relaxed">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: bullet }} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              )}
            </div>
          </section>
        )}

        {/* Severity breakdown */}
        {Object.values(severity).some((v) => v > 0) && (
          <section className="mb-8">
            <h2 className="text-base font-bold text-gray-700 uppercase tracking-wider mb-4">Violation Severity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                {[
                  { key: 'critical', label: 'Critical', color: '#E76F51' },
                  { key: 'serious',  label: 'Serious',  color: '#F59E0B' },
                  { key: 'moderate', label: 'Moderate', color: '#60A5FA' },
                  { key: 'minor',    label: 'Minor',    color: '#9CA3AF' },
                ].map((s) => (
                  <SeverityBar key={s.key} label={s.label} count={severity[s.key] || 0} max={maxSev} color={s.color} />
                ))}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">WCAG Principles</p>
                <div className="space-y-1">
                  {Object.entries(principles).map(([p, count]) => (
                    <div key={p} className="flex justify-between text-xs text-gray-700 py-1 border-b border-gray-100">
                      <span>{p}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Top issues */}
        {topIssues.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold text-gray-700 uppercase tracking-wider mb-4">Top Issue Types</h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border border-gray-200">
                  <th className="py-2 px-3 text-left font-semibold text-gray-500">Rule</th>
                  <th className="py-2 px-3 text-center font-semibold text-gray-500">Occurrences</th>
                  <th className="py-2 px-3 text-center font-semibold text-gray-500">Pages Affected</th>
                </tr>
              </thead>
              <tbody>
                {topIssues.slice(0, 10).map((issue, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-3 text-gray-700 font-medium capitalize">
                      {(issue.rule_id || '').replace(/-/g, ' ')}
                    </td>
                    <td className="py-2 px-3 text-center text-gray-900 font-semibold">{issue.count}</td>
                    <td className="py-2 px-3 text-center text-gray-500">{issue.affected_pages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Regression / improvement */}
        {(regressionList.length > 0 || improvementList.length > 0) && (
          <section className="mb-8">
            <h2 className="text-base font-bold text-gray-700 uppercase tracking-wider mb-4">
              Changes vs Previous Crawl
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {regressionList.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Regressions</p>
                  <div className="space-y-1">
                    {regressionList.slice(0, 7).map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-100 gap-2">
                        <span className="truncate text-gray-600 flex-1" title={r.url}>{r.url}</span>
                        <span className="text-red-600 font-semibold flex-shrink-0">+{r.delta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {improvementList.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2">Improvements</p>
                  <div className="space-y-1">
                    {improvementList.slice(0, 7).map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-100 gap-2">
                        <span className="truncate text-gray-600 flex-1" title={r.url}>{r.url}</span>
                        <span className="text-green-600 font-semibold flex-shrink-0">{r.delta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <p className="text-[10px] text-gray-400">
            This report was generated by ADA Accessibility Monitor using axe-core (WCAG 2.1 A/AA).
            Automated testing does not cover all accessibility requirements. Manual testing and user research are recommended.
            Crawl ID: <span className="font-mono">{crawlId}</span>
          </p>
        </div>
      </div>

      {/* Print styles injected via style tag */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: white !important; }
        }
      `}</style>
    </main>
  );
}
