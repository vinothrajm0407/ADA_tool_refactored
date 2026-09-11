import { StatusPill } from './StatusBadge';

export function IssueCard({ title, detail, severity, wcag, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-ivory border border-gray-200 rounded-2xl p-4 cursor-pointer hover:border-teal/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          {wcag && (
            <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">
              {wcag}
            </span>
          )}
        </div>
        <StatusPill severity={severity} />
      </div>
      {title && (
        <p className="font-heading font-semibold text-ink text-sm mt-2">
          {title}
        </p>
      )}
      {detail && (
        <p className="text-xs text-body mt-1 line-clamp-2">
          {detail}
        </p>
      )}
    </button>
  );
}

export default IssueCard;
