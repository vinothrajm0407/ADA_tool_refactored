import React, { useState } from 'react';
import { Sun, Moon, Mail } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import GlowInput from '../components/ui/GlowInput';
import { useApp } from '../context/AppContext';

export default function ForgotPasswordPage({ dark, toggleDark }) {
  const { navigate } = useApp();

  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // fall through — always show the generic success screen (anti-enumeration)
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className={`${dark ? 'dark' : ''} min-h-screen bg-ivory dark:bg-night flex flex-col`}>
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 bg-white dark:bg-charcoal border-b border-gray-100 dark:border-white/[0.06]">
        <button
          onClick={() => navigate('landing')}
          className="hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-xl"
          aria-label="Go to home"
        >
          <BrandLogo variant="landing" />
        </button>
        <button
          onClick={toggleDark}
          aria-label="Toggle dark mode"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-body dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Form card */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="card p-8">
            {sent ? (
              /* ── Check inbox confirmation ── */
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-7 h-7 text-teal" />
                </div>
                <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-2">Check your inbox</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-1">
                  If an account exists for
                </p>
                <p className="text-sm font-semibold text-ink dark:text-white mb-6 break-all">{email.trim()}</p>
                <p className="text-xs text-body dark:text-gray-500 mb-6">
                  we've sent a password reset link. It expires in 1 hour.
                </p>
                <p className="text-sm text-body dark:text-gray-400">
                  <button
                    onClick={() => navigate('login')}
                    className="text-teal font-semibold hover:underline focus:outline-none"
                  >
                    Back to sign in
                  </button>
                </p>
              </div>
            ) : (
              /* ── Request form ── */
              <>
                <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-1">Forgot password?</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-7">
                  Enter your email and we'll send you a link to reset your password.
                </p>

                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-sm font-medium text-ink dark:text-white">
                      Email
                    </label>
                    <GlowInput
                      id="email"
                      type="email"
                      icon={Mail}
                      autoComplete="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Sending…' : 'Send reset link'}
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-body dark:text-gray-400">
                  Remembered your password?{' '}
                  <button
                    onClick={() => navigate('login')}
                    className="text-teal font-semibold hover:underline focus:outline-none"
                  >
                    Sign in
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
