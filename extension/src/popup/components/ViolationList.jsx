import React from 'react'
import { IMPACT_ORDER, MAX_VIOLATIONS_SHOWN } from '../../config/constants.js'
import ViolationItem from './ViolationItem.jsx'

/**
 * Scrollable violation list — capped at MAX_VIOLATIONS_SHOWN (10) items.
 * Grouped by impact (critical first) to match ADAResultsView.jsx IMPACT_ORDER.
 * Full list is always available in the platform dashboard.
 */
export default function ViolationList({ violations }) {
  if (!violations.length) return null

  // Sort: critical → serious → moderate → minor (matches platform sort order)
  const sorted = [...violations].sort((a, b) => {
    const ai = IMPACT_ORDER.indexOf(a.impact)
    const bi = IMPACT_ORDER.indexOf(b.impact)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const shown   = sorted.slice(0, MAX_VIOLATIONS_SHOWN)
  const hidden  = sorted.length - shown.length

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink dark:text-white">
          Violations
        </p>
        <p className="text-[10px] text-body dark:text-gray-500">
          {violations.length} rule{violations.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-1.5">
        {shown.map((v, i) => (
          <ViolationItem key={v.id ?? i} violation={v} />
        ))}
      </div>

      {hidden > 0 && (
        <p className="text-[10px] text-body dark:text-gray-500 text-center mt-2">
          + {hidden} more — view all in the full report
        </p>
      )}
    </div>
  )
}
