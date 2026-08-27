import { Search, Play, AlertTriangle } from 'lucide-react';
import GlowInput from '../ui/GlowInput';
import Toggle from './Toggle';

function Divider() {
  return <div className="border-t border-gray-100 dark:border-white/[0.06]" />;
}

export default function SingleScanForm({
  scanUrl,
  onUrlChange,
  includeBestPractices,
  onBestPracticesChange,
  scanPhase,
  scanError,
  onStartScan,
}) {
  return (
    <>
      <section className="pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
          Website URL
        </p>
        <GlowInput
          large
          icon={Search}
          type="url"
          value={scanUrl}
          onChange={e => onUrlChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && scanUrl.trim() && onStartScan()}
          placeholder="https://example.com"
        />
      </section>

      <Divider />

      <section className="pt-2 pb-1">
        <div className="flex items-start justify-between gap-8 py-3 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink dark:text-white">Best Practices</p>
            <p className="text-sm text-body dark:text-gray-400 mt-1 leading-relaxed">
              Includes non-WCAG rules to provide broader accessibility guidance. Issue count may increase.
            </p>
          </div>
          <div className="flex-shrink-0 pt-0.5">
            <Toggle
              id="best-practices"
              checked={includeBestPractices}
              onChange={e => onBestPracticesChange(e.target.checked)}
            />
          </div>
        </div>
      </section>

      {scanPhase === 'failed' && scanError && (
        <div className="flex items-center gap-2.5 bg-coral/10 text-coral px-4 py-3 rounded-xl text-sm mb-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {scanError}
        </div>
      )}

      <Divider />

      <div className="pt-4">
        <button
          onClick={onStartScan}
          disabled={!scanUrl.trim()}
          className="btn-primary w-full justify-center py-4 text-base font-semibold"
        >
          <Play className="w-5 h-5" />
          Start Scan
        </button>
      </div>
    </>
  );
}
