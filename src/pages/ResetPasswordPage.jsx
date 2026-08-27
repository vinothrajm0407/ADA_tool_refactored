import React, { useState } from 'react';
import { Sun, Moon, Eye, EyeOff, Lock, CheckCircle, XCircle } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import { useApp } from '../context/AppContext';

export default function ResetPasswordPage({ dark, toggleDark }) {
  const { navigate } = useApp();

  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword]  = useState('');
  const [showPw, setShowPw]                    = useState(false);
  const [error, setError]                      = useState('');
  const [loading, setLoading]                  = useState(false);
  const [status, setStatus]                    = useState('form'); // 'form' | 'success' | 'invalid'

  const token = new URLSearchParams(window.location.search).get('token') || '';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!token) {
      setStatus('invalid');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.error === 'token_invalid') {
          setStatus('invalid');
        } else {
          setError(data.error || 'Could not reset password. Please try again.');
        }
        return;
      }
      setStatus('success');
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
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

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="card p-8">

            {status === 'form' && (
              <>
                <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-1">Reset your password</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-7">Choose a new password for your account.</p>

                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  {error && (
                    <div className="rounded-xl bg-coral/10 border border-coral/20 px-4 py-3 text-sm text-coral">
                      {error}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label htmlFor="password" className="block text-sm font-medium text-ink dark:text-white">
                      New password
                    </label>
                    <div className="glow-input-wrapper">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                      <input
                        id="password"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Min. 8 characters"
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

                  <div className="space-y-1.5">
                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink dark:text-white">
                      Confirm new password
                    </label>
                    <div className="glow-input-wrapper">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                      <input
                        id="confirmPassword"
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="glow-input has-left-icon pr-10"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Resetting…' : 'Reset password'}
                  </button>
                </form>
              </>
            )}

            {status === 'success' && (
              <div className="text-center">
                <CheckCircle className="w-10 h-10 text-teal mx-auto mb-4" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Password reset</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-6">
                  Your password has been updated. You can now sign in with your new password.
                </p>
                <button onClick={() => navigate('login')} className="btn-primary w-full py-2.5">
                  Back to sign in
                </button>
              </div>
            )}

            {status === 'invalid' && (
              <div className="text-center">
                <XCircle className="w-10 h-10 text-coral mx-auto mb-4" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Link expired</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-6">
                  This password reset link is invalid or has expired. Request a new one below.
                </p>
                <button onClick={() => navigate('forgot-password')} className="btn-primary w-full py-2.5">
                  Request new link
                </button>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
