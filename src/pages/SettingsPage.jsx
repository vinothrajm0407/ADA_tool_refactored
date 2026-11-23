import { useEffect, useState } from 'react';
import { User, Users, Palette, ShieldCheck, Trash2, Mail, CheckCircle2, KeyRound, Copy } from 'lucide-react';
import { useApp } from '../context/AppContext';
import PageHeader from '../components/ui/PageHeader';
import Toggle from '../components/ui/Toggle';
import { apiFetch } from '../utils/api';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
  { id: 'team', label: 'Team & roles', icon: Users },
];

// Approvers decide on every developer's Auto-Fix PRs (Fix History). Only an
// Approver can change roles, and never their own (the backend enforces both).
function TeamTab() {
  const [state, setState] = useState({ loading: true });
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json();
      setState(res.status === 403 || data.role === 'developer' ? { denied: true } : { users: data.users || [], me: data.me });
    } catch { setState({ error: true }); }
  }
  useEffect(() => { load(); }, []);

  async function setRole(u, role) {
    setBusyId(u.id); setError('');
    try {
      const res = await apiFetch(`/api/users/${u.id}/role`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Could not change the role');
      await load();
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  const header = (
    <div>
      <h2 className="font-heading font-semibold text-lg text-ink">Team & roles</h2>
      <p className="text-sm text-body mt-0.5">
        <b className="text-ink">Developers</b> run Auto Fix; their pull requests wait for approval.{' '}
        <b className="text-ink">Approvers</b> see everyone’s fixes and approve, request changes or reject them — and can run Auto Fix too.
      </p>
    </div>
  );
  if (state.loading) return <div className="card p-6 space-y-4">{header}<p className="text-sm text-body">Loading…</p></div>;
  if (state.denied) {
    return (
      <div className="card p-6 space-y-4">{header}
        <p className="text-sm text-body">You are a <b className="text-ink">Developer</b>. Only an Approver can change roles.</p>
      </div>
    );
  }
  if (state.error) return <div className="card p-6 space-y-4">{header}<p className="text-sm text-coral">Could not load the team.</p></div>;

  const needle = query.trim().toLowerCase();
  const users = state.users.filter(u => !needle || `${u.name} ${u.email}`.toLowerCase().includes(needle));
  const approvers = state.users.filter(u => u.role === 'approver').length;
  return (
    <div className="card p-6 space-y-4">
      {header}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-xs font-semibold text-body mb-1.5">Search people</span>
          <input type="search" className="input-base" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or email" />
        </label>
        <p className="text-xs text-body">{state.users.length} people · {approvers} Approver{approvers !== 1 ? 's' : ''}</p>
      </div>
      {error && <p className="text-sm text-coral" role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-body">
              <th scope="col" className="py-2 pr-3">Person</th>
              <th scope="col" className="py-2 pr-3">Role</th>
              <th scope="col" className="py-2"><span className="sr-only">Change role</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isMe = u.id === state.me;
              const approver = u.role === 'approver';
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-ink">{u.name}{isMe && <span className="text-body font-normal"> (you)</span>}</p>
                    <p className="text-xs text-body">{u.email}{!u.verified && ' · email not verified'}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${approver ? 'text-teal bg-teal-50' : 'text-body bg-gray-100'}`}>
                      {approver ? 'Approver' : 'Developer'}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    {isMe ? <span className="text-xs text-body">Another Approver can change your role</span> : (
                      <button type="button" className="btn-secondary text-xs" disabled={busyId === u.id}
                        onClick={() => setRole(u, approver ? 'developer' : 'approver')}>
                        {busyId === u.id ? 'Saving…' : approver ? 'Make Developer' : 'Make Approver'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!users.length && <tr><td colSpan={3} className="py-4 text-center text-body">Nobody matches “{query}”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const shortDate = (value) => (value ? new Date(value).toLocaleDateString() : 'Never');

function ApiKeysTab() {
  const [keys, setKeys] = useState(null);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState(null); // the full key, shown once
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(url, opts) {
    const res = await apiFetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }

  async function load() {
    try {
      setKeys((await call('/api/api-keys')).keys);
    } catch (e) {
      setError(e.message);
      setKeys([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { key } = await call('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      setCreated(key);
      setCopied(false);
      setLabel('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await call(`/api/api-keys/${id}`, { method: 'DELETE' });
      setConfirmId(null);
      if (created?.id === id) setCreated(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    navigator.clipboard?.writeText(created.key).then(() => setCopied(true), () => {});
  }

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink">API keys</h2>
        <p className="text-sm text-body mt-0.5">
          For scripts and CI, such as the ADA GitHub Action. A key acts as you, so keep it in a secret
          store (for GitHub: a repository secret named <code className="font-mono">ADA_API_KEY</code>).
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="api-key-label" className="block text-xs font-semibold text-body mb-1.5">Key name</label>
          <input
            id="api-key-label"
            className="input-base"
            value={label}
            maxLength={200}
            placeholder="e.g. GitHub – marketing site"
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
        </div>
        <button type="submit" className="btn-primary text-sm" disabled={busy || !label.trim()}>
          Create key
        </button>
      </form>

      {created && (
        <div className="rounded-xl border border-sage/40 bg-sage/10 p-4 space-y-2" role="status">
          <p className="text-sm font-medium text-ink">
            Copy “{created.label}” now. You won’t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="input-base bg-white font-mono text-xs break-all flex-1" aria-label="New API key">
              {created.key}
            </code>
            <button type="button" onClick={handleCopy} className="btn-secondary text-sm flex items-center gap-2 shrink-0">
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-coral" role="alert">{error}</p>}

      {keys === null ? (
        <p className="text-sm text-body">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-body">No API keys yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-body">
              <th className="font-semibold pb-2">Name</th>
              <th className="font-semibold pb-2">Key</th>
              <th className="font-semibold pb-2">Created</th>
              <th className="font-semibold pb-2">Last used</th>
              <th className="pb-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-gray-100">
                <td className="py-2.5 text-ink">{k.label}</td>
                <td className="py-2.5 font-mono text-xs text-body">{k.key_prefix}…</td>
                <td className="py-2.5 text-body">{shortDate(k.created_at)}</td>
                <td className="py-2.5 text-body">{shortDate(k.last_used_at)}</td>
                <td className="py-2.5 text-right">
                  {confirmId === k.id && (
                    <button type="button" className="btn-ghost text-xs px-2 py-1 mr-1" onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    disabled={busy}
                    aria-label={confirmId === k.id ? `Confirm revoking ${k.label}` : `Revoke ${k.label}`}
                    className="btn-secondary text-xs px-3 py-1 border-coral/40 text-coral hover:bg-coral/10"
                  >
                    {confirmId === k.id ? 'Confirm revoke' : 'Revoke'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProfileTab({ user }) {
  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink">Profile</h2>
        <p className="text-sm text-body mt-0.5">
          Your account details. These are read-only for now — reach out to your administrator to change them.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-body mb-1.5">First name</label>
          <p className="input-base bg-gray-50 cursor-default">{user?.firstName || '—'}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-body mb-1.5">Last name</label>
          <p className="input-base bg-gray-50 cursor-default">{user?.lastName || '—'}</p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-body mb-1.5">Email</label>
        <p className="input-base bg-gray-50 cursor-default">{user?.email || '—'}</p>
      </div>
    </div>
  );
}

function AppearanceTab({ reducedMotion, setReducedMotion }) {
  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="font-heading font-semibold text-lg text-ink">Appearance</h2>
        <p className="text-sm text-body mt-0.5">Accessibility display preferences for the ADA Tool.</p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">Reduced motion</p>
          <p className="text-xs text-body mt-0.5">
            Minimize animations and transitions throughout the app, on top of your OS setting.
          </p>
        </div>
        <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Reduced motion" />
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
        <h2 className="font-heading font-semibold text-lg text-ink">Security</h2>
        <p className="text-sm text-body mt-0.5">
          Manage how you sign in to your account.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-ink">Password</p>
          <p className="text-xs text-body mt-0.5">
            We'll email a reset link to <span className="font-medium text-ink">{user?.email || 'your account email'}</span>.
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
  const { user, reducedMotion, setReducedMotion } = useApp();
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
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0" role="main">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader title="Settings" description="Manage your account and accessibility preferences." />

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
              <AppearanceTab reducedMotion={reducedMotion} setReducedMotion={setReducedMotion} />
            )}
            {activeTab === 'security' && <SecurityTab user={user} />}
            {activeTab === 'api-keys' && <ApiKeysTab />}
            {activeTab === 'team' && <TeamTab />}
          </div>
        </div>

        <div className="card p-5 border-2 border-coral/20">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={20} className="text-coral shrink-0" />
            <h3 className="font-heading font-semibold text-lg text-ink">Danger Zone</h3>
          </div>
          <hr className="border-coral/20 mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">Reset local preferences</p>
              <p className="text-xs text-body mt-0.5">
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
