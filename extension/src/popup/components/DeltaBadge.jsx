import React from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

/**
 * Shows the violation delta versus the previous scan for the same URL.
 * Mirrors the delta indicators in DashboardPage.jsx KpiCard.
 *
 * Props:
 *   currentCount  — number of violations in the just-completed scan
 *   prevCount     — number of violations in the previous scan (null if no prior scan)
 */
export default function DeltaBadge({ currentCount, prevCount }) {
  if (prevCount == null) return null

  const delta = currentCount - prevCount

  if (delta === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-body dark:text-gray-400 fade-in">
        <Minus className="w-3.5 h-3.5" />
        <span>No change from last scan</span>
      </div>
    )
  }

  if (delta > 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-coral font-medium fade-in">
        <TrendingUp className="w-3.5 h-3.5" />
        <span>+{delta} new issue{delta !== 1 ? 's' : ''} since last scan</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium fade-in" style={{ color: '#6BA368' }}>
      <TrendingDown className="w-3.5 h-3.5" />
      <span>{Math.abs(delta)} issue{Math.abs(delta) !== 1 ? 's' : ''} fixed since last scan</span>
    </div>
  )
}
