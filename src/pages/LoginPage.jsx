import React, { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Eye, EyeOff, Lock, Mail, Moon, ShieldCheck, Sparkles, Sun, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';

const features = [
  'Full-site crawling and WCAG 2.1 / 2.2 scoring',
  'AI-generated fixes for every violation',
  'Sprint-over-sprint trend tracking',
];

export default function LoginPage({ dark, toggleDark }) {
  const { navigate, login, postAuthRedirect, setPostAuthRedirect } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setUnverified(false); setResendSent(false); setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.error === 'email_not_verified') setUnverified(true);
        else setError(data.error || 'Login failed. Please try again.');
        return;
      }
      login(data.user, data.token, remember);
      navigate(postAuthRedirect || 'dashboard');
      setPostAuthRedirect(null);
    } catch { setError('Unable to reach the server. Please try again.'); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setResendSent(true);
    } catch { setResendSent(true); }
    finally { setResendLoading(false); }
  }

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="ADA product overview">
        <div className="story-orb story-orb-one" /><div className="story-orb story-orb-two" />
        <header className="story-header">
          <button className="brand-lockup" onClick={() => navigate('landing')} aria-label="Go to home">
            <span className="brand-mark"><ShieldCheck size={21} strokeWidth={2.4} /></span>
            <span><strong>ADA</strong><small>United Techno</small></span>
          </button>
          <span className="compliance-chip"><Check size={12} /> WCAG 2.1 &amp; 2.2 ready</span>
        </header>

        <div className="story-copy">
          <p className="eyebrow light"><Sparkles size={13} /> Accessibility intelligence</p>
          <h1>Make every page<br /><em>work for everyone.</em></h1>
          <p className="story-description">ADA turns accessibility from a last-minute check into a continuous advantage for your product team.</p>
          <ul className="feature-list">
            {features.map((feature) => <li key={feature}><span className="feature-icon"><Check size={14} /></span>{feature}</li>)}
          </ul>
        </div>

        <div className="score-card" aria-label="Accessibility score trend">
          <div className="score-card-top"><div><span className="metric-label">Accessibility score</span><strong>92</strong></div><div className="trend-copy"><span>Trend</span><b><TrendingUp size={13} /> Improving</b></div></div>
          <div className="chart-wrap"><svg viewBox="0 0 300 90" role="img" aria-label="Score increased from 63 to 92"><path className="chart-grid" d="M0 72H300M0 48H300M0 24H300" /><path className="chart-area" d="M0 70 L60 57 L120 48 L180 34 L240 22 L300 11 L300 90 L0 90Z" /><path className="chart-line" d="M0 70 L60 57 L120 48 L180 34 L240 22 L300 11" /><circle cx="300" cy="11" r="5" className="chart-dot" /><rect x="273" y="0" width="27" height="18" rx="5" className="chart-badge" /><text x="286.5" y="12.5" textAnchor="middle">92</text></svg></div>
          <div className="score-footer"><span>Site-wide score across 6 development sprints</span><ArrowUpRight size={15} /></div>
        </div>
        <p className="story-footer">© 2026 United Techno <span>•</span> Built for teams who care about every user.</p>
      </section>

      <section className="auth-panel">
        <button className="theme-toggle" onClick={toggleDark} aria-label="Toggle dark mode">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        <div className="form-wrap">
          <button className="back-link" onClick={() => navigate('landing')}><ArrowLeft size={14} /> Back to home</button>
          <p className="eyebrow">Secure workspace access</p>
          <h2>Welcome back<span>.</span></h2>
          <p className="form-intro">Sign in to review audits, fix issues, and keep your team moving forward.</p>
          <form onSubmit={handleSubmit} noValidate>
            {error && <div className="form-alert error" role="alert">{error}</div>}
            {unverified && <div className="form-alert warning"><strong>Email not verified</strong><span>Please verify your email before signing in.</span>{resendSent ? <b className="success-copy">Verification link sent — check your inbox.</b> : <button type="button" onClick={handleResend}>{resendLoading ? 'Sending…' : 'Resend verification email'}</button>}</div>}
            <div className="field"><label htmlFor="email">Email address</label><div className="field-control"><Mail size={17} /><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div></div>
            <div className="field"><div className="label-row"><label htmlFor="password">Password</label><button type="button" onClick={() => navigate('forgot-password')}>Forgot password?</button></div><div className="field-control"><Lock size={17} /><input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /><button className="visibility-toggle" type="button" onClick={() => setShowPw(p => !p)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
            <label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Keep me signed in</span></label>
            <button className="submit-button" type="submit" disabled={loading}>{loading ? 'Signing in…' : <>Sign in to dashboard <ArrowUpRight size={17} /></>}</button>
          </form>
          <p className="signup-prompt">New to ADA? <button onClick={() => navigate('signup')}>Create an account</button></p>
          <div className="trust-note"><ShieldCheck size={18} /><p><strong>Your accessibility command center.</strong><br />One place to understand health, inspect WCAG violations, and ship repository-backed fixes.</p></div>
        </div>
      </section>
    </div>
  );
}
