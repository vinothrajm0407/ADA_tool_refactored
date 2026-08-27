export default function ScreenshotModal({ src, title, onClose }) {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6"
      role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60" />
      <div className="relative bg-white dark:bg-charcoal rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
          <h3 className="m-0 text-base font-semibold text-ink dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 p-0 border-none bg-transparent text-2xl leading-none text-body dark:text-gray-400 cursor-pointer rounded-lg hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-ink dark:hover:text-white transition-colors">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 pb-4 pt-3 flex justify-center items-start min-h-0">
          <img src={src} alt={title} className="w-full h-auto max-w-full block rounded-lg object-contain" />
        </div>
      </div>
    </div>
  );
}
