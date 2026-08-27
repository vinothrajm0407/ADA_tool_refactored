export default function ScanProgress({ url, bare = false }) {
  const inner = (
    <div className="p-8 flex flex-col items-center gap-5">
      <div className="scan-loader-wrapper w-full bg-ivory dark:bg-night/50">
        <div className="loader">
          <span><span></span><span></span><span></span><span></span></span>
          <div className="base">
            <span></span>
            <div className="face"></div>
          </div>
        </div>
        <div className="longfazers">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div className="text-center">
        <p className="font-heading font-semibold text-ink dark:text-white text-lg">Scanning in progress</p>
        {url && <p className="text-sm text-body dark:text-gray-400 mt-1 font-mono break-all max-w-lg mx-auto">{url}</p>}
        <p className="text-xs text-body dark:text-gray-500 mt-2">This may take 1–2 minutes</p>
      </div>
    </div>
  );

  if (bare) return inner;

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
      {inner}
    </div>
  );
}
