import React from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { PLATFORM_URL } from '../../config/constants.js'

/**
 * Sticky footer shown after a scan completes.
 *
 * "View full report" opens the platform scan-history page.
 * If the user is authenticated in the extension, the JWT is passed via
 * _ext_auth so the web app can log in automatically without showing the
 * login screen. The token is URL-encoded JSON — the web app reads it,
 * stores it in sessionStorage, and cleans the URL.
 */
export default function FooterActions({ onRescan, auth }) {
  function openDashboard() {
    let url = `${PLATFORM_URL}/scan-history`

    if (auth?.token) {
      const payload = encodeURIComponent(
        JSON.stringify({ token: auth.token, user: auth.user })
      )
      url = `${PLATFORM_URL}/?_ext_auth=${payload}&_ext_page=scan-history`
    }

    chrome.tabs.create({ url })
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-white/[0.06] bg-white dark:bg-charcoal flex-shrink-0">
      <button
        onClick={openDashboard}
        className="btn-primary flex-1 py-2 text-xs gap-1.5"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        View full report
      </button>
      <button
        onClick={onRescan}
        className="btn-secondary py-2 px-3 text-xs gap-1.5"
        aria-label="Scan again"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Re-scan
      </button>
    </div>
  )
}
