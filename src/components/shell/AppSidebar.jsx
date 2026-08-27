import {
  LayoutDashboard, Wand2, Settings, X,
  ScanLine, History, CalendarClock, BellRing, ClipboardList, LogOut, BookOpen, Plug,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import BrandLogo from '../ui/BrandLogo';

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Audits',
    items: [
      { id: 'new-scan',      label: 'Run Audit',     icon: ScanLine  },
      { id: 'scan-history',  label: 'Scan History',  icon: History   },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { id: 'crawl-schedules', label: 'Schedules',     icon: CalendarClock },
      { id: 'alerts',          label: 'Notifications', icon: BellRing      },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'integrations', label: 'Channels & Apps', icon: Plug },
    ],
  },
  {
    label: 'Tools',
    items: [
      { id: 'ai-fix',         label: 'AI Fix Assistant',  icon: Wand2          },
      { id: 'assistive-test', label: 'Assistive Testing', icon: ClipboardList  },
      { id: 'wcag-reference', label: 'WCAG Reference',    icon: BookOpen       },
    ],
  },
  {
    label: null,
    items: [
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

function isNavActive(navId, activePage) {
  if (navId === activePage) return true;
  if (navId === 'new-scan' && activePage === 'crawl-results') return true;
  if (navId === 'scan-history' && activePage === 'executive-summary') return true;
  // backward compat: /keyboard-test route still highlights the Assistive Testing item
  if (navId === 'assistive-test' && activePage === 'keyboard-test') return true;
  return false;
}

export default function AppSidebar() {
  const { activePage, navigate, sidebarOpen, setSidebarOpen, user, logout } = useApp();

  function handleLogout() {
    logout();
    navigate('landing');
  }

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';
  const displayName = user ? `${user.firstName} ${user.lastName}` : '';
  const email = user?.email ?? '';

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={[
        'fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-charcoal flex flex-col h-full',
        'border-r border-gray-100 dark:border-white/[0.06]',
        'lg:relative lg:translate-x-0 lg:flex transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>

        {/* ── LOGO ── */}
        <div className="px-4 py-4 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => navigate('dashboard')}
            className="hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-xl"
            aria-label="Go to dashboard"
          >
            <BrandLogo variant="sidebar" />
          </button>

          <button
            className="lg:hidden p-1.5 rounded-lg text-body hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── NAV ── */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label || '__top'} className="mb-1">
              {section.label && (
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-600">
                  {section.label}
                </p>
              )}
              {section.items.map(({ id, label, icon: Icon }) => {
                const active = isNavActive(id, activePage);
                return (
                  <button
                    key={id}
                    onClick={() => { navigate(id); setSidebarOpen(false); }}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13.5px] border-0 transition-all duration-150',
                      active
                        ? 'bg-teal text-white font-semibold'
                        : 'text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-white/5 hover:text-ink dark:hover:text-white',
                    ].join(' ')}
                  >
                    <Icon
                      size={17}
                      className={active ? 'text-white flex-shrink-0' : 'text-gray-400 dark:text-gray-500 flex-shrink-0'}
                      strokeWidth={active ? 2 : 1.75}
                    />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ── FOOTER ── */}
        <div className="px-4 py-4 border-t border-gray-100 dark:border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-teal flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink dark:text-white leading-tight truncate">{displayName}</p>
              <p className="text-[11px] text-body dark:text-gray-500 leading-tight truncate">{email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors flex-shrink-0"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

      </aside>
    </>
  );
}
