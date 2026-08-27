import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { IMPACT_CONFIG } from '../../config/constants.js'

/**
 * Single violation row — collapsible accordion.
 * Mirrors ADAResultsView.jsx violation list item structure and color coding.
 *
 * Shows: rule description, WCAG criterion, node count, impact badge.
 * Expanded: full description text.
 */
export default function ViolationItem({ violation }) {
  const [expanded, setExpanded] = useState(false)

  const { id, impact, description, help, nodes = [], tags = [] } = violation
  const cfg       = IMPACT_CONFIG[impact] ?? IMPACT_CONFIG.minor
  const nodeCount = nodes.length
  const wcagTag   = tags.find(t => t.startsWith('wcag') && t.includes('.')) ?? ''
  const wcagLabel = wcagTag.replace('wcag', 'WCAG ').toUpperCase()

  return (
    <div className="violation-row">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] rounded-xl transition-colors"
        aria-expanded={expanded}
      >
        {/* Impact dot */}
        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-ink dark:text-white leading-snug truncate">
            {help || id}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`text-[10px] font-medium ${cfg.text}`}>
              {cfg.label}
            </span>
            {wcagLabel && (
              <>
                <span className="text-gray-300 dark:text-white/20">·</span>
                <span className="text-[10px] text-body dark:text-gray-500">
                  {wcagLabel}
                </span>
              </>
            )}
            <span className="text-gray-300 dark:text-white/20">·</span>
            <span className="text-[10px] text-body dark:text-gray-500">
              {nodeCount} element{nodeCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <span className="flex-shrink-0 text-gray-400 mt-0.5">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* Expanded description */}
      {expanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="ml-4 pl-2.5 border-l-2 border-gray-100 dark:border-white/10">
            <p className="text-[11px] text-body dark:text-gray-400 leading-relaxed">
              {description}
            </p>
            {nodes[0]?.target?.[0] && (
              <code className="block mt-1.5 text-[10px] bg-gray-50 dark:bg-night px-2 py-1 rounded-lg text-body dark:text-gray-400 truncate font-mono">
                {nodes[0].target[0]}
              </code>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
