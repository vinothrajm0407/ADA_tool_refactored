import React, { useState } from 'react';
import { Sun, Moon, Eye, EyeOff, Mail, Lock, User } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import GlowInput from '../components/ui/GlowInput';
import { useApp } from '../context/AppContext';

export default function SignupPage({ dark, toggleDark }) {
  const { navigate } = useApp();

  const [firstName, setFirstName]   = useState('');
  const [lastName, setLastName]     = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [registered, setRegistered] = useState(false);

  // Resend state (shown on the confirmation screen)
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Registration failed. Please try again.');
        return;
      }
      setRegistered(true);
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
            {registered ? (
              /* ── Check inbox confirmation ── */
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-7 h-7 text-teal" />
                </div>
                <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-2">Check your inbox</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-1">
                  We sent a verification link to
                </p>
                <p className="text-sm font-semibold text-ink dark:text-white mb-6 break-all">{email.trim()}</p>
                <p className="text-xs text-body dark:text-gray-500 mb-5">
                  Click the link in the email to activate your account. The link expires in 24 hours.
                </p>

                {resendSent ? (
                  <div className="rounded-xl bg-teal/10 border border-teal/20 px-4 py-3 text-sm text-teal">
                    A new verification link has been sent.
                  </div>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={resendLoading}
                    className="text-sm text-teal font-semibold hover:underline focus:outline-none disabled:opacity-60"
                  >
                    {resendLoading ? 'Sending…' : "Didn't receive it? Resend"}
                  </button>
                )}

                <p className="mt-6 text-sm text-body dark:text-gray-400">
                  Already verified?{' '}
                  <button
                    onClick={() => navigate('login')}
                    className="text-teal font-semibold hover:underline focus:outline-none"
                  >
                    Sign in
                  </button>
                </p>
              </div>
            ) : (
              /* ── Registration form ── */
              <>
                <h1 className="font-heading font-bold text-2xl text-ink dark:text-white mb-1">Create your account</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-7">Start using ADA Accessibility Intelligence</p>

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {error && (
                    <div className="rounded-xl bg-coral/10 border border-coral/20 px-4 py-3 text-sm text-coral">
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="firstName" className="block text-sm font-medium text-ink dark:text-white">
                        First name
                      </label>
                      <GlowInput
                        id="firstName"
                        type="text"
                        icon={User}
                        autoComplete="given-name"
                        required
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        placeholder="Jane"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="lastName" className="block text-sm font-medium text-ink dark:text-white">
                        Last name
                      </label>
                      <GlowInput
                        id="lastName"
                        type="text"
                        icon={User}
                        autoComplete="family-name"
                        required
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        placeholder="Smith"
                      />
                    </div>
                  </div>

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
                    <label htmlFor="password" className="block text-sm font-medium text-ink dark:text-white">
                      Password
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

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Creating account…' : 'Create Account'}
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-body dark:text-gray-400">
                  Already have an account?{' '}
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
