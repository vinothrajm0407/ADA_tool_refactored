import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, CheckCircle2, Trash2, Plus, X, RefreshCw, Settings2,
  Link2, Lock, ShieldCheck, FolderGit2,
} from 'lucide-react';
import { apiFetch } from '../utils/api';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// The backend only ever validates github.com repo URLs today (see
// _GITHUB_REPO_RE in app.py) — this just reads that back out for display
// rather than claiming multi-provider support the app doesn't have.
function repoProviderLabel(repoUrl) {
  try {
    const host = new URL(repoUrl).hostname.replace(/^www\./, '');
    if (host === 'github.com') return 'GitHub';
    return host;
  } catch { return 'Repository'; }
}

function repoDisplayName(repoUrl) {
  try {
    const path = new URL(repoUrl).pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '');
    return path || repoUrl;
  } catch { return repoUrl; }
}

// ── Connect Repo Modal ────────────────────────────────────────────────────────
function ConnectRepoModal({ onClose, onConnected, initial, triggerRef }) {
  const isEdit = Boolean(initial);
  const [siteUrl, setSiteUrl]           = useState(initial?.site_url || '');
  const [repoUrl, setRepoUrl]           = useState(initial?.repo_url || '');
  const [defaultBranch, setBranch]      = useState(initial?.default_branch || 'main');
  const [accessToken, setAccessToken]   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    function handleKeyDown(e) {
      if (e.key === 'Escape') { onClose(); triggerRef?.current?.focus(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setError('');
    if (!siteUrl.trim() || !repoUrl.trim() || !accessToken.trim()) {
      setError('Site URL, repo URL and access token are required');
      return;
    }
    setLoading(true);
    try {
      const res  = await apiFetch('/api/repo-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_url:       siteUrl.trim(),
          repo_url:       repoUrl.trim(),
          default_branch: defaultBranch.trim() || 'main',
          access_token:   accessToken.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Connection failed'); return; }
      onConnected();
      onClose();
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={() => { onClose(); triggerRef?.current?.focus(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-repo-title"
        className="dialog-panel p-0 max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <GitBranch size={20} aria-hidden="true" />
            <h3 id="connect-repo-title" className="font-heading font-semibold text-base text-ink dark:text-white m-0">{isEdit ? 'Edit Repo Link' : 'Connect a Repo'}</h3>
          </div>
          <button
            onClick={() => { onClose(); triggerRef?.current?.focus(); }}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <p className="error-text bg-coral/10 rounded-xl px-4 py-3 border border-coral/20" role="alert">{error}</p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="repo-site-url" className="block text-sm font-medium text-ink dark:text-white">Site URL</label>
            <input
              id="repo-site-url"
              ref={firstFieldRef}
              type="url"
              value={siteUrl}
              onChange={e => setSiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="input-base"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="repo-github-url" className="block text-sm font-medium text-ink dark:text-white">GitHub repo URL</label>
            <input
              id="repo-github-url"
              type="url"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="input-base"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="repo-branch" className="block text-sm font-medium text-ink dark:text-white">Default branch</label>
              <input
                id="repo-branch"
                type="text"
                value={defaultBranch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                className="input-base"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="repo-token" className="block text-sm font-medium text-ink dark:text-white">Access token</label>
              <input
                id="repo-token"
                type="password"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder="ghp_..."
                autoComplete="off"
                className="input-base"
              />
            </div>
          </div>
          <p className="text-xs text-body dark:text-gray-500">
            {isEdit
              ? "Re-enter the access token to save changes — it isn't shown here for security."
              : "A personal access token with repo read access. We'll verify it can reach the repo before saving."}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-white/[0.06]">
          <button onClick={() => { onClose(); triggerRef?.current?.focus(); }} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {loading
              ? <><RefreshCw size={13} className="animate-spin" /> {isEdit ? 'Saving…' : 'Connecting…'}</>
              : <><CheckCircle2 size={13} /> {isEdit ? 'Save & Verify' : 'Connect & Verify'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Repo link card ─────────────────────────────────────────────────────────────
function RepoLinkCard({ link, onEdit, onDisconnect, disconnecting, editButtonRef }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-ink dark:bg-white/10 flex items-center justify-center flex-shrink-0">
          <FolderGit2 size={19} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm text-ink dark:text-white truncate m-0">{repoDisplayName(link.repo_url)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-body dark:text-gray-400">
              {repoProviderLabel(link.repo_url)}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-body dark:text-gray-400">
              Branch {link.default_branch}
            </span>
          </div>
          <p className="text-[11px] text-body dark:text-gray-500 mt-1.5">
            Connected {formatDate(link.connected_at)}
            <span className="inline-flex items-center gap-1 ml-2 text-sage-700 dark:text-sage-300 font-semibold">
              <CheckCircle2 size={11} /> Connected
            </span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          ref={editButtonRef}
          onClick={() => onEdit(link)}
          className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
        >
          <Settings2 size={14} /> Manage
        </button>
        <button
          onClick={() => onDisconnect(link.id)}
          disabled={disconnecting === link.id}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral-700 dark:text-coral-300 px-2 py-2 rounded-lg hover:bg-coral/10 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
        >
          <Trash2 size={14} /> Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function RepoLinkingPage() {
  const [links, setLinks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editingLink, setEditingLink] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [toast, setToast]             = useState('');
  const connectButtonRef = useRef(null);
  const editButtonRef = useRef(null);
  const [lastTrigger, setLastTrigger] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await apiFetch('/api/repo-links');
      const data = await res.json();
      if (data.ok) setLinks(data.links || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleDisconnect(linkId) {
    setDisconnecting(linkId);
    try {
      const res  = await apiFetch(`/api/repo-links/${linkId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) { showToast(data.error || 'Could not disconnect'); return; }
      showToast('Repo disconnected');
      load();
    } catch {
      showToast('Could not reach the server');
    } finally { setDisconnecting(null); }
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night page-content min-h-0" role="main">
      <div className="max-w-[1200px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">Connected Repos</h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Link a scanned site to its GitHub repo so Auto Fix knows where the real source code lives.
            </p>
          </div>
          <button
            ref={connectButtonRef}
            onClick={() => { setLastTrigger(connectButtonRef); setShowModal(true); }}
            className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
          >
            <Plus size={14} /> Connect Repo
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-ink dark:bg-white text-white dark:text-ink text-sm font-semibold px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in" role="status">
            <CheckCircle2 size={16} className="text-sage" /> {toast}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
          {/* LEFT — repo list */}
          <div className="space-y-3 min-w-0">
            {loading ? (
              <div className="space-y-3">
                {[0, 1].map(i => (
                  <div key={i} className="h-[68px] rounded-2xl skeleton" />
                ))}
              </div>
            ) : links.length === 0 ? (
              <div className="empty-state border-2 border-dashed border-gray-200 dark:border-white/10 rounded-2xl bg-white dark:bg-charcoal">
                <FolderGit2 size={28} className="text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm font-semibold text-ink dark:text-white mb-1">No repositories connected yet</p>
                <p className="text-sm text-body dark:text-gray-400 mb-4">Connect your first repository to start reviewing accessibility issues and applying verified fixes.</p>
                <button onClick={() => { setLastTrigger(connectButtonRef); setShowModal(true); }} className="btn-primary text-sm">
                  Connect repository
                </button>
              </div>
            ) : (
              links.map(link => (
                <RepoLinkCard
                  key={link.id}
                  link={link}
                  onEdit={(l) => { setLastTrigger(editButtonRef); setEditingLink(l); }}
                  onDisconnect={handleDisconnect}
                  disconnecting={disconnecting}
                  editButtonRef={editButtonRef}
                />
              ))
            )}
          </div>

          {/* RIGHT — repository setup info (static, accurate help copy) */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-5">
              <p className="font-heading font-semibold text-sm text-ink dark:text-white mb-1">Repository setup</p>
              <p className="text-xs text-body dark:text-gray-400 mb-4 leading-relaxed">
                Connect your repositories to continuously scan, review, and fix accessibility issues.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><Link2 size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink dark:text-white m-0">Connect securely</p>
                    <p className="text-xs text-body dark:text-gray-400 m-0 leading-relaxed">Use a personal access token to grant read access to your repositories.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><Lock size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink dark:text-white m-0">Least-privilege access</p>
                    <p className="text-xs text-body dark:text-gray-400 m-0 leading-relaxed">We only read repository contents to scan and suggest fixes — nothing is written without your approval.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><ShieldCheck size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink dark:text-white m-0">Private and encrypted</p>
                    <p className="text-xs text-body dark:text-gray-400 m-0 leading-relaxed">Tokens are encrypted at rest and never shown again after saving. Disconnect any time.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(showModal || editingLink) && (
        <ConnectRepoModal
          initial={editingLink}
          triggerRef={lastTrigger}
          onClose={() => { setShowModal(false); setEditingLink(null); }}
          onConnected={() => {
            showToast(editingLink ? 'Repo link updated' : 'Repo connected');
            load();
          }}
        />
      )}
    </main>
  );
}
