/**
 * Background service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Receive SCAN_COMPLETE messages from the popup and update the icon badge.
 *   2. Clear the badge when the active tab changes (stale count on a new page).
 *
 * This file is plain JS (no React, no imports) so it can be copied as-is to
 * dist/ by vite-plugin-static-copy without Vite processing it.
 * The service worker is short-lived in MV3 — it wakes up on messages and
 * goes idle quickly.
 */

const BADGE_RED   = '#E76F51'  // coral — matches platform IMPACT_CONFIG.critical
const BADGE_GREEN = '#6BA368'  // sage  — matches platform --success variable

// ── Message handler ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'SCAN_COMPLETE') return

  const count = typeof msg.violationCount === 'number' ? msg.violationCount : 0

  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) })
    chrome.action.setBadgeBackgroundColor({ color: BADGE_RED })
  } else {
    // Zero violations: green badge with a checkmark-style indicator
    chrome.action.setBadgeText({ text: '✓' })
    chrome.action.setBadgeBackgroundColor({ color: BADGE_GREEN })
  }

  sendResponse({ ok: true })
})

// ── Clear badge when user navigates to a new URL ─────────────────────
// The badge count belongs to the page that was scanned.
// When the user navigates away, the old count is misleading.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id === tabId) {
      chrome.action.setBadgeText({ text: '' })
    }
  })
})
