import React, { useState } from 'react'
import { Eye, EyeOff, Sun, Moon } from 'lucide-react'
import { apiFetch } from '../../utils/api.js'
import ShieldMark from '../components/ShieldMark.jsx'
import { PLATFORM_URL } from '../../config/constants.js'

/**
 * Extension login page.
 *
 * Mirrors the structure and styling of src/pages/LoginPage.jsx exactly.
 * Differences:
 *   - No navigate() — extension has no routing; parent Popup.jsx swaps components
 *   - No "Don't have an account?" link (signup happens on the platform)
 *   - Adds "Open platform" link for new users
 */
export default function LoginPage({ dark, toggleDark, onLogin }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await apiFetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data.error === 'email_not_verified') {
          setError('Please verify your email before signing in. Check your inbox.')
        } else {
          setError(data.error || 'Login failed. Please try again.')
        }
        return
      }
      onLogin(data.user, data.token)
    } catch {
      setError('Unable to reach the server. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col bg-ivory dark:bg-night">
      {/* Header — matches web app LoginPage header layout */}
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-charcoal border-b border-gray-100 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <ShieldMark size={26} />
          <div className="leading-tight">
            <span className="block font-heading font-bold text-[14px] text-ink dark:text-white">
              ADA
            </span>
            <span className="block text-[10px] text-body dark:text-gray-500">
              Accessibility Intelligence
            </span>
          </div>
        </div>
        <button
          onClick={toggleDark}
          aria-label="Toggle dark mode"
          className="btn-ghost"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Form */}
      <div className="px-5 py-5">
        <h1 className="font-heading font-bold text-lg text-ink dark:text-white mb-0.5">
          Welcome back
        </h1>
        <p className="text-xs text-body dark:text-gray-400 mb-5">
          Sign in to your ADA account
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div className="rounded-xl bg-coral/10 border border-coral/20 px-3 py-2.5 text-xs text-coral leading-snug">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="ext-email" className="block text-xs font-medium text-ink dark:text-white">
              Email
            </label>
            <input
              id="ext-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input-base text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ext-password" className="block text-xs font-medium text-ink dark:text-white">
              Password
            </label>
            <div className="relative">
              <input
                id="ext-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-base text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-ink dark:hover:text-white transition-colors"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-primary w-full py-2.5 text-sm"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* Divider */}
        <div className="my-4 border-t border-gray-100 dark:border-white/[0.06]" />

        <p className="text-xs text-body dark:text-gray-400 text-center">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => chrome.tabs.create({ url: `${PLATFORM_URL}/?page=signup` })}
            className="text-teal font-semibold hover:underline focus:outline-none"
          >
            Sign up on platform
          </button>
        </p>
      </div>
    </div>
  )
}
