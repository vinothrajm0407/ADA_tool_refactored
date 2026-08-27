import React, { useEffect, useState } from 'react';
import { Sun, Moon, CheckCircle, XCircle, Loader } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import { useApp } from '../context/AppContext';

export default function VerifyEmailPage({ dark, toggleDark }) {
  const { navigate, login, postAuthRedirect, setPostAuthRedirect } = useApp();

  const [status, setStatus]     = useState('verifying'); // 'verifying' | 'success' | 'expired' | 'invalid'
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent]   = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');

    if (!token) {
      setStatus('invalid');
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          login(data.user, data.token);
          setStatus('success');
          const target = postAuthRedirect || 'dashboard';
          setPostAuthRedirect(null);
          setTimeout(() => navigate(target), 1500);
        } else if (data.error === 'token_invalid') {
          setStatus('invalid');
        } else {
          setStatus('expired');
        }
      })
      .catch(() => setStatus('invalid'));
  }, []);

  async function handleResend(e) {
    e.preventDefault();
    if (!resendEmail.trim()) return;
    setResendLoading(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: resendEmail.trim() }),
      });
      setResendSent(true);
    } catch {
      setResendSent(true); // show success regardless to prevent enumeration
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className={`${dark ? 'dark' : ''} min-h-screen bg-ivory dark:bg-night flex flex-col`}>
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
          <div className="card p-8 text-center">

            {status === 'verifying' && (
              <>
                <Loader className="w-10 h-10 text-teal mx-auto mb-4 animate-spin" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Verifying your email…</h1>
                <p className="text-sm text-body dark:text-gray-400">Just a moment.</p>
              </>
            )}

            {status === 'success' && (
              <>
                <CheckCircle className="w-10 h-10 text-teal mx-auto mb-4" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Email verified!</h1>
                <p className="text-sm text-body dark:text-gray-400">Taking you to your dashboard…</p>
              </>
            )}

            {status === 'expired' && (
              <>
                <XCircle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Link expired</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-6">
                  This verification link has expired. Enter your email below and we'll send a fresh one.
                </p>
                {resendSent ? (
                  <div className="rounded-xl bg-teal/10 border border-teal/20 px-4 py-3 text-sm text-teal">
                    A new verification link has been sent — check your inbox.
                  </div>
                ) : (
                  <form onSubmit={handleResend} className="space-y-3 text-left">
                    <input
                      type="email"
                      required
                      value={resendEmail}
                      onChange={e => setResendEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
                    />
                    <button
                      type="submit"
                      disabled={resendLoading}
                      className="btn-primary w-full py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {resendLoading ? 'Sending…' : 'Resend verification email'}
                    </button>
                  </form>
                )}
              </>
            )}

            {status === 'invalid' && (
              <>
                <XCircle className="w-10 h-10 text-coral mx-auto mb-4" />
                <h1 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Invalid link</h1>
                <p className="text-sm text-body dark:text-gray-400 mb-6">
                  This verification link is not valid. It may have already been used.
                </p>
                <button
                  onClick={() => navigate('login')}
                  className="btn-primary w-full py-2.5"
                >
                  Back to sign in
                </button>
              </>
            )}

            {(status === 'expired' || status === 'invalid') && (
              <p className="mt-5 text-center text-sm text-body dark:text-gray-400">
                <button
                  onClick={() => navigate('login')}
                  className="text-teal font-semibold hover:underline focus:outline-none"
                >
                  Back to sign in
                </button>
              </p>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
