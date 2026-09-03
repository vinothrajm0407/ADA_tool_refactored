import { useState } from 'react';
import { User, Palette, ShieldCheck, Sun, Moon, Trash2, Mail, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

function ProfileTab({ user }) {
  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink dark:text-white">Profile</h2>
        <p className="text-sm text-body dark:text-gray-400 mt-0.5">
          Your account details. These are read-only for now — reach out to your administrator to change them.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1.5">First name</label>
          <p className="input-base bg-gray-50 dark:bg-white/[0.02] cursor-default">{user?.firstName || '—'}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1.5">Last name</label>
          <p className="input-base bg-gray-50 dark:bg-white/[0.02] cursor-default">{user?.lastName || '—'}</p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1.5">Email</label>
        <p className="input-base bg-gray-50 dark:bg-white/[0.02] cursor-default">{user?.email || '—'}</p>
      </div>
    </div>
  );
}

function ThemeOption({ label, icon: Icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 ${
        active
          ? 'border-teal bg-teal/5 dark:bg-teal/10'
          : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
      }`}
    >
      <Icon size={20} className={active ? 'text-teal' : 'text-body dark:text-gray-400'} />
      <span className={`text-sm font-medium ${active ? 'text-teal' : 'text-ink dark:text-white'}`}>{label}</span>
      <span
        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
          active ? 'border-teal' : 'border-gray-300 dark:border-white/20'
        }`}
      >
        {active && <span className="w-2 h-2 rounded-full bg-teal" />}
      </span>
    </button>
  );
}

function AppearanceTab({ dark, setDark, reducedMotion, setReducedMotion }) {
  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink dark:text-white">Appearance</h2>
        <p className="text-sm text-body dark:text-gray-400 mt-0.5">Choose how the ADA Tool looks on this device.</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-body dark:text-gray-400 mb-2">Theme</p>
        <div className="flex gap-3">
          <ThemeOption label="Light" icon={Sun} active={!dark} onClick={() => setDark(false)} />
          <ThemeOption label="Dark" icon={Moon} active={dark} onClick={() => setDark(true)} />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 pt-2 border-t border-gray-100 dark:border-white/[0.06]">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink dark:text-white">Reduced motion</p>
          <p className="text-xs text-body dark:text-gray-400 mt-0.5">
            Minimize animations and transitions throughout the app, on top of your OS setting.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={reducedMotion}
          aria-label="Reduced motion"
          onClick={() => setReducedMotion(!reducedMotion)}
          className={`relative inline-flex shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 dark:focus-visible:ring-offset-night ${
            reducedMotion ? 'bg-teal' : 'bg-gray-200 dark:bg-white/10'
          }`}
        >
          <span
            className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 mt-0.5 ${
              reducedMotion ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function SecurityTab({ user }) {
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');

  async function handleSendReset() {
    if (!user?.email) return;
    setStatus('sending');
    setError('');
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      setStatus('sent');
    } catch {
      setError('Could not reach the server. Please try again.');
      setStatus('idle');
    }
  }

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink dark:text-white">Security</h2>
        <p className="text-sm text-body dark:text-gray-400 mt-0.5">
          Manage how you sign in to your account.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-ink dark:text-white">Password</p>
          <p className="text-xs text-body dark:text-gray-400 mt-0.5">
            We'll email a reset link to <span className="font-medium text-ink dark:text-gray-300">{user?.email || 'your account email'}</span>.
          </p>
          {status === 'sent' && (
            <p className="flex items-center gap-1.5 text-xs text-sage mt-2 font-medium">
              <CheckCircle2 size={13} /> If that email is registered, a reset link is on its way.
            </p>
          )}
          {error && <p className="text-xs text-coral mt-2">{error}</p>}
        </div>
        <button
          type="button"
          onClick={handleSendReset}
          disabled={status === 'sending'}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <Mail size={14} />
          {status === 'sending' ? 'Sending…' : 'Send password reset email'}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, dark, setDark, reducedMotion, setReducedMotion } = useApp();
  const [activeTab, setActiveTab] = useState('profile');
  const [confirmReset, setConfirmReset] = useState(false);

  function handleResetLocalData() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    try {
      localStorage.removeItem('ada_settings');
    } catch {}
    setConfirmReset(false);
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night page-content min-h-0" role="main">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">Settings</h1>
          <p className="text-body dark:text-gray-400 text-[0.9375rem]">
            Manage your account and accessibility preferences.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6">
          <nav aria-label="Settings sections" className="flex sm:flex-col gap-1 sm:w-48 flex-shrink-0">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={isActive ? 'nav-item-active' : 'nav-item'}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0">
            {activeTab === 'profile' && <ProfileTab user={user} />}
            {activeTab === 'appearance' && (
              <AppearanceTab dark={dark} setDark={setDark} reducedMotion={reducedMotion} setReducedMotion={setReducedMotion} />
            )}
            {activeTab === 'security' && <SecurityTab user={user} />}
          </div>
        </div>

        <div className="card p-5 border-2 border-coral/20">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={20} className="text-coral shrink-0" />
            <h3 className="font-heading font-semibold text-ink dark:text-white">Danger Zone</h3>
          </div>
          <hr className="border-coral/20 mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-ink dark:text-white">Reset local preferences</p>
              <p className="text-xs text-body dark:text-gray-400 mt-0.5">
                Clears cached UI preferences stored in this browser. Your account and scan history are not affected.
              </p>
              {confirmReset && (
                <p className="text-xs text-coral mt-1 font-medium">
                  Are you sure? Click again to confirm.
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {confirmReset && (
                <button className="btn-ghost text-sm px-4 py-2" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              )}
              <button
                className={`btn-secondary text-sm px-4 py-2 flex items-center gap-2 ${
                  confirmReset ? 'border-coral text-coral hover:bg-coral/10' : ''
                }`}
                onClick={handleResetLocalData}
              >
                <Trash2 size={14} />
                {confirmReset ? 'Confirm Reset' : 'Reset Local Preferences'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
