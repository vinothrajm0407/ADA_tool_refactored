import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Sun, Moon, LogOut, AlertTriangle } from 'lucide-react'
import { apiFetch } from '../../utils/api.js'
import { formatUrl } from '../../utils/format.js'
import {
  POLL_INTERVAL_MS,
  RATE_LIMIT_SECS,
} from '../../config/constants.js'
import ShieldMark       from '../components/ShieldMark.jsx'
import ScanButton       from '../components/ScanButton.jsx'
import ScanProgress     from '../components/ScanProgress.jsx'
import ImpactSummary    from '../components/ImpactSummary.jsx'
import ViolationList    from '../components/ViolationList.jsx'
import DeltaBadge       from '../components/DeltaBadge.jsx'
import FooterActions    from '../components/FooterActions.jsx'

/**
 * Main scanner view (shown after login).
 *
 * Phase state machine:
 *   idle         → show ScanButton
 *   scanning     → show ScanProgress (POST /api/scan + polling GET /api/scan/<id>)
 *   done         → show ImpactSummary + ViolationList + FooterActions
 *   error        → show error message + retry
 *   rate_limited → show countdown timer (15s, matches Flask SCAN_RATE_LIMIT_SECONDS)
 *
 * Mirrors NewScanPage.jsx scan logic: same endpoints, same poll interval,
 * same error detection pattern.
 */
export default function ScannerPage({ auth, dark, toggleDark, onLogout }) {
  const [phase,      setPhase]      = useState('idle')
  const [tabUrl,     setTabUrl]     = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [prevCount,  setPrevCount]  = useState(null)
  const [jobId,      setJobId]      = useState(null)
  const [errorMsg,   setErrorMsg]   = useState('')
  const [cooldown,   setCooldown]   = useState(0)

  const pollRef     = useRef(null)
  const cooldownRef = useRef(null)

  // Read current tab URL on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setTabUrl(tabs[0].url)
    })
    return () => {
      clearInterval(pollRef.current)
      clearInterval(cooldownRef.current)
    }
  }, [])

  // ── Cooldown counter (rate limit) ──────────────────────────────────
  const startCooldown = useCallback((secs = RATE_LIMIT_SECS) => {
    setCooldown(secs)
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current)
          setPhase('idle')
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  // ── Scan trigger ───────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (!tabUrl) return
    clearInterval(pollRef.current)

    setPhase('scanning')
    setErrorMsg('')
    setScanResult(null)
    setPrevCount(null)
    setJobId(null)

    try {
      const res  = await apiFetch('/api/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: tabUrl, includeBestPractices: false }),
      })

      // Rate limited — Flask returns 429 with retry_after header
      if (res.status === 429) {
        const data        = await res.json().catch(() => ({}))
        const retryAfter  = parseInt(res.headers.get('Retry-After') ?? '') || RATE_LIMIT_SECS
        setPhase('rate_limited')
        startCooldown(retryAfter)
        return
      }

      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Scan could not be started. Please try again.')
        setPhase('error')
        return
      }

      const id = data.jobId
      setJobId(id)

      // Poll — identical interval to NewScanPage.jsx pollScan()
      pollRef.current = setInterval(async () => {
        try {
          const pollRes  = await apiFetch(`/api/scan/${id}`)
          const pollData = await pollRes.json()
          const status   = pollData.job?.status

          if (status === 'completed') {
            clearInterval(pollRef.current)
            const result = pollData.job?.result ?? null
            setScanResult(result)
            setPhase('done')

            // Notify background worker to update badge count
            const count = result?.axeResult?.violations?.length ?? 0
            chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', violationCount: count })
              .catch(() => {}) // background may not be listening yet — ignore

            // Fetch delta from previous scan (best-effort, non-blocking)
            fetchDelta(tabUrl, count)

          } else if (status === 'failed') {
            clearInterval(pollRef.current)
            setErrorMsg('The scan failed on the server. Please try again.')
            setPhase('error')
          }
          // queued / started → keep polling
        } catch {
          // Network hiccup during polling — keep trying silently
        }
      }, POLL_INTERVAL_MS)

    } catch {
      setErrorMsg('Unable to reach the server. Check your connection.')
      setPhase('error')
    }
  }, [tabUrl, startCooldown])

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
    clearInterval(pollRef.current)
    clearInterval(cooldownRef.current)
    setPhase('idle')
    setScanResult(null)
    setPrevCount(null)
    setJobId(null)
    setErrorMsg('')
    setCooldown(0)
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

        {phase === 'rate_limited' && (
          <div className="flex flex-col items-center justify-center py-6 fade-in">
            <AlertTriangle className="w-6 h-6 text-amber mb-2" />
            <p className="text-sm font-semibold text-ink dark:text-white mb-1">
              Rate limited
            </p>
            <p className="text-xs text-body dark:text-gray-400 text-center">
              Please wait <span className="font-bold text-ink dark:text-white">{cooldown}s</span> before scanning again.
            </p>
          </div>
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
