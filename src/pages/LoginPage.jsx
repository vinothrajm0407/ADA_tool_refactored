import React, { useState } from 'react';
import { Sun, Moon, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import GlowInput from '../components/ui/GlowInput';
import { useApp } from '../context/AppContext';

export default function LoginPage({ dark, toggleDark }) {
  const { navigate, login, postAuthRedirect, setPostAuthRedirect } = useApp();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const [unverified, setUnverified]         = useState(false);
  const [resendLoading, setResendLoading]   = useState(false);
  const [resendSent, setResendSent]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setResendSent(false);
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.error === 'email_not_verified') {
          setUnverified(true);
        } else {
          setError(data.error || 'Login failed. Please try again.');
        }
        return;
      }
      login(data.user, data.token);
      navigate(postAuthRedirect || 'dashboard');
      setPostAuthRedirect(null);
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
      setResendSent(true);
    } catch {
      setResendSent(true);
    } finally {
      setResendLoading(false);
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
            <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-1">Welcome back</h1>
            <p className="text-sm text-body dark:text-gray-400 mb-7">Sign in to your ADA account</p>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {error && (
                <div className="rounded-xl bg-coral/10 border border-coral/20 px-4 py-3 text-sm text-coral">
                  {error}
                </div>
              )}

              {unverified && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                  <p className="font-semibold mb-1">Email not verified</p>
                  <p className="mb-2">Please verify your email before signing in.</p>
                  {resendSent ? (
                    <p className="text-teal font-medium">Verification link sent — check your inbox.</p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendLoading}
                      className="font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-60"
                    >
                      {resendLoading ? 'Sending…' : 'Resend verification email'}
                    </button>
                  )}
                </div>
              )}

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

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-ink dark:text-white">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate('forgot-password')}
                    className="text-xs font-semibold text-teal hover:underline focus:outline-none"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="glow-input-wrapper">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="glow-input has-left-icon pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-ink dark:hover:text-white z-10"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-body dark:text-gray-400">
              Don't have an account?{' '}
              <button
                onClick={() => navigate('signup')}
                className="text-teal font-semibold hover:underline focus:outline-none"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
