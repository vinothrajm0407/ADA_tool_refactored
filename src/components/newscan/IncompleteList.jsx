import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { truncateHtml } from './scanUtils';

const IMPACT_STYLES = {
  critical: { dot: 'bg-coral',      text: 'text-coral-700',    bg: 'bg-coral/10'    },
  serious:  { dot: 'bg-terracotta', text: 'text-terracotta',   bg: 'bg-terracotta/10' },
  moderate: { dot: 'bg-amber',      text: 'text-amber-800',    bg: 'bg-amber/10'    },
  minor:    { dot: 'bg-sage',       text: 'text-sage-700',     bg: 'bg-sage/10'     },
};

function ImpactBadge({ impact }) {
  const style = IMPACT_STYLES[impact] || IMPACT_STYLES.minor;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {impact || 'minor'}
    </span>
  );
}

// One rule's worth of "needs review" items — shows what the rule actually
// checks (description), which WCAG criteria it maps to, and — on demand —
// exactly which elements triggered it and axe's own explanation of why it
// couldn't tell pass from fail on its own (failureSummary), the same detail
// a reviewer needs to actually go look at the page and decide.
function IncompleteRule({ rule }) {
  const [expanded, setExpanded] = useState(false);
  const nodes = rule.nodes || [];
  const wcagTags = (rule.tags || []).filter((t) => /^wcag\d/.test(t));

  return (
    <li className="px-3.5 py-3 bg-amber/5 rounded-lg text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-ink font-semibold">{rule.id}</span>
            <ImpactBadge impact={rule.impact} />
          </div>
          {rule.description && <p className="mt-1 text-body">{rule.description}</p>}
          {wcagTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {wcagTags.map((t) => (
                <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase">{t}</span>
              ))}
            </div>
          )}
        </div>
        <span className="text-gray-400 flex-shrink-0 whitespace-nowrap">{nodes.length} element(s)</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-teal hover:underline bg-transparent border-none p-0 cursor-pointer font-[inherit]"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? 'Hide affected elements' : 'Show affected elements'}
        </button>
        {rule.helpUrl && (
          <a href={rule.helpUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-teal hover:underline">
            Learn more <ExternalLink size={11} />
          </a>
        )}
      </div>

      {expanded && (
        <div className="mt-2.5 flex flex-col gap-2">
          {nodes.map((node, i) => (
            <div key={i} className="bg-white border border-amber/20 rounded-lg p-2.5">
              {node.target && (
                <p className="font-mono text-[11.5px] text-gray-500 mb-1 break-all">{Array.isArray(node.target) ? node.target.join(', ') : node.target}</p>
              )}
              {node.html && (
                <pre className="text-[11.5px] font-mono text-ink bg-ivory rounded p-2 overflow-x-auto whitespace-pre-wrap break-all m-0 mb-1.5">
                  {truncateHtml(node.html, 280)}
                </pre>
              )}
              {node.failureSummary && (
                <p className="text-[12px] text-amber-800 whitespace-pre-line">{node.failureSummary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export default function IncompleteList({ incomplete }) {
  if (!incomplete || incomplete.length === 0) return null;
  return (
    <ul className="list-none mt-3 m-0 p-0 flex flex-col gap-2">
      {incomplete.map((rule) => (
        <IncompleteRule key={rule.id || JSON.stringify(rule)} rule={rule} />
      ))}
    </ul>
  );
}
