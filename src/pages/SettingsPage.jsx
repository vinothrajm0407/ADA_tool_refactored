import { useState, useEffect } from 'react';
import { Palette, Bell, Calendar, Mail, Trash2, Sun, Moon, Volume2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const STORAGE_KEY = 'ada_settings';

const defaultSettings = {
  darkMode: false,
  reducedMotion: false,
  compactView: false,
  notifications: {
    emailReports: false,
    slackAlerts: false,
  },
  scheduled: {
    autoScan: false,
    scanOnDeploy: false,
    scheduleMonthly: false,
  },
  emailReports: {
    sendOnComplete: false,
    includeDetails: false,
    ccTeam: false,
  },
};

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink dark:text-white">{label}</p>
        {description && (
          <p className="text-xs text-body dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2 dark:focus:ring-offset-night ${
          checked ? 'bg-teal' : 'bg-gray-200 dark:bg-white/10'
        }`}
        style={{ minWidth: '2.75rem' }}
      >
        <span
          className={`inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 mt-0.5 ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function SettingsCard({ title, icon: Icon, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={20} className="text-teal shrink-0" />
        <h3 className="font-heading font-semibold text-ink dark:text-white">{title}</h3>
      </div>
      <hr className="border-gray-200 dark:border-white/10 mb-3" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { dark, setDark } = useApp();
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) };
      }
    } catch (_) {}
    return defaultSettings;
  });
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
  }, [settings]);

  useEffect(() => {
    if (settings.darkMode !== dark) {
      setSettings((prev) => ({ ...prev, darkMode: dark }));
    }
  }, [dark]);

  function setTop(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function setNested(group, key, value) {
    setSettings((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: value },
    }));
  }

  function handleDarkMode(value) {
    setTop('darkMode', value);
    if (setDark) setDark(value);
  }

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    try {
      localStorage.clear();
    } catch (_) {}
    setSettings(defaultSettings);
    if (setDark) setDark(false);
    setConfirmReset(false);
  }

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="font-heading font-bold text-2xl text-ink dark:text-white">Settings</h2>
        <p className="text-sm text-body dark:text-gray-400 mt-1">
          Manage your preferences, notifications, and scan configuration.
        </p>

        <div className="grid xl:grid-cols-2 gap-6 mt-6">
          {/* Theme */}
          <SettingsCard title="Theme" icon={Palette}>
            <ToggleRow
              label="Dark Mode"
              description="Switch between light and dark interface"
              checked={settings.darkMode}
              onChange={handleDarkMode}
            />
            <ToggleRow
              label="Reduced Motion"
              description="Minimize animations and transitions"
              checked={settings.reducedMotion}
              onChange={(v) => setTop('reducedMotion', v)}
            />
            <ToggleRow
              label="Compact View"
              description="Condense spacing for denser layouts"
              checked={settings.compactView}
              onChange={(v) => setTop('compactView', v)}
            />
          </SettingsCard>

          {/* Notifications */}
          <SettingsCard title="Notifications" icon={Bell}>
            <ToggleRow
              label="Email Reports"
              description="Receive scan results via email"
              checked={settings.notifications.emailReports}
              onChange={(v) => setNested('notifications', 'emailReports', v)}
            />
            <ToggleRow
              label="Slack Alerts"
              description="Post notifications to your Slack workspace"
              checked={settings.notifications.slackAlerts}
              onChange={(v) => setNested('notifications', 'slackAlerts', v)}
            />
          </SettingsCard>

          {/* Scheduled Scans */}
          <SettingsCard title="Scheduled Scans" icon={Calendar}>
            <ToggleRow
              label="Auto-scan on Deploy"
              description="Trigger a scan automatically after each deployment"
              checked={settings.scheduled.autoScan}
              onChange={(v) => setNested('scheduled', 'autoScan', v)}
            />
            <ToggleRow
              label="Schedule Monthly Review"
              description="Run a full crawl on the first of each month"
              checked={settings.scheduled.scheduleMonthly}
              onChange={(v) => setNested('scheduled', 'scheduleMonthly', v)}
            />
            <ToggleRow
              label="Alert on Regression"
              description="Notify when new issues are detected since last scan"
              checked={settings.scheduled.scanOnDeploy}
              onChange={(v) => setNested('scheduled', 'scanOnDeploy', v)}
            />
          </SettingsCard>

          {/* Email Reports */}
          <SettingsCard title="Email Reports" icon={Mail}>
            <ToggleRow
              label="Send on Crawl Complete"
              description="Email the report as soon as a crawl finishes"
              checked={settings.emailReports.sendOnComplete}
              onChange={(v) => setNested('emailReports', 'sendOnComplete', v)}
            />
            <ToggleRow
              label="Include Full Details"
              description="Attach detailed issue breakdown to the email"
              checked={settings.emailReports.includeDetails}
              onChange={(v) => setNested('emailReports', 'includeDetails', v)}
            />
            <ToggleRow
              label="CC Team Members"
              description="Copy all team members on every report email"
              checked={settings.emailReports.ccTeam}
              onChange={(v) => setNested('emailReports', 'ccTeam', v)}
            />
          </SettingsCard>
        </div>

        {/* Danger Zone */}
        <div className="mt-6 card p-5 border-2 border-coral/20">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={20} className="text-coral shrink-0" />
            <h3 className="font-heading font-semibold text-ink dark:text-white">Danger Zone</h3>
          </div>
          <hr className="border-coral/20 mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-ink dark:text-white">Reset All Data</p>
              <p className="text-xs text-body dark:text-gray-400 mt-0.5">
                Clears all scan history and settings from local storage.
              </p>
              {confirmReset && (
                <p className="text-xs text-coral mt-1 font-medium">
                  Are you sure? This cannot be undone. Click again to confirm.
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {confirmReset && (
                <button
                  className="btn-ghost text-sm px-4 py-2"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              )}
              <button
                className={`btn-secondary text-sm px-4 py-2 flex items-center gap-2 ${
                  confirmReset
                    ? 'border-coral text-coral hover:bg-coral/10'
                    : ''
                }`}
                onClick={handleReset}
              >
                <Trash2 size={14} />
                {confirmReset ? 'Confirm Reset' : 'Reset All Data'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
