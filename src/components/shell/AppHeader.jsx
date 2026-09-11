import { useState, useRef, useEffect } from 'react';
import { Menu, Bell, LogOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import BrandLogo from '../ui/BrandLogo';

// Every activePage App.jsx can route to needs an entry here — otherwise the
// header silently falls back to "Dashboard", which is wrong on that page and
// undermines the page-heading landmark screen readers rely on.
const pageTitles = {
  dashboard:            'Dashboard',
  'new-scan':           'Run Audit',
  'scan-history':       'Scan History',
  'crawl-results':      'Crawl Results',
  'crawl-schedules':    'Crawl Schedules',
  'executive-summary':  'Executive Summary',
  alerts:               'Notifications',
  'assistive-test':     'Assistive Testing',
  'keyboard-test':      'Assistive Testing',
  'assistive-results':  'Assistive Testing',
  'wcag-reference':     'WCAG Reference',
  integrations:         'Channels & Apps',
  'repo-links':         'Connected Repos',
  'fix-history':        'Fix History',
  settings:             'Settings',
};

export default function AppHeader() {
  const { activePage, navigate, setSidebarOpen, user, logout } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';
  const displayName = user ? `${user.firstName} ${user.lastName}` : '';
  const email = user?.email ?? '';

  const title = pageTitles[activePage] ?? 'Dashboard';
  const isHome = activePage === 'dashboard';

  // Closing via Escape restores focus to the trigger, matching standard
  // menu-button behavior — closing by picking "Sign out" navigates away
  // instead, so there's nothing to restore focus to.
  function closeMenu({ restoreFocus = false } = {}) {
    setMenuOpen(false);
    if (restoreFocus) menuTriggerRef.current?.focus();
  }

  function handleLogout() {
    setMenuOpen(false);
    logout();
    navigate('landing');
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu({ restoreFocus: true });
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 h-16 flex items-center px-4 sm:px-6 gap-3">
      {/* Hamburger — mobile only */}
      <button
        className="lg:hidden btn-ghost p-2 rounded-2xl"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5 text-ink" />
      </button>

      {/* Compact brand mark — mobile only, when sidebar is off-canvas */}
      <button
        className="lg:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-lg"
        onClick={() => navigate('dashboard')}
        aria-label="Go to dashboard"
      >
        <BrandLogo variant="compact" />
      </button>

      {/* Deliberately NOT an <h1> — most shell-rendered pages already
          render their own <h1> in the content area (verified by grep), so
          making this one too would create duplicate top-level headings.
          A few pages currently have no in-page h1 at all (CrawlResultsPage,
          DashboardPage, SettingsPage) and need one added when those specific
          pages are next touched — that's a page-level fix, out of scope for
          this shell-only pass. */}
      <div className="min-w-0">
        <p className="font-heading font-semibold text-ink text-lg whitespace-nowrap m-0 leading-tight">
          {title}
        </p>
        <p className="text-xs text-body leading-tight m-0">
          {isHome ? (
            'Home'
          ) : (
            <>
              <button
                onClick={() => navigate('dashboard')}
                className="hover:text-teal transition-colors"
              >
                Home
              </button>
              {' / '}{title}
            </>
          )}
        </p>
      </div>

      {/* Right action group */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications bell */}
        <button
          className="btn-ghost p-2 rounded-2xl relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-ink" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-coral" />
        </button>

        {/* User avatar + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            ref={menuTriggerRef}
            onClick={() => setMenuOpen(o => !o)}
            className="w-8 h-8 rounded-full bg-teal flex items-center justify-center text-white text-xs font-bold select-none hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            aria-label="User menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            {initials}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 w-56 bg-white rounded-2xl border border-gray-100 py-1 z-50">
              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className="w-8 h-8 rounded-full bg-teal flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{initials}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink leading-tight truncate">{displayName}</p>
                  <p className="text-[11px] text-body leading-tight truncate">{email}</p>
                </div>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-coral/10 hover:text-coral transition-colors"
              >
                <LogOut size={15} className="flex-shrink-0" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
