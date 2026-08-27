import React from 'react'
import { Loader } from 'lucide-react'

/**
 * Animated scanning state — shown while POST /api/scan + polling is in progress.
 * Uses the same teal accent as the web app's scan progress indicator.
 */
export default function ScanProgress() {
  return (
    <div className="flex flex-col items-center justify-center py-6 fade-in">
      <Loader className="w-6 h-6 text-teal animate-spin mb-3" />
      <p className="text-sm font-medium text-ink dark:text-white mb-1">
        Scanning for issues…
      </p>
      <p className="text-xs text-body dark:text-gray-400 mb-4">
        Running axe-core accessibility checks
      </p>

      {/* Indeterminate progress bar */}
      <div className="w-full h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
        <div className="h-full w-1/2 bg-teal rounded-full scan-progress-bar" />
      </div>
    </div>
  )
}
