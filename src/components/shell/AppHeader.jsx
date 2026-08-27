import { useState, useRef, useEffect } from 'react';
import { Menu, Sun, Moon, Bell, LogOut, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import BrandLogo from '../ui/BrandLogo';

const pageTitles = {
  dashboard:            'Dashboard',
  'new-scan':           'New Scan',
  'scan-history':       'Scan History',
  'crawl-results':      'Crawl Results',
  'crawl-schedules':    'Crawl Schedules',
  'executive-summary':  'Executive Summary',
  alerts:               'Notifications',
  'assistive-test':     'Assistive Testing',
  'keyboard-test':      'Assistive Testing',
  'ai-fix':             'AI Fix Assistant',
  settings:             'Settings',
};

export default function AppHeader() {
  const { activePage, navigate, setSidebarOpen, dark, setDark, user, logout } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';
  const displayName = user ? `${user.firstName} ${user.lastName}` : '';
  const email = user?.email ?? '';

  const title = pageTitles[activePage] ?? 'Dashboard';

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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-charcoal/80 backdrop-blur-md border-b border-gray-100 dark:border-white/[0.06] h-16 flex items-center px-4 sm:px-6 gap-3">
      {/* Hamburger — mobile only */}
      <button
        className="lg:hidden btn-ghost p-2 rounded-2xl"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5 text-ink dark:text-white" />
      </button>

      {/* Compact brand mark — mobile only, when sidebar is off-canvas */}
      <button
        className="lg:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-lg"
        onClick={() => navigate('dashboard')}
        aria-label="Go to dashboard"
      >
        <BrandLogo variant="compact" />
      </button>

      {/* Page title */}
      <span className="font-heading font-semibold text-ink dark:text-white text-lg whitespace-nowrap">
        {title}
      </span>

      {/* Right action group */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Dark mode toggle */}
        <button
          className="btn-ghost p-2 rounded-2xl"
          onClick={() => setDark(!dark)}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? (
            <Sun className="w-5 h-5 text-amber" />
          ) : (
            <Moon className="w-5 h-5 text-ink dark:text-white" />
          )}
        </button>

        {/* Notifications bell */}
        <button
          className="btn-ghost p-2 rounded-2xl relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-ink dark:text-white" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-coral" />
        </button>

        {/* User avatar + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-8 h-8 rounded-full bg-teal flex items-center justify-center text-white text-xs font-bold select-none hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            {initials}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 w-56 bg-white dark:bg-charcoal rounded-2xl shadow-lg border border-gray-100 dark:border-white/[0.08] py-1 z-50">
              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-teal flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{initials}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink dark:text-white leading-tight truncate">{displayName}</p>
                  <p className="text-[11px] text-body dark:text-gray-400 leading-tight truncate">{email}</p>
                </div>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-coral/10 hover:text-coral dark:hover:text-coral transition-colors"
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
