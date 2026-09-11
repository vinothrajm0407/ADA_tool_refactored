import { ShieldCheck, ArrowRight, AlertTriangle, Upload, Lock } from 'lucide-react';
import Toggle from './Toggle';

function Divider() {
  return <div className="border-t border-gray-100"/>;
}

export default function SingleScanForm({
  scanUrl,
  onUrlChange,
  includeBestPractices,
  onBestPracticesChange,
  scanPhase,
  scanError,
  onStartScan,
  onUploadClick,
  hideUrlField,
}) {
  return (
    <>
      {!hideUrlField && (
        <>
          <section className="pb-3">
            <label htmlFor="scan-url" className="text-sm font-semibold text-ink mb-1 block">
              Website URL <span className="text-coral">*</span>
            </label>
            <input
              id="scan-url"
              type="url"
              value={scanUrl}
              onChange={e => onUrlChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scanUrl.trim() && onStartScan()}
              placeholder="https://example.com"
              className="w-full border-2 border-teal rounded-lg px-4 py-2.5 text-sm text-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal/20 focus:ring-offset-1 transition-shadow"
            />
          </section>

          <Divider />
        </>
      )}

      <section className="pt-2 pb-1">
        <div className="flex items-start justify-between gap-8 py-3 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p id="best-practices-label"className="text-sm font-semibold text-ink">Best Practices</p>
            <p className="text-sm text-body mt-1 leading-relaxed">
              Includes non-WCAG rules to provide broader accessibility guidance. Issue count may increase.
            </p>
          </div>
          <div className="flex-shrink-0 pt-0.5">
            <Toggle
              id="best-practices"
              checked={includeBestPractices}
              onChange={e => onBestPracticesChange(e.target.checked)}
              ariaLabelledBy="best-practices-label"
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
        <div className="flex items-center gap-3">
          <button
            onClick={onStartScan}
            disabled={!scanUrl.trim()}
            className="btn-primary flex-1 justify-center py-2.5 text-sm font-semibold"
          >
            <ShieldCheck className="w-4 h-4" />
            Run audit
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          {onUploadClick && (
            <button
              type="button"
              onClick={onUploadClick}
              className="btn-secondary py-2.5 text-sm whitespace-nowrap"
            >
              <Upload size={14} /> Upload JSON results
            </button>
          )}
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-body mt-3">
          <Lock size={12} className="text-gray-400" />
          Your data is secure and never shared with third parties.
        </p>
      </div>
    </>
  );
}
