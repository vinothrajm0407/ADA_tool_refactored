// Shared constants — keep in sync with web app conventions.
// AUTH_KEY must match AppContext.jsx's AUTH_KEY ('ada_auth').
// IMPACT_ORDER must match ADAResultsView.jsx's IMPACT_ORDER.

export const AUTH_KEY         = 'ada_auth'
export const DARK_KEY         = 'ada_dark'
export const POLL_INTERVAL_MS = 2500        // matches NewScanPage.jsx polling interval
export const MAX_VIOLATIONS_SHOWN = 10      // cap list in popup (full list in dashboard)
export const RATE_LIMIT_SECS  = 15          // matches Flask SCAN_RATE_LIMIT_SECONDS

// Injected by vite.config.js define block from VITE_PLATFORM_URL env var.
// Falls back to localhost:5000 when not set (development default).
export const PLATFORM_URL = typeof __PLATFORM_URL__ !== 'undefined'
  ? __PLATFORM_URL__
  : 'http://localhost:5000'

// Impact display order: most severe first (matches ADAResultsView.jsx)
export const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

// Impact pill colors (matches ADAResultsView.jsx inline styles)
export const IMPACT_CONFIG = {
  critical: {
    label:  'Critical',
    bg:     'bg-coral/10',
    text:   'text-coral',
    border: 'border-coral/20',
    dot:    'bg-coral',
  },
  serious: {
    label:  'Serious',
    bg:     'bg-terracotta/10',
    text:   'text-terracotta',
    border: 'border-terracotta/20',
    dot:    'bg-terracotta',
  },
  moderate: {
    label:  'Moderate',
    bg:     'bg-amber/10 dark:bg-amber/5',
    text:   'text-amber-700 dark:text-amber-400',
    border: 'border-amber/20',
    dot:    'bg-amber',
  },
  minor: {
    label:  'Minor',
    bg:     'bg-gray-100 dark:bg-white/5',
    text:   'text-body dark:text-gray-400',
    border: 'border-gray-200 dark:border-white/10',
    dot:    'bg-gray-400',
  },
}
