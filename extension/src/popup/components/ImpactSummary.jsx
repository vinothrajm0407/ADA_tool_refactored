import React from 'react'
import { IMPACT_ORDER, IMPACT_CONFIG } from '../../config/constants.js'

/**
 * Four impact-level summary pills.
 * Mirrors the severity breakdown in ADAResultsView.jsx buildSeverityBreakdown().
 *
 * Counts violations (rules) per impact level — the same metric shown in the
 * platform's result header. Each violation can affect multiple nodes; the full
 * node count is visible in the platform's detailed view.
 */
function buildImpactCounts(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of violations) {
    if (v.impact in counts) counts[v.impact]++
  }
  return counts
}

function ScoreBadge({ passRate }) {
  const color = passRate >= 80 ? '#6BA368' : passRate >= 60 ? '#F59E0B' : '#E76F51'
  return (
    <div className="flex items-center gap-2 mb-3 fade-in">
      <span className="font-heading font-bold text-2xl" style={{ color }}>
        {passRate}%
      </span>
      <span className="text-xs text-body dark:text-gray-400">accessibility score</span>
    </div>
  )
}

export default function ImpactSummary({ violations, passRate }) {
  const counts = buildImpactCounts(violations)
  const total  = violations.length

  return (
    <div className="fade-in">
      {passRate != null && <ScoreBadge passRate={passRate} />}

      {total === 0 ? (
        <div className="rounded-xl border border-sage/30 bg-sage/10 px-4 py-3 flex items-center gap-2">
          <span className="text-sage text-lg">✓</span>
          <p className="text-sm font-semibold text-ink dark:text-white">
            No violations found
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {IMPACT_ORDER.map(impact => {
            const cfg   = IMPACT_CONFIG[impact]
            const count = counts[impact]
            return (
              <div
                key={impact}
                className={`impact-pill ${cfg.bg} ${cfg.text} ${cfg.border}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="font-bold">{count}</span>
                <span className="font-normal opacity-80">{cfg.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
