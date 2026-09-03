import React, { useState, useEffect, useCallback } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import AppSidebar from './components/shell/AppSidebar'
import AppHeader from './components/shell/AppHeader'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import CrawlResultsPage from './pages/CrawlResultsPage'
import CrawlSchedulesPage from './pages/CrawlSchedulesPage'
import AlertsPage from './pages/AlertsPage'
import ExecutiveSummaryPage from './pages/ExecutiveSummaryPage'
import AssistiveTestingPage from './pages/AssistiveTestingPage'
import AssistiveResultsPage from './pages/AssistiveResultsPage'
import AIFixPage from './pages/AIFixPage'
import SettingsPage from './pages/SettingsPage'
import NewScanPage from './pages/NewScanPage'
import ScanHistoryView from './components/ScanHistory/ScanHistoryView'
import ADAResultsView from './components/ADAResultsView/ADAResultsView'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import WcagReferencePage from './pages/WcagReferencePage'
import IntegrationsPage from './pages/IntegrationsPage'
import RepoLinkingPage from './pages/RepoLinkingPage'
import FixHistoryPage from './pages/FixHistoryPage'

const PUBLIC_PAGES = new Set(['landing', 'login', 'signup', 'verify-email', 'forgot-password', 'reset-password']);

function AppInner() {
  const { activePage, dark, setDark, navigate, sidebarOpen, setSidebarOpen, scanHistoryId, setScanHistoryId, isAuthenticated } = useApp()

  const toggleDark = useCallback(() => {
    setDark((prev) => !prev)
  }, [setDark])

  // Escape closes the mobile sidebar from anywhere, not just its own backdrop click.
  useEffect(() => {
    if (!sidebarOpen) return
    function handleEscape(e) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [sidebarOpen, setSidebarOpen])

  if (activePage === 'landing') {
    return (
      <LandingPage
        onOpenApp={() => navigate('dashboard')}
        dark={dark}
        toggleDark={toggleDark}
      />
    )
  }

  if (activePage === 'login') {
    return <LoginPage dark={dark} toggleDark={toggleDark} />
  }

  if (activePage === 'signup') {
    return <SignupPage dark={dark} toggleDark={toggleDark} />
  }

  if (activePage === 'verify-email') {
    return <VerifyEmailPage dark={dark} toggleDark={toggleDark} />
  }

  if (activePage === 'forgot-password') {
    return <ForgotPasswordPage dark={dark} toggleDark={toggleDark} />
  }

  if (activePage === 'reset-password') {
    return <ResetPasswordPage dark={dark} toggleDark={toggleDark} />
  }

  if (!isAuthenticated) {
    return <LoginPage dark={dark} toggleDark={toggleDark} />
  }

  return (
    <div className={`${dark ? 'dark' : ''} h-screen`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-teal focus:text-white focus:font-semibold focus:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Skip to main content
      </a>
      <div className="flex h-screen overflow-hidden bg-ivory dark:bg-night">
        {/* AppSidebar owns its own responsive layout (fixed+slide-in on mobile,
            relative+w-64 on desktop) and its own backdrop — no wrapper needed
            here. A second wrapper with its own width/backdrop previously
            existed and both fought the sidebar's own mobile behavior. */}
        <AppSidebar />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AppHeader />
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
            {activePage === 'dashboard' && <DashboardPage />}
            {activePage === 'new-scan' && <NewScanPage />}
            {activePage === 'scan-history' && scanHistoryId == null && (
                <ScanHistoryView onScanClick={(id) => setScanHistoryId(id)} />
              )}
            {activePage === 'scan-history' && scanHistoryId != null && (
                <ADAResultsView
                  scanIdToLoad={scanHistoryId}
                  onClearResult={() => setScanHistoryId(null)}
                />
              )}
            {activePage === 'crawl-results' && <CrawlResultsPage />}
            {activePage === 'crawl-schedules' && <CrawlSchedulesPage />}
            {activePage === 'alerts' && <AlertsPage />}
            {activePage === 'executive-summary' && <ExecutiveSummaryPage />}
            {activePage === 'keyboard-test' && <AssistiveTestingPage />}
            {activePage === 'assistive-test' && <AssistiveTestingPage />}
            {activePage === 'assistive-results' && <AssistiveResultsPage />}
            {activePage === 'ai-fix' && <AIFixPage />}
            {activePage === 'wcag-reference' && <WcagReferencePage />}
            {activePage === 'integrations' && <IntegrationsPage />}
            {activePage === 'repo-links' && <RepoLinkingPage />}
            {activePage === 'fix-history' && <FixHistoryPage />}
            {activePage === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}

export default App
