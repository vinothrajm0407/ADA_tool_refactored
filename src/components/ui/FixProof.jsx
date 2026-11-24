import { useRef } from 'react';
import { Volume2, X } from 'lucide-react';

// Re-scan proof for one Auto-Fix: before/after screenshots + what a screen
// reader announces (see backend/services/fix_proof.py).
function Side({ label, shot, announce }) {
  const dlg = useRef(null);
  const src = `data:image/jpeg;base64,${shot}`;
  return (
    <figure className="m-0 flex flex-col gap-1.5 min-w-0">
      <figcaption className="text-[10.5px] font-semibold uppercase tracking-wide text-body">{label}</figcaption>
      {shot ? (
        <>
          <button type="button" onClick={() => dlg.current?.showModal()} title="Click to enlarge"
            className="p-0 border-0 bg-transparent cursor-zoom-in">
            <img src={src} alt={`${label}: screenshot of the element (click to enlarge)`}
              className="w-full rounded-md border border-gray-200 bg-white" />
          </button>
          {/* Native modal: Esc, focus trap and backdrop for free. Click anywhere closes it. */}
          <dialog ref={dlg} aria-label={`${label} screenshot`}
            onClick={() => dlg.current?.close()}
            onKeyDown={e => e.key === 'Escape' && e.stopPropagation()}
            className="p-0 border-0 bg-transparent max-w-[95vw] max-h-[95vh] backdrop:bg-black/80">
            <div className="relative">
              <span className="absolute top-2 left-2 text-xs font-semibold uppercase bg-white/90 text-ink px-2 py-0.5 rounded">{label}</span>
              <button type="button" aria-label="Close" autoFocus
                className="absolute top-2 right-2 bg-white/90 rounded-full p-1 border-0 cursor-pointer">
                <X size={16} />
              </button>
              <img src={src} alt={`${label}: screenshot of the element`}
                className="block w-[min(95vw,1400px)] h-auto max-h-[95vh] object-contain bg-white rounded-md" />
            </div>
          </dialog>
        </>
      ) : (
        <div className="text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-md p-3">Screenshot unavailable</div>
      )}
      <p className="m-0 flex items-start gap-1.5 text-[11.5px] text-ink">
        <Volume2 size={12} className="text-teal flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span><span className="sr-only">Screen reader announces: </span>{announce || '—'}</span>
      </p>
    </figure>
  );
}

export default function FixProof({ proof }) {
  if (!proof) return null;
  return (
    <section aria-label="Fix proof" className="flex flex-col gap-2 border border-gray-100 rounded-lg p-3 bg-white">
      <p className="m-0 text-[11.5px] font-semibold text-sage">{proof.rescan || 'Re-scanned after the fix'}</p>
      {(proof.help || proof.issue) && (
        <p className="m-0 text-[11.5px] text-ink">
          <span className="font-semibold">Issue found: </span>{proof.help}{proof.issue && ` — ${proof.issue}`}
        </p>
      )}
      {proof.selector && (
        <p className="m-0 text-[11px] text-body">
          <span className="font-semibold">Exact spot: </span><code className="font-mono bg-gray-100 px-1 rounded break-all">{proof.selector}</code>
        </p>
      )}
      {proof.element_html && (
        <pre className="m-0 text-[10.5px] font-mono bg-gray-50 border border-gray-100 rounded p-2 whitespace-pre-wrap break-all">{proof.element_html}</pre>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Side label="Before" shot={proof.before_screenshot} announce={proof.before_announce} />
        <Side label="After" shot={proof.after_screenshot} announce={proof.after_announce} />
      </div>
      <p className="m-0 text-[10.5px] text-gray-400">Red box = the failing element, green box = the same element after the fix. Speaker line = what NVDA, JAWS and VoiceOver announce (from the accessibility tree).</p>
    </section>
  );
}
