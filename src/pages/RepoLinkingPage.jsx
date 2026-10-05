import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, CheckCircle2, Trash2, Plus, X, RefreshCw, Settings2,
  Link2, Lock, ShieldCheck, FolderGit2, Rocket,
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import PageHeader from '../components/ui/PageHeader';

// ── Brand logos ────────────────────────────────────────────────────────────────
// Real brand marks, same approach as SlackLogo/TeamsLogo in IntegrationsPage.jsx —
// lucide ships no brand icons, so these are hand-drawn inline SVGs.
function GitHubLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#181717">
      <path d="M12 .5C5.73.5.98 5.24.98 11.5c0 5.02 3.26 9.28 7.77 10.79.57.1.78-.24.78-.55v-2.15c-3.16.7-3.83-1.44-3.83-1.44-.52-1.3-1.28-1.65-1.28-1.65-1.04-.72.08-.7.08-.7 1.16.08 1.76 1.19 1.76 1.19 1.03 1.75 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.66 5.31-5.19 5.59.41.35.77 1.05.77 2.12v3.14c0 .31.21.66.79.55A10.52 10.52 0 0 0 23.02 11.5C23.02 5.24 18.27.5 12 .5z"/>
    </svg>
  );
}

function GitLabLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polygon points="12,22.5 16.2,9.7 7.8,9.7" fill="#e24329"/>
      <polygon points="12,22.5 7.8,9.7 3.2,9.7 1.3,15.6" fill="#fc6d26"/>
      <polygon points="12,22.5 3.2,9.7 1.3,15.6 0.15,19.1 12,22.5" fill="#fca326"/>
      <polygon points="12,22.5 16.2,9.7 20.8,9.7 22.7,15.6" fill="#fc6d26"/>
      <polygon points="12,22.5 20.8,9.7 22.7,15.6 23.85,19.1 12,22.5" fill="#fca326"/>
      <polygon points="7.8,9.7 12,22.5 16.2,9.7" fill="#fc6d26"/>
      <polygon points="3.9,2.2 7.8,9.7 3.2,9.7" fill="#e24329"/>
      <polygon points="20.1,2.2 16.2,9.7 20.8,9.7" fill="#e24329"/>
    </svg>
  );
}

function BitbucketLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect width="24" height="24" rx="4" fill="#0052CC"/>
      <path d="M6 7.5h12l-1.7 10.2a1 1 0 0 1-1 .8H8.7a1 1 0 0 1-1-.8L6 7.5z" fill="#fff"/>
      <path d="M14.6 14H9.4l-.9-5.2h7l-.9 5.2z" fill="#0052CC"/>
    </svg>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// The backend validates github.com, gitlab.com, bitbucket.org and Azure
// DevOps repo URLs (see _GITHUB_REPO_RE / _GITLAB_REPO_RE / _BITBUCKET_REPO_RE
// / _AZURE_REPO_RE in app.py) — this just derives a display label from the
// same host the backend already checked.
function repoProviderLabel(repoUrl) {
  try {
    const host = new URL(repoUrl).hostname.replace(/^www\./, '');
    if (host === 'github.com') return 'GitHub';
    if (host === 'gitlab.com') return 'GitLab';
    if (host === 'bitbucket.org') return 'Bitbucket';
    if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) return 'Azure DevOps';
    return host;
  } catch { return 'Repository'; }
}

function repoDisplayName(repoUrl) {
  try {
    const path = new URL(repoUrl).pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '');
    return path || repoUrl;
  } catch { return repoUrl; }
}

// Provider icon tile — same host detection as repoProviderLabel. Real brand
// marks on a neutral tile (matching how Slack/Teams logos render elsewhere in
// this app), rather than forcing each brand's color onto a generic icon.
function repoProviderIconMeta(repoUrl) {
  try {
    const host = new URL(repoUrl).hostname.replace(/^www\./, '');
    if (host === 'github.com')    return { bg: 'bg-gray-50 border border-gray-100', Icon: GitHubLogo };
    if (host === 'gitlab.com')    return { bg: 'bg-gray-50 border border-gray-100', Icon: GitLabLogo };
    if (host === 'bitbucket.org') return { bg: 'bg-gray-50 border border-gray-100', Icon: BitbucketLogo };
    if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com'))
      // Lucide's Rocket glyph sits smaller within its own viewBox than the
      // hand-drawn logos above (which fill it edge-to-edge) — bump size and
      // stroke weight so it reads at the same visual scale on the tile.
      return { bg: 'bg-[#0078D4]', Icon: Rocket, size: 34, strokeWidth: 2.25 };
    return { bg: 'bg-ink', Icon: FolderGit2 };
  } catch { return { bg: 'bg-ink', Icon: FolderGit2 }; }
}

// Where to create an access token, and which scopes it needs, per provider —
// shown live under the Access Token field so no one has to go dig this up
// again (see chat: GitHub tokens/personal access tokens, GitLab's project
// access tokens, Bitbucket's newer "API tokens with scopes" under the
// Atlassian account rather than the old App passwords page).
const TOKEN_GUIDES = {
  'github.com': {
    label: 'GitHub', url: 'https://github.com/settings/tokens/new?scopes=repo&description=ADA+Tool',
    scopes: 'repo scope covers private read/write.',
    steps: [
      'Go to github.com → click your avatar (top right) → Settings.',
      'Scroll down to Developer settings → Personal access tokens → Tokens (classic).',
      'Click Generate new token (classic).',
      'Give it a name (e.g. "ADA Tool"), set an expiry.',
      'Check the repo scope — this covers both public and private repo read/write.',
      'Click Generate token, then copy it immediately — GitHub only shows it once.',
    ],
  },
  'gitlab.com': {
    label: 'GitLab', url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    // read_repository/write_repository only cover git clone/push — this app
    // also calls GitLab's REST API directly (to verify the repo on connect,
    // and to open/merge MRs for Auto-Fix), which needs the broader `api`
    // scope. GitLab's docs confirm `api` also covers git-over-HTTP, so it's
    // the one scope that covers everything this app needs.
    scopes: 'Check api — read_repository/write_repository alone are not enough, since this app also calls the GitLab REST API to verify the repo and open merge requests.',
    steps: [
      'Go to gitlab.com → click your avatar → Edit profile → Access Tokens.',
      'Click Add new token.',
      'Give it a name and expiry date.',
      'Check api (covers repo verification, git push, and opening merge requests — read_repository alone is not enough).',
      'Click Create personal access token, then copy it — shown only once.',
    ],
  },
  'bitbucket.org': {
    label: 'Bitbucket', url: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    scopes: 'Create an API token with scopes → app: Bitbucket → read:repository:bitbucket (+ write:repository:bitbucket, read/write:pullrequest:bitbucket for Auto-Fix).',
    steps: [
      'Go to id.atlassian.com/manage-profile/security/api-tokens.',
      'Click Create API token with scopes.',
      'Name it (e.g. "ADA Tool"), set an expiry, click Next.',
      'Select app: Bitbucket, click Next.',
      'Search "repository" and check read:repository:bitbucket (+ write:repository:bitbucket for Auto-Fix pushes).',
      'Search "pullrequest" and check read:pullrequest:bitbucket (+ write:pullrequest:bitbucket so Auto-Fix can open a PR).',
      'Click Next, then Create, and copy the token — shown only once.',
    ],
  },
  'dev.azure.com': {
    label: 'Azure DevOps', url: 'https://dev.azure.com/_usersSettings/tokens',
    scopes: 'Create a PAT with Code (Read & Write) — and Code (Status) if you also want Auto-Fix to open pull requests.',
    steps: [
      'Click the link above — it goes straight to your org\'s token page (org filled in automatically once your Repo URL below names one).',
      'Click + New Token.',
      'Give it a name and expiry, and pick the organization it applies to.',
      'Under Scopes, select Code and check Read & Write.',
      'Click Create, then copy the token — shown only once.',
    ],
  },
};

// Same regex shape as _AZURE_REPO_RE in app.py — extracts the org so the
// token-creation link can go straight to https://dev.azure.com/{org}/_usersSettings/tokens
// instead of the generic dev.azure.com landing page, which doesn't have an
// org selected yet.
const _AZURE_REPO_RE = /^https?:\/\/(?:[\w.-]+@)?dev\.azure\.com\/([\w.-]+)\/[^/]+\/_git\/[\w.-]+?\/?$/;
const _AZURE_VSTS_REPO_RE = /^https?:\/\/([\w.-]+)\.visualstudio\.com\/[^/]+\/_git\/[\w.-]+?\/?$/;

function _azureOrgFrom(repoUrl) {
  return _AZURE_REPO_RE.exec(repoUrl)?.[1] || _AZURE_VSTS_REPO_RE.exec(repoUrl)?.[1] || null;
}

// dev.azure.com is the one fixed host; {org}.visualstudio.com is the legacy
// shape where the org itself is the subdomain, so it can't be a literal key.
function tokenGuideFor(repoUrl) {
  try {
    const host = new URL(repoUrl).hostname.replace(/^www\./, '');
    const isAzure = host === 'dev.azure.com' || host.endsWith('.visualstudio.com');
    if (!isAzure) return TOKEN_GUIDES[host] || null;
    const org = _azureOrgFrom(repoUrl);
    const guide = TOKEN_GUIDES['dev.azure.com'];
    return org ? { ...guide, url: `https://dev.azure.com/${org}/_usersSettings/tokens` } : guide;
  } catch { return null; }
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
    if (!siteUrl.trim() || !repoUrl.trim() || (!isEdit && !accessToken.trim())) {
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
          ...(isEdit ? { link_id: initial.id } : {}),
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <GitBranch size={20} aria-hidden="true" />
            <h3 id="connect-repo-title"className="font-heading font-semibold text-base text-ink m-0">{isEdit ?'Edit Repo Link':'Connect a Repo'}</h3>
          </div>
          <button
            onClick={() => { onClose(); triggerRef?.current?.focus(); }}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-gray-400 hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <p className="error-text bg-coral/10 rounded-xl px-4 py-3 border border-coral/20" role="alert">{error}</p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="repo-site-url"className="block text-sm font-medium text-ink">Site URL</label>
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
            <div className="flex items-center justify-between">
              <label htmlFor="repo-github-url"className="block text-sm font-medium text-ink">Repo URL</label>
              {tokenGuideFor(repoUrl) && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal">
                  <CheckCircle2 size={11} /> Detected: {tokenGuideFor(repoUrl).label}
                </span>
              )}
            </div>
            <input
              id="repo-github-url"
              type="url"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo, gitlab.com/owner/repo, bitbucket.org/workspace/repo, or dev.azure.com/org/project/_git/repo"
              className="input-base"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="repo-branch"className="block text-sm font-medium text-ink">Default branch</label>
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
              <label htmlFor="repo-token"className="block text-sm font-medium text-ink">Access token{isEdit ? ' (optional)' : ''}</label>
              <input
                id="repo-token"
                type="password"
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep the current token' : 'ghp_..., glpat-..., a Bitbucket token, or an Azure DevOps PAT'}
                autoComplete="off"
                className="input-base"
              />
            </div>
          </div>
          <p className="text-xs text-body">
            {isEdit
              ? "Leave blank to keep the current token, or enter a new one to replace it."
              : "A GitHub, GitLab, Bitbucket, or Azure DevOps personal/repository access token with repo read access. We'll verify it can reach the repo before saving."}
          </p>
          {(() => {
            const guide = tokenGuideFor(repoUrl);
            const guides = guide ? [guide] : Object.values(TOKEN_GUIDES);
            return (
              <div className="bg-teal/5 border border-teal/15 rounded-lg divide-y divide-teal/10">
                {guides.map(g => (
                  <details key={g.label} className="group px-3 py-2">
                    <summary className="text-xs font-semibold text-ink cursor-pointer list-none flex items-center justify-between gap-2">
                      <span>
                        Need a {g.label} token?{' '}
                        <a href={g.url} target="_blank" rel="noopener noreferrer"
                           onClick={e => e.stopPropagation()}
                           className="text-teal font-semibold hover:underline">Create one →</a>
                      </span>
                      <span className="text-teal text-[10px] group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <ol className="mt-2 space-y-1 text-xs text-body list-decimal list-inside">
                      {g.steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    <p className="mt-2 text-[11px] text-body italic">{g.scopes}</p>
                  </details>
                ))}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
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
  const { bg, Icon, size = 30, strokeWidth } = repoProviderIconMeta(link.repo_url);
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 bg-white rounded-2xl border border-gray-100 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}>
          <Icon size={size} strokeWidth={strokeWidth} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm text-ink truncate m-0">{repoDisplayName(link.repo_url)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-body">
              {repoProviderLabel(link.repo_url)}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-gray-100 text-body">
              Branch {link.default_branch}
            </span>
          </div>
          <p className="text-[11px] text-body mt-1.5">
            Connected {formatDate(link.connected_at)}
            <span className="inline-flex items-center gap-1 ml-2 text-sage-700 font-semibold">
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
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral-700 px-2 py-2 rounded-lg hover:bg-coral/10 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
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
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0"role="main">
      <div className="max-w-[1200px] mx-auto">

        <PageHeader
          title="Connected Repos"
          description="Link a scanned site to its GitHub, GitLab, Bitbucket, or Azure DevOps repo so Auto Fix knows where the real source code lives."
          className="mb-6"
          actions={
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                ref={connectButtonRef}
                onClick={() => { setLastTrigger(connectButtonRef); setShowModal(true); }}
                className="btn-primary text-sm flex items-center gap-2"
              >
                <Plus size={14} /> Connect repository
              </button>
            </div>
          }
        />

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-ink text-white text-sm font-semibold px-5 py-3 rounded-xl flex items-center gap-2 animate-fade-in"role="status">
            <CheckCircle2 size={16} className="text-sage" /> {toast}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
          {/* LEFT — repo list */}
          <div className="space-y-3 min-w-0">
            <div className="alert-info items-center gap-2 py-2.5 text-xs">
              <Lock size={14} className="flex-shrink-0" />
              Your data is secure and never shared with third parties.
            </div>
            {loading ? (
              <div className="space-y-3">
                {[0, 1].map(i => (
                  <div key={i} className="h-[68px] rounded-2xl skeleton" />
                ))}
              </div>
            ) : links.length === 0 ? (
              <div className="empty-state border-2 border-dashed border-gray-200 rounded-2xl bg-white">
                <FolderGit2 size={28} className="text-gray-300 mb-3"/>
                <p className="text-sm font-semibold text-ink mb-1">No repositories connected yet</p>
                <p className="text-sm text-body mb-4">Connect your first repository to start reviewing accessibility issues and applying verified fixes.</p>
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
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="font-heading font-semibold text-sm text-ink mb-1">Repository setup</p>
              <p className="text-xs text-body mb-4 leading-relaxed">
                Connect your repositories to continuously scan, review, and fix accessibility issues.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><Link2 size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink m-0">Connect securely</p>
                    <p className="text-xs text-body m-0 leading-relaxed">Use a personal access token to grant read access to your repositories.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><Lock size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink m-0">Least-privilege access</p>
                    <p className="text-xs text-body m-0 leading-relaxed">We only read repository contents to scan and suggest fixes — nothing is written without your approval.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-teal/10 text-teal flex items-center justify-center flex-shrink-0"><ShieldCheck size={15} /></span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink m-0">Private and encrypted</p>
                    <p className="text-xs text-body m-0 leading-relaxed">Tokens are encrypted at rest and never shown again after saving. Disconnect any time.</p>
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
