const PAGES = [
  { url: '/',        score: 92, issues: 4,  status: 'Passed' },
  { url: '/about',   score: 78, issues: 11, status: 'Review' },
  { url: '/contact', score: 61, issues: 23, status: 'Failed' },
  { url: '/blog',    score: 88, issues: 7,  status: 'Passed' },
];

const STATUS_CLS = {
  Passed: 'text-sage-700 dark:text-sage-300 bg-sage/10',
  Review: 'text-amber-800 dark:text-amber-300 bg-amber-500/10',
  Failed: 'text-coral-700 dark:text-coral-300 bg-coral/10',
};

function scoreColor(s) {
  return s >= 85 ? 'text-sage-700 dark:text-sage-300' : s >= 70 ? 'text-amber-800 dark:text-amber-300' : 'text-coral-700 dark:text-coral-300';
}

export default function CrawlPreview() {
  return (
    <div className="w-full max-w-[420px] bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/10 shadow-soft overflow-hidden select-none">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100 dark:border-white/10">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-500 mb-0.5">Site Crawl Report</p>
          <p className="text-sm font-mono font-semibold text-ink dark:text-white">example.com</p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-teal/10 text-teal px-2.5 py-1 rounded-full text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
          Scanning
        </span>
      </div>

      {/* Progress */}
      <div className="px-5 pt-3 pb-2.5 bg-ivory dark:bg-night/40 border-b border-gray-100 dark:border-white/10">
        <div className="flex items-center justify-between text-[10px] text-body dark:text-gray-500 mb-1.5">
          <span>4 of 12 pages analyzed</span>
          <span>33%</span>
        </div>
        <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-teal" style={{ width: '33%' }} />
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 dark:border-white/5">
            <th className="text-left px-5 py-2 font-semibold text-[10px] uppercase tracking-wide text-body dark:text-gray-500">Page</th>
            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wide text-body dark:text-gray-500">Score</th>
            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wide text-body dark:text-gray-500">Issues</th>
            <th className="text-right px-5 py-2 font-semibold text-[10px] uppercase tracking-wide text-body dark:text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-white/5">
          {PAGES.map((p) => (
            <tr key={p.url} className="hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors">
              <td className="px-5 py-2.5 font-mono text-ink dark:text-gray-300">{p.url}</td>
              <td className="px-3 py-2.5 text-center">
                <span className={`font-bold ${scoreColor(p.score)}`}>{p.score}</span>
              </td>
              <td className="px-3 py-2.5 text-center text-body dark:text-gray-400">{p.issues}</td>
              <td className="px-5 py-2.5 text-right">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[p.status]}`}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
