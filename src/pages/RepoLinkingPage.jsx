import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, CheckCircle2, Trash2, Plus, X, RefreshCw, Pencil,
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

// ── Connect Repo Modal ────────────────────────────────────────────────────────
function ConnectRepoModal({ onClose, onConnected, initial }) {
  const isEdit = Boolean(initial);
  const [siteUrl, setSiteUrl]           = useState(initial?.site_url || '');
  const [repoUrl, setRepoUrl]           = useState(initial?.repo_url || '');
  const [defaultBranch, setBranch]      = useState(initial?.default_branch || 'main');
  const [accessToken, setAccessToken]   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-charcoal rounded-2xl shadow-xl w-full max-w-md border border-gray-100 dark:border-white/10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <GitBranch size={20} />
            <h3 className="font-heading font-semibold text-base text-ink dark:text-white">{isEdit ? 'Edit Repo Link' : 'Connect a Repo'}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <p className="text-sm text-coral bg-coral/10 rounded-xl px-4 py-3 border border-coral/20">{error}</p>
          )}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink dark:text-white">Site URL</label>
            <input
              type="url"
              value={siteUrl}
              onChange={e => setSiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink dark:text-white">GitHub repo URL</label>
            <input
              type="url"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink dark:text-white">Default branch</label>
              <input
                type="text"
                value={defaultBranch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink dark:text-white">Access token</label>
              <input
                type="password"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
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
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

// ── Repo link row ─────────────────────────────────────────────────────────────
function RepoLinkRow({ link, onEdit, onDisconnect, disconnecting }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-teal/10 flex items-center justify-center flex-shrink-0">
          <GitBranch size={18} className="text-teal" />
        </div>
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm text-ink dark:text-white truncate">{link.domain}</p>
          <p className="text-[12px] text-body dark:text-gray-500 truncate">{link.repo_url} · {link.default_branch}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] text-body dark:text-gray-500 mr-2">Connected {formatDate(link.connected_at)}</span>
        <button
          onClick={() => onEdit(link)}
          className="p-2 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          title="Edit"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => onDisconnect(link.id)}
          disabled={disconnecting === link.id}
          className="p-2 rounded-lg text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors disabled:opacity-50"
          title="Disconnect"
        >
          <Trash2 size={15} />
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
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[900px] mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">Connected Repos</h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Link a scanned site to its GitHub repo so Auto Fix knows where the real source code lives.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
          >
            <Plus size={14} /> Connect Repo
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-ink dark:bg-white text-white dark:text-ink text-sm font-semibold px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
            <CheckCircle2 size={16} className="text-sage" /> {toast}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map(i => (
              <div key={i} className="h-[68px] rounded-2xl bg-gray-100 dark:bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : links.length === 0 ? (
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-10 text-center">
            <GitBranch size={28} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-body dark:text-gray-400">No repos connected yet. Connect one to enable Auto Fix for a site.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {links.map(link => (
              <RepoLinkRow
                key={link.id}
                link={link}
                onEdit={setEditingLink}
                onDisconnect={handleDisconnect}
                disconnecting={disconnecting}
              />
            ))}
          </div>
        )}
      </div>

      {(showModal || editingLink) && (
        <ConnectRepoModal
          initial={editingLink}
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
