export default function AIFixPreview() {
  return (
    <div className="w-full max-w-[480px] bg-white rounded-2xl border border-gray-100 overflow-hidden select-none">
      {/* Issue bar */}
      <div className="px-5 py-3.5 flex items-start gap-3 border-b border-gray-100">
        <div className="mt-1 w-2 h-2 rounded-full bg-coral flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink leading-tight">Missing alt attribute</p>
          <p className="text-xs text-body mt-0.5">
            <span className="font-mono">image-alt</span>
            {' · '}WCAG 1.1.1 Non-text Content{' · '}
            <span className="font-semibold text-coral-700">Critical</span>
          </p>
        </div>
        <span className="flex-shrink-0 text-[10px] font-semibold text-sage-700 bg-sage/10 px-2 py-0.5 rounded-full mt-0.5 whitespace-nowrap">
          Fix ready
        </span>
      </div>

      {/* Code columns */}
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        {/* Before */}
        <div>
          <div className="px-4 py-1.5 bg-coral/[0.06] border-b border-gray-100">
            <span className="text-[10px] font-bold uppercase tracking-wide text-coral-700">Before</span>
          </div>
          <pre className="px-4 py-4 text-xs font-mono leading-relaxed text-body overflow-hidden whitespace-pre">{`<img
  src="hero.jpg"
  width="800"
/>`}</pre>
        </div>

        {/* After */}
        <div>
          <div className="px-4 py-1.5 bg-sage/[0.06] border-b border-gray-100">
            <span className="text-[10px] font-bold uppercase tracking-wide text-sage-700">AI Fix</span>
          </div>
          <pre className="px-4 py-4 text-xs font-mono leading-relaxed text-body overflow-hidden whitespace-pre">{`<img
  src="hero.jpg"
  width="800"
  alt="Dashboard
  showing WCAG
  compliance score"
/>`}</pre>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-ivory border-t border-gray-100">
        <p className="text-xs text-body mb-2 leading-relaxed">
          Screen readers need descriptive text to convey image purpose to users who cannot see it.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-body">Available for</span>
          {['HTML', 'React', 'Vue'].map((f) => (
            <span
              key={f}
              className="text-[10px] font-semibold text-ink bg-white border border-gray-200 px-1.5 py-0.5 rounded"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
