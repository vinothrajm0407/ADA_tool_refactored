import React, { useState } from 'react';
import {
  Globe, BarChart2, Keyboard, Wand2, TrendingUp, ShieldCheck,
  Sun, Moon,
  Sparkles, ArrowRight, ChevronDown,
  Link2, Search, Zap,
  Terminal, Code, Mail, GitBranch, FileCode, Monitor, Clock,
  Check,
} from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import { useApp } from '../context/AppContext';
import HeroMockup from '../components/ui/HeroMockup';
import CrawlPreview from '../components/ui/CrawlPreview';
import AIFixPreview from '../components/ui/AIFixPreview';
import ScoreTrendPreview from '../components/ui/ScoreTrendPreview';

/* ─────────────────────────────────────────────
   Static data
───────────────────────────────────────────── */
const STEPS = [
  {
    icon: Link2, num: 1,
    title: 'Enter your website URL',
    desc: 'Paste any URL — homepage, staging, or production. ADA works on any publicly reachable site with no setup required.',
  },
  {
    icon: Search, num: 2,
    title: 'Crawl & analyze every page',
    desc: 'ADA automatically discovers and tests every page against WCAG 2.1 and 2.2 criteria — not just the one URL you typed.',
  },
  {
    icon: Zap, num: 3,
    title: 'Review results & fix issues',
    desc: 'Get a full report sorted by severity. Each issue includes its WCAG criterion and an AI-generated code fix ready to ship.',
  },
];

const FEATURES = [
  {
    icon: Globe, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-900/20',
    badge: 'Full-site',
    title: 'Multi-page Crawling',
    desc: 'Go beyond single-page checks. ADA crawls your entire site automatically and tests every page it finds.',
  },
  {
    icon: Wand2, color: 'text-amber-500', bg: 'bg-amber-500/10',
    badge: 'AI-powered',
    title: 'AI Fix Suggestions',
    desc: 'Every violation comes with an AI-generated code fix in HTML, React, or Vue. Fix issues in minutes, not days.',
  },
  {
    icon: BarChart2, color: 'text-sage', bg: 'bg-sage/10',
    badge: null,
    title: 'Accessibility Score',
    desc: 'A single WCAG compliance score for your entire site. Track whether you improve or regress sprint over sprint.',
  },
  {
    icon: Keyboard, color: 'text-terracotta', bg: 'bg-terracotta/10',
    badge: null,
    title: 'Keyboard Testing',
    desc: 'Validate focus order, detect focus traps, and verify skip links across every flow — automatically.',
  },
  {
    icon: TrendingUp, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-900/20',
    badge: null,
    title: 'Trend Analytics',
    desc: 'Visualise accessibility health over time. See which sprints improved compliance and where regressions appeared.',
  },
  {
    icon: ShieldCheck, color: 'text-coral', bg: 'bg-coral/10',
    badge: null,
    title: 'Regression Detection',
    desc: 'ADA flags any page that previously passed and now fails — automatically, on every scan.',
  },
];

const INTEGRATIONS = [
  { icon: Terminal,  label: 'CLI Tool',        desc: 'Scan from any shell or script',        available: true  },
  { icon: Code,      label: 'REST API',         desc: 'Programmatic access to all scan data', available: true  },
  { icon: Mail,      label: 'Email Reports',    desc: 'Scheduled reports to your inbox',      available: true  },
  { icon: Zap,       label: 'Webhook Events',   desc: 'Real-time scan completion events',     available: true  },
  { icon: GitBranch, label: 'GitHub Actions',   desc: 'Automated PR accessibility checks',    available: false },
  { icon: FileCode,  label: 'SARIF Export',     desc: 'Upload results to GitHub Security',    available: false },
  { icon: Monitor,   label: 'Multi-viewport',   desc: 'Mobile, tablet, and desktop testing',  available: false },
  { icon: Clock,     label: 'Scheduled Scans',  desc: 'Daily and weekly auto-monitoring',     available: false },
];


/* ─────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────── */
function StepCard({ icon: Icon, num, title, desc }) {
  return (
    <div className="flex flex-col items-center text-center gap-3">
      <div className="relative mb-1">
        <div className="w-16 h-16 rounded-2xl bg-white dark:bg-night border border-gray-100 dark:border-white/10 shadow-soft flex items-center justify-center">
          <Icon className="w-7 h-7 text-teal" />
        </div>
        <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-teal text-white text-xs font-bold font-heading flex items-center justify-center leading-none">
          {num}
        </span>
      </div>
      <h3 className="font-heading font-semibold text-ink dark:text-white text-base">{title}</h3>
      <p className="text-sm text-body dark:text-gray-400 leading-relaxed max-w-[240px]">{desc}</p>
    </div>
  );
}

function FeatureCard({ icon: Icon, color, bg, badge, title, desc }) {
  return (
    <div className="card p-7 flex flex-col gap-4 transition-transform duration-300 ease-out hover:-translate-y-2 hover:shadow-glow cursor-default">
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${bg}`}>
          <Icon className={`w-6 h-6 ${color}`} />
        </div>
        {badge && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-teal bg-teal/10 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <div>
        <h3 className="font-heading font-semibold text-ink dark:text-white text-base mb-1.5">{title}</h3>
        <p className="text-sm text-body dark:text-gray-400 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function SpotlightBullet({ text }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 w-4 h-4 rounded-full bg-teal/10 flex items-center justify-center flex-shrink-0">
        <Check className="w-2.5 h-2.5 text-teal" />
      </span>
      <span className="text-sm text-body dark:text-gray-400 leading-relaxed">{text}</span>
    </li>
  );
}

/* ─────────────────────────────────────────────
   Page
───────────────────────────────────────────── */
function AuthRequiredModal({ onLogin, onSignup, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-charcoal rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-6 h-6 text-teal" />
        </div>
        <h2 className="font-heading font-bold text-xl text-ink dark:text-white mb-2">Sign in to continue</h2>
        <p className="text-sm text-body dark:text-gray-400 mb-7">
          Please sign in or create an account to access ADA.
        </p>
        <div className="flex flex-col gap-3">
          <button onClick={onLogin} className="btn-primary w-full py-3">Sign In</button>
          <button
            onClick={onSignup}
            className="w-full py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-ink dark:text-white hover:bg-ivory dark:hover:bg-white/5 transition-colors"
          >
            Create Account
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage({ onOpenApp, dark, toggleDark }) {
  const { navigate, isAuthenticated, setPostAuthRedirect } = useApp();
  const [showAuthModal, setShowAuthModal] = useState(false);

  function handleProtectedCta(destination) {
    if (isAuthenticated) {
      if (destination === 'scan') navigate('new-scan');
      else navigate('dashboard');
    } else {
      setPostAuthRedirect(destination === 'scan' ? 'new-scan' : null);
      setShowAuthModal(true);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-night font-body">

      {/* Skip to main content — WCAG 2.4.1 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-teal focus:text-white focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* ── HEADER ── */}
      <header
        className="sticky top-0 z-50 bg-white/90 dark:bg-night/90 backdrop-blur-md border-b border-gray-100 dark:border-white/5 px-8 h-[4.5rem] flex items-center justify-between"
      >
        <BrandLogo variant="landing" />

        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-7">
          {[
            { label: 'How It Works', href: '#how-it-works' },
            { label: 'Features',     href: '#features'     },
            { label: 'Why ADA',      href: '#why-ada'      },
          ].map(({ label, href }) => (
            <a key={label} href={href}
              className="text-sm font-medium text-body dark:text-gray-400 hover:text-ink dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded">
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <button onClick={toggleDark} aria-label="Toggle dark mode"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-body dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {isAuthenticated ? (
            <button onClick={() => navigate('dashboard')} className="btn-primary">Launch App</button>
          ) : (
            <>
              <button
                onClick={() => navigate('login')}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-ink dark:text-white border border-gray-200 dark:border-white/10 hover:bg-ivory dark:hover:bg-white/5 transition-colors"
              >
                Login
              </button>
              <button onClick={() => navigate('signup')} className="btn-primary">Sign Up</button>
            </>
          )}
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main id="main-content">

        {/* HERO */}
        <section aria-label="Hero" className="min-h-[calc(100vh-4.5rem)] flex items-center bg-white dark:bg-night">
          <div className="w-full max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-16 items-center py-16">
            <div>
              <span className="bg-teal/10 text-teal text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 mb-6 tracking-wide">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Built for engineering &amp; QA teams
              </span>

              <h1 className="font-heading font-bold text-5xl sm:text-6xl lg:text-[4rem] xl:text-[4.5rem] text-ink dark:text-white leading-[1.08] tracking-tight">
                Find and fix accessibility issues across your entire site
              </h1>

              <p className="text-body dark:text-gray-300 text-lg mt-5 leading-relaxed max-w-[480px]">
                ADA crawls every page, scores your WCAG compliance, tests keyboard navigation, and gives developers AI-generated code fixes — all in one platform.
              </p>

              <div className="flex flex-wrap gap-2 mt-5" aria-label="Key capabilities">
                {['Full-site crawling', 'WCAG scoring', 'Keyboard testing', 'AI code fixes'].map((cap) => (
                  <span key={cap}
                    className="text-xs font-medium text-body dark:text-gray-400 bg-ivory dark:bg-white/5 border border-gray-200 dark:border-white/10 px-3 py-1 rounded-full">
                    {cap}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-8">
                <button onClick={() => handleProtectedCta('scan')}
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-teal text-white font-semibold font-heading text-sm hover:bg-teal-700 transition-colors duration-200 cursor-pointer border-0 shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2">
                  Start Scan <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <a href="#how-it-works"
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-gray-200 dark:border-white/10 bg-transparent text-ink dark:text-white font-semibold font-heading text-sm hover:bg-ivory dark:hover:bg-white/5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-xl">
                  See How It Works <ChevronDown className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="flex justify-center" aria-hidden="true">
              <HeroMockup />
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" aria-label="How it works" className="py-16 bg-ivory dark:bg-charcoal">
          <div className="max-w-4xl mx-auto px-8">
            <div className="text-center mb-12">
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">How It Works</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2">
                From URL to insights in minutes
              </h2>
              <p className="text-sm text-body dark:text-gray-400 mt-3 max-w-sm mx-auto leading-relaxed">
                No agents to install. No configuration files. Paste a URL and ADA handles the rest.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-12 relative">
              <div className="hidden md:block absolute top-8 left-[calc(16.67%+2.5rem)] right-[calc(16.67%+2.5rem)] border-t-2 border-dashed border-teal/20 dark:border-teal/15 pointer-events-none" aria-hidden="true" />
              {STEPS.map((s) => <StepCard key={s.num} {...s} />)}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" aria-label="Features" className="py-16 bg-white dark:bg-night">
          <div className="max-w-7xl mx-auto px-8">
            <div className="text-center mb-10">
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">Features</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2">Everything your team needs</h2>
              <p className="text-sm text-body dark:text-gray-400 mt-3 max-w-sm mx-auto leading-relaxed">
                Everything your team needs to find, understand, and fix accessibility issues — from first scan to shipped fix.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map((f) => <FeatureCard key={f.title} {...f} />)}
            </div>
          </div>
        </section>

        {/* SPOTLIGHT: FULL-SITE CRAWLING */}
        <section aria-label="Multi-page crawling feature" className="py-16 bg-ivory dark:bg-charcoal">
          <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">Site-wide scanning</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2 mb-4">
                Scan your entire site, not just one page
              </h2>
              <p className="text-sm text-body dark:text-gray-400 leading-relaxed mb-6">
                ADA discovers every page on your site automatically, tests each one against WCAG 2.1 and 2.2 criteria, and groups results by severity — so your team always knows exactly where to focus.
              </p>
              <ul className="flex flex-col gap-3">
                {[
                  'Discovers pages automatically — no sitemap required',
                  'Tests every page against WCAG 2.1 and 2.2 criteria',
                  'Real-time progress as each page is scanned',
                  'Per-page scores and issue counts in one report',
                ].map((b) => <SpotlightBullet key={b} text={b} />)}
              </ul>
            </div>
            <div className="flex justify-center lg:justify-end" aria-hidden="true">
              <CrawlPreview />
            </div>
          </div>
        </section>

        {/* SPOTLIGHT: AI FIX */}
        <section aria-label="AI fix suggestions feature" className="py-16 bg-white dark:bg-night">
          <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-16 items-center">
            <div className="flex justify-center lg:justify-start order-2 lg:order-1" aria-hidden="true">
              <AIFixPreview />
            </div>
            <div className="order-1 lg:order-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">AI-powered remediation</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2 mb-4">
                From violation to fix — in seconds
              </h2>
              <p className="text-sm text-body dark:text-gray-400 leading-relaxed mb-6">
                ADA doesn't just tell you what's broken. For every violation it finds, AI generates a ready-to-use code fix in your framework of choice. Review it, copy it, ship it.
              </p>
              <ul className="flex flex-col gap-3">
                {[
                  'Framework-specific fixes for HTML, React, and Vue',
                  'Each fix mapped to the relevant WCAG success criterion',
                  'Explains why the issue matters to real users',
                  'Copy to clipboard and paste directly into your codebase',
                ].map((b) => <SpotlightBullet key={b} text={b} />)}
              </ul>
            </div>
          </div>
        </section>

        {/* SPOTLIGHT: SCORE TREND */}
        <section aria-label="Accessibility score trend feature" className="py-16 bg-ivory dark:bg-charcoal">
          <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">Trend analytics</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2 mb-4">
                Track your accessibility health over time
              </h2>
              <p className="text-sm text-body dark:text-gray-400 leading-relaxed mb-6">
                A single score tells you where your site stands today. Sprint-level trend charts tell you whether you're improving or regressing. ADA gives you both — site-wide and per page.
              </p>
              <ul className="flex flex-col gap-3">
                {[
                  'Single compliance score aggregated across all pages',
                  'Sprint-over-sprint trend tracking with visual charts',
                  'Regression alerts when pages that passed start failing',
                  'Exportable reports for compliance and stakeholder review',
                ].map((b) => <SpotlightBullet key={b} text={b} />)}
              </ul>
            </div>
            <div className="flex justify-center lg:justify-end" aria-hidden="true">
              <ScoreTrendPreview />
            </div>
          </div>
        </section>

        {/* WHY ADA — moved before secondary CTA */}
        <section id="why-ada" aria-label="Why ADA" className="py-16 bg-white dark:bg-night">
          <div className="max-w-7xl mx-auto px-8">
            <div className="text-center mb-10">
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">Why ADA</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2">
                One platform for your full accessibility workflow
              </h2>
              <p className="text-sm text-body dark:text-gray-400 mt-3 max-w-lg mx-auto leading-relaxed">
                ADA brings together site-wide scanning, real-time scoring, keyboard testing, trend tracking, and AI-powered fixes — so your team always has a clear path from issue to resolution.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              <div className="bg-teal text-white p-8 rounded-2xl flex flex-col gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center" aria-hidden="true">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg mb-2">Developer First</h3>
                  <p className="text-teal-100 text-sm leading-relaxed">
                    Paste a URL, get results in minutes. Webhooks, SARIF export, and CI/CD integration let your team run ADA inside existing workflows — no context switching required.
                  </p>
                </div>
              </div>
              <div className="bg-terracotta text-white p-8 rounded-2xl flex flex-col gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center" aria-hidden="true">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg mb-2">WCAG 2.1 &amp; 2.2 Complete</h3>
                  <p className="text-orange-100 text-sm leading-relaxed">
                    Every rule mapped to a WCAG success criterion. Critical, Serious, Moderate, and Minor severities — from color contrast to ARIA roles to keyboard traps.
                  </p>
                </div>
              </div>
              <div className="bg-ink text-white p-8 rounded-2xl flex flex-col gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center" aria-hidden="true">
                  <Zap className="w-5 h-5 text-teal-300" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg mb-2 text-teal-300">Actionable Insights</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    Every issue includes its WCAG criterion, impacted elements, severity rating, and an AI-generated code fix. Your team ships the fix — not just the finding.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECONDARY CTA */}
        <section aria-label="Call to action" className="py-16 bg-ink text-white text-center">
          <div className="max-w-2xl mx-auto px-8">
            <h2 className="font-heading font-bold text-3xl text-white mb-3">
              Ready to build a more accessible web?
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-8">
              ADA scans your entire site, not just one page. Get a full accessibility report, per-page scores, and AI-generated code fixes in minutes.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button onClick={() => handleProtectedCta('scan')}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-teal text-white font-semibold font-heading text-sm hover:bg-teal-700 transition-colors duration-200 cursor-pointer border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-ink">
                Start Scan <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button onClick={() => handleProtectedCta('app')}
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)' }}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold font-heading text-sm cursor-pointer focus:outline-none">
                Launch App
              </button>
            </div>
            <p className="text-gray-400 text-xs mt-5">No setup required. Works on any public URL.</p>
          </div>
        </section>

        {/* INTEGRATIONS */}
        <section aria-label="Integrations" className="py-16 bg-ivory dark:bg-charcoal">
          <div className="max-w-7xl mx-auto px-8">
            <div className="text-center mb-10">
              <span className="text-xs font-semibold uppercase tracking-widest text-teal">Integrations</span>
              <h2 className="font-heading font-bold text-3xl text-ink dark:text-white mt-2">
                Fits inside your existing workflow
              </h2>
              <p className="text-sm text-body dark:text-gray-400 mt-3 max-w-sm mx-auto leading-relaxed">
                ADA works alongside the tools your team already uses. Current integrations and what's coming next.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {INTEGRATIONS.map(({ icon: Icon, label, desc, available }) => (
                <div key={label} className={`card p-5 flex flex-col gap-3 ${!available ? 'opacity-60' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${available ? 'bg-teal/10' : 'bg-gray-100 dark:bg-white/5'}`} aria-hidden="true">
                    <Icon className={`w-5 h-5 ${available ? 'text-teal' : 'text-body dark:text-gray-500'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-ink dark:text-white">{label}</p>
                      {!available && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-body dark:text-gray-500 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">
                          Soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-body dark:text-gray-400 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>


      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-ink text-white py-7 px-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandLogo variant="compact" />
          <span className="font-heading font-bold text-white text-base tracking-tight">ADA</span>
        </div>
        <p className="text-gray-400 text-xs">&copy; {new Date().getFullYear()} United Techno. All rights reserved.</p>
      </footer>

      {showAuthModal && (
        <AuthRequiredModal
          onClose={() => setShowAuthModal(false)}
          onLogin={() => { setShowAuthModal(false); navigate('login'); }}
          onSignup={() => { setShowAuthModal(false); navigate('signup'); }}
        />
      )}
    </div>
  );
}
