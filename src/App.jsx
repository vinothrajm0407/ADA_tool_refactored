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

const PUBLIC_PAGES = new Set(['landing', 'login', 'signup', 'verify-email', 'forgot-password', 'reset-password']);

function AppInner() {
  const { activePage, dark, setDark, navigate, sidebarOpen, setSidebarOpen, scanHistoryId, setScanHistoryId, isAuthenticated } = useApp()

  const toggleDark = useCallback(() => {
    setDark((prev) => !prev)
  }, [setDark])

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
      <div className="flex h-screen overflow-hidden bg-ivory dark:bg-night">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? 'flex' : 'hidden'
          } lg:flex flex-col w-72 flex-shrink-0 border-r border-gray-100 dark:border-white/[0.06]`}
        >
          <AppSidebar />
        </div>

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-auto">
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
