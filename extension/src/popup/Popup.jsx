import React, { useState, useEffect } from 'react'
import { Loader } from 'lucide-react'
import { apiFetch, setToken, clearToken } from '../utils/api.js'
import { AUTH_KEY, DARK_KEY } from '../config/constants.js'
import LoginPage from './pages/LoginPage.jsx'
import ScannerPage from './pages/ScannerPage.jsx'

/**
 * Popup root.
 *
 * State machine:
 *   'checking' → reading chrome.storage.local + validating token
 *   'login'    → no valid session, show login form
 *   'scanner'  → valid session, show scanner UI
 *
 * Auth storage: chrome.storage.local['ada_auth'] = JSON.stringify({ token, user })
 * Matches the AUTH_KEY ('ada_auth') used by the web app's sessionStorage.
 */
export default function Popup() {
  const [phase, setPhase]   = useState('checking') // 'checking' | 'login' | 'scanner'
  const [auth, setAuth]     = useState(null)        // { token, user } | null
  const [dark, setDark]     = useState(false)

  useEffect(() => {
    chrome.storage.local.get([AUTH_KEY, DARK_KEY], async (result) => {
      // Restore dark mode preference (falls back to system preference)
      const darkPref = result[DARK_KEY] ?? window.matchMedia('(prefers-color-scheme: dark)').matches
      setDark(darkPref)

      const raw = result[AUTH_KEY]
      if (!raw) {
        setPhase('login')
        return
      }

      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        chrome.storage.local.remove(AUTH_KEY)
        setPhase('login')
        return
      }

      const { token, user } = parsed
      if (!token) {
        setPhase('login')
        return
      }

      // Validate token against the platform (same as web app on-load check)
      setToken(token)
      try {
        const res = await apiFetch('/api/auth/me')
        if (res.ok) {
          setAuth({ token, user })
          setPhase('scanner')
        } else {
          clearToken()
          chrome.storage.local.remove(AUTH_KEY)
          setPhase('login')
        }
      } catch {
        // Network error: allow offline use with cached token rather than logging out
        setAuth({ token, user })
        setPhase('scanner')
      }
    })
  }, [])

  function handleLogin(user, token) {
    setToken(token)
    chrome.storage.local.set({ [AUTH_KEY]: JSON.stringify({ token, user }) })
    setAuth({ token, user })
    setPhase('scanner')
  }

  function handleLogout() {
    clearToken()
    chrome.storage.local.remove(AUTH_KEY)
    setAuth(null)
    setPhase('login')
  }

  function toggleDark() {
    setDark(prev => {
      const next = !prev
      chrome.storage.local.set({ [DARK_KEY]: next })
      return next
    })
  }

  // ── Render ──────────────────────────────────────────────────────────
  if (phase === 'checking') {
    return (
      <div className={`${dark ? 'dark' : ''}`}>
        <div className="flex items-center justify-center h-32 bg-ivory dark:bg-night">
          <Loader className="w-5 h-5 text-teal animate-spin" />
        </div>
      </div>
    )
  }

  if (phase === 'login') {
    return (
      <div className={`${dark ? 'dark' : ''}`}>
        <LoginPage dark={dark} toggleDark={toggleDark} onLogin={handleLogin} />
      </div>
    )
  }

  return (
    <div className={`${dark ? 'dark' : ''} flex flex-col flex-1 min-h-0`}>
      <ScannerPage
        auth={auth}
        dark={dark}
        toggleDark={toggleDark}
        onLogout={handleLogout}
      />
    </div>
  )
}
