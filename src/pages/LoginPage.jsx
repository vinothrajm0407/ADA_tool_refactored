import React, { useState } from 'react';
import { Sun, Moon, Eye, EyeOff, Mail, Lock, ShieldCheck, Wand2, TrendingUp, ArrowLeft } from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import { useApp } from '../context/AppContext';

/* Pilot: dark/vibrant token system (see design brief), scoped to this page only.
   #198976 primary · #47A191 accent · #071C2A surface · #F7FFFC elevated · #738080 muted */

const PITCH_POINTS = [
  { icon: ShieldCheck, text: 'Full-site crawling and WCAG 2.1/2.2 scoring, not just one page' },
  { icon: Wand2,       text: 'AI-generated fixes in HTML, React, or Vue for every violation' },
  { icon: TrendingUp,  text: 'Sprint-over-sprint trend tracking with regression alerts' },
];

const inputCls =
  'w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-[#D9E3E4] text-[#071C2A] placeholder-[#738080] ' +
  'text-sm outline-none transition-shadow duration-[180ms] focus:ring-2 focus:ring-[#198976] focus:ring-offset-2 focus:border-[#198976]';

export default function LoginPage({ dark, toggleDark }) {
  const { navigate, login, postAuthRedirect, setPostAuthRedirect } = useApp();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [remember, setRemember] = useState(false);
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
      login(data.user, data.token, remember);
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#071C2A] font-body">

      {/* ── LEFT: pitch, on the dark surface ── */}
      <div className="hidden lg:flex relative flex-col justify-between px-14 py-12 overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(55% 50% at 20% 10%, rgba(71,161,145,0.20), transparent 70%),' +
              'radial-gradient(45% 45% at 90% 90%, rgba(25,137,118,0.16), transparent 70%)',
          }}
        />

        <button
          onClick={() => navigate('landing')}
          className="relative w-fit rounded-xl transition-opacity duration-[180ms] hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#47A191] focus-visible:ring-offset-2 focus-visible:ring-offset-[#071C2A]"
          aria-label="Go to home"
        >
          <BrandLogo variant="landing" dark />
        </button>

        <div className="relative">
          <span className="bg-[#198976]/15 text-[#47A191] text-[11px] font-bold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 mb-6 w-fit tracking-wide">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            WCAG 2.1 &amp; 2.2 compliance
          </span>

          <h2 className="font-heading font-bold text-white leading-[1.05] tracking-[-0.03em] text-[clamp(2rem,3.4vw,2.6rem)] mb-4 max-w-md">
            Make every page on your site accessible to everyone
          </h2>

          <p className="text-[#738080] text-[13px] leading-[1.65] mb-9 max-w-sm">
            ADA crawls your entire site, scores WCAG compliance, and hands your team
            AI-generated code fixes for every violation it finds.
          </p>

          <ul className="flex flex-col gap-4">
            {PITCH_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-white/5 backdrop-blur-sm flex items-center justify-center flex-shrink-0 border border-white/10">
                  <Icon className="w-4.5 h-4.5 text-[#47A191]" />
                </span>
                <span className="text-[13px] text-[#B7C1C1] leading-[1.65] pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-[#738080]">
          &copy; {new Date().getFullYear()} United Techno. All rights reserved.
        </p>
      </div>

      {/* ── RIGHT: elevated form card on the dark canvas ── */}
      <div className="relative flex flex-col">
        <header className="h-16 flex items-center justify-between px-6 sm:px-12 lg:justify-end">
          <button
            onClick={() => navigate('landing')}
            className="lg:hidden rounded-xl transition-opacity duration-[180ms] hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#47A191]"
            aria-label="Go to home"
          >
            <BrandLogo variant="landing" dark />
          </button>
          <button onClick={toggleDark} aria-label="Toggle dark mode"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[#738080] transition-colors duration-[180ms] hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#47A191]">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 sm:px-12 py-10">
          <div className="w-full max-w-sm">
            <a onClick={() => navigate('landing')}
              className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-medium text-[#738080] transition-colors duration-[180ms] hover:text-white mb-6 cursor-pointer focus:outline-none">
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to home
            </a>

            {/* Elevated card */}
            <div
              className="rounded-[20px] border p-[22px] pb-4"
              style={{
                background: '#F7FFFC',
                borderColor: 'rgba(190,238,227,0.28)',
                boxShadow: '0px 18px 42px 0px rgba(0,0,0,0.18)',
              }}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#198976] mb-3">
                Secure workspace access
              </p>
              <h1 className="font-heading font-bold text-[#071C2A] leading-[1.05] tracking-[-0.03em] text-[clamp(1.75rem,2.6vw,2.1rem)] mb-1.5">
                Welcome back
              </h1>
              <p className="text-[13px] text-[#5A6666] leading-[1.65] mb-7">
                Sign in to review audits, fix issues, and monitor your workspace.
              </p>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {unverified && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                    <p className="font-semibold mb-1">Email not verified</p>
                    <p className="mb-2">Please verify your email before signing in.</p>
                    {resendSent ? (
                      <p className="text-[#198976] font-medium">Verification link sent — check your inbox.</p>
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
                  <label htmlFor="email" className="block text-[13px] font-medium text-[#071C2A]">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#738080] pointer-events-none" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-[13px] font-medium text-[#071C2A]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => navigate('forgot-password')}
                      className="text-[11px] font-semibold text-[#198976] hover:underline focus:outline-none"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#738080] pointer-events-none z-10" />
                    <input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#738080] hover:text-[#071C2A] z-10"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[13px] text-[#5A6666] select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded border-[#D9E3E4] text-[#198976] focus:ring-[#198976]"
                  />
                  Keep me signed in
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-[#198976] text-white font-bold text-[15px] transition-all duration-[180ms] hover:-translate-y-px active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#47A191] focus-visible:ring-offset-2"
                  style={{ boxShadow: '0 0 0 rgba(0,0,0,0)' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0px 12px 24px rgba(25,137,118,0.24)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 0 0 rgba(0,0,0,0)'; }}
                >
                  {loading ? 'Signing in…' : 'Sign in to Dashboard'}
                </button>
              </form>

              <p className="mt-5 text-center text-[13px] text-[#5A6666]">
                New to ADA?{' '}
                <button
                  onClick={() => navigate('signup')}
                  className="text-[#198976] font-semibold hover:underline focus:outline-none"
                >
                  Create an account
                </button>
              </p>
            </div>

            <p className="mt-5 text-[11px] text-[#738080] leading-[1.65] text-center">
              <span className="font-semibold text-white">From first scan to verified fix.</span>{' '}
              One place to understand accessibility health and ship repository-backed fixes.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
