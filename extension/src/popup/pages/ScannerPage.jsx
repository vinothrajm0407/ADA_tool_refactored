import React, { useState, useEffect, useCallback } from 'react'
import { Sun, Moon, LogOut } from 'lucide-react'
import { apiFetch } from '../../utils/api.js'
import { formatUrl } from '../../utils/format.js'
import ShieldMark       from '../components/ShieldMark.jsx'
import ScanButton       from '../components/ScanButton.jsx'
import ScanProgress     from '../components/ScanProgress.jsx'
import ImpactSummary    from '../components/ImpactSummary.jsx'
import ViolationList    from '../components/ViolationList.jsx'
import DeltaBadge       from '../components/DeltaBadge.jsx'
import FooterActions    from '../components/FooterActions.jsx'

// Same rule set as the server scan (scripts/run_ada_check_python.py) so results compare.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Main scanner view (shown after login).
 *
 * Phase state machine:
 *   idle      → show ScanButton
 *   scanning  → run axe-core in the active tab, then save via POST /api/scan/import
 *   done      → show ImpactSummary + ViolationList + FooterActions
 *   error     → show error message + retry
 *
 * The scan runs in the user's own browser, on the page they already have open
 * (like axe DevTools), not on our server. Sites behind bot protection
 * (Cloudflare etc.) let a real visitor through but show our server's headless
 * browser a challenge page, so this is how such sites get real results.
 */
export default function ScannerPage({ auth, dark, toggleDark, onLogout }) {
  const [phase,      setPhase]      = useState('idle')
  const [tabUrl,     setTabUrl]     = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [prevCount,  setPrevCount]  = useState(null)
  const [errorMsg,   setErrorMsg]   = useState('')

  // Read current tab URL on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setTabUrl(tabs[0].url)
    })
  }, [])

  // ── Scan trigger ───────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (!tabUrl) return
    setPhase('scanning')
    setErrorMsg('')
    setScanResult(null)
    setPrevCount(null)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      let axeResult = null
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['axe.min.js'] })
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          // Runs inside the page; the JSON round-trip keeps only plain data.
          func: async (tags) => JSON.parse(JSON.stringify(
            await window.axe.run(document, { runOnly: { type: 'tag', values: tags } })
          )),
          args: [WCAG_TAGS],
        })
        axeResult = injection?.result ?? null
      } catch {
        setErrorMsg("This page can't be scanned — browser pages (chrome://) and the Chrome Web Store don't allow extensions.")
        setPhase('error')
        return
      }
      if (!axeResult) {
        setErrorMsg('The scan returned no results. Reload the page and try again.')
        setPhase('error')
        return
      }

      // Visible-area screenshot, same field the server scan uses. Optional.
      try {
        const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 })
        axeResult.screenshot = shot.split(',')[1]
        axeResult.screenshotType = 'image/jpeg'
      } catch { /* scan is still valid without it */ }

      const res  = await apiFetch('/api/scan/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: tabUrl, axeResult }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'The scan ran but could not be saved. Please try again.')
        setPhase('error')
        return
      }

      setScanResult(data.result)
      setPhase('done')

      // Notify background worker to update badge count
      const count = axeResult.violations?.length ?? 0
      chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', violationCount: count })
        .catch(() => {}) // background may not be listening yet — ignore

      // Fetch delta from previous scan (best-effort, non-blocking)
      fetchDelta(tabUrl, count)
    } catch {
      setErrorMsg('Unable to reach the server. Check your connection.')
      setPhase('error')
    }
  }, [tabUrl])

  // ── Delta fetch (non-blocking) ─────────────────────────────────────
  async function fetchDelta(url, currentCount) {
    try {
      const res  = await apiFetch(`/api/history/prev-scan?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!data.ok || !data.scan) return
      const prev = data.scan
      // API may return violationCount directly or a violations array
      const count = prev.violationCount ?? prev.violations?.length ?? null
      if (count != null) setPrevCount(count)
    } catch {
      // Delta is decorative — never block or error for it
    }
  }

  // ── Reset for re-scan ──────────────────────────────────────────────
  const handleRescan = useCallback(() => {
    setPhase('idle')
    setScanResult(null)
    setPrevCount(null)
    setErrorMsg('')
  }, [])

  // ── Compute pass rate from scan result ─────────────────────────────
  const passRate = React.useMemo(() => {
    if (!scanResult) return null
    const passes     = scanResult.axeResult?.passes?.length ?? 0
    const violations = scanResult.axeResult?.violations?.length ?? 0
    const total = passes + violations
    if (!total) return null
    return Math.round((passes / total) * 100)
  }, [scanResult])

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col bg-ivory dark:bg-night flex-1 min-h-0">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-charcoal border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldMark size={24} />
          <div className="leading-tight">
            <span className="block font-heading font-bold text-[13px] text-ink dark:text-white">ADA</span>
            <span className="block text-[9px] text-body dark:text-gray-500">Accessibility Intelligence</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={toggleDark} className="btn-ghost" aria-label="Toggle dark mode">
            {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onLogout}
            className="btn-ghost"
            aria-label="Sign out"
            title={`Signed in as ${auth?.user?.email ?? ''}`}
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── URL bar ── */}
      <div className="px-4 py-2 bg-white dark:bg-charcoal border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
        <p
          className="text-[11px] text-body dark:text-gray-400 font-mono truncate"
          title={tabUrl}
        >
          {tabUrl ? formatUrl(tabUrl) : 'Loading tab…'}
        </p>
      </div>

      {/* ── Main content (scrollable) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto popup-scroll px-4 py-4 space-y-3">

        {phase === 'idle' && (
          <ScanButton onClick={handleScan} />
        )}

        {phase === 'scanning' && (
          <ScanProgress />
        )}

        {phase === 'error' && (
          <div className="fade-in">
            <div className="rounded-xl bg-coral/10 border border-coral/20 px-4 py-3">
              <p className="text-sm font-semibold text-coral mb-1">Scan failed</p>
              <p className="text-xs text-coral/80 leading-snug">{errorMsg}</p>
              <button
                onClick={handleRescan}
                className="mt-3 text-xs text-teal font-semibold hover:underline focus:outline-none"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === 'done' && scanResult && (
          <div className="space-y-3 fade-in">
            <DeltaBadge
              currentCount={scanResult.axeResult?.violations?.length ?? 0}
              prevCount={prevCount}
            />
            <ImpactSummary
              violations={scanResult.axeResult?.violations ?? []}
              passRate={passRate}
            />
            <ViolationList violations={scanResult.axeResult?.violations ?? []} />
          </div>
        )}
      </div>

      {/* ── Footer (only after scan completes) ── */}
      {phase === 'done' && (
        <FooterActions onRescan={handleRescan} auth={auth} tabUrl={tabUrl} />
      )}
    </div>
  )
}
