import { useState, useEffect, useCallback } from 'react';
import {
  Plug, CheckCircle2, Circle, Trash2, Plus, X,
  RefreshCw, Send, Hash, Lock, ChevronDown, ChevronUp,
  AlertTriangle, CheckCheck, Clock,
} from 'lucide-react';
import { apiFetch } from '../utils/api';

// ── Slack SVG logo ────────────────────────────────────────────────────────────
function SlackLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#E01E5A"/>
      <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0"/>
      <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#2EB67D"/>
      <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#ECB22E"/>
      <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
    </svg>
  );
}

// ── Teams SVG logo ────────────────────────────────────────────────────────────
function TeamsLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M14.25 5.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z" fill="#5059C9"/>
      <path d="M18 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" fill="#5059C9"/>
      <path d="M15 10.5h3.75A.75.75 0 0 1 19.5 11.25v4.5a3 3 0 0 1-3 3h-.5a3 3 0 0 1-2.75-1.8A5.25 5.25 0 0 0 15 12v-1.5z" fill="#5059C9"/>
      <path d="M4.5 10.5h7.5a.75.75 0 0 1 .75.75V16.5a4.5 4.5 0 0 1-9 0v-5.25a.75.75 0 0 1 .75-.75z" fill="#7B83EB"/>
      <path d="M8.25 10.5V20.25" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M5.25 13.5h6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
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

function DeliveryStatusBadge({ status }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sage">
        <CheckCheck size={12} /> Delivered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-coral">
      <AlertTriangle size={12} /> Failed
    </span>
  );
}

function ReportTypeLabel({ type }) {
  const map = {
    scan_summary:  'Scan Summary',
    crawl_summary: 'Crawl Summary',
    score_card:    'Score Card',
  };
  return <span>{map[type] || type}</span>;
}

// ── Add Slack Channel Modal ───────────────────────────────────────────────────
function AddSlackChannelModal({ integrationId, onClose, onAdded }) {
  const [available, setAvailable]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState(null);
  const [purpose, setPurpose]       = useState('general');
  const [saving, setSaving]         = useState(false);
  const [testing, setTesting]       = useState(false);

  useEffect(() => {
    apiFetch(`/api/integrations/slack/${integrationId}/channels/available`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setAvailable(d.channels);
        else setError(d.error || 'Failed to load channels');
      })
      .catch(() => setError('Could not reach Slack API'))
      .finally(() => setLoading(false));
  }, [integrationId]);

  const filtered = available.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd() {
    if (!selected) return;
    setSaving(true);
    setTesting(true);
    try {
      // Send test message first
      const testRes = await apiFetch(`/api/integrations/slack/${integrationId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: selected.id }),
      });
      const testData = await testRes.json();
      setTesting(false);
      if (!testData.ok) {
        setError(testData.error || 'Test message failed — make sure the ADA bot is invited to this channel');
        setSaving(false);
        return;
      }
      // Save channel
      await apiFetch(`/api/integrations/${integrationId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: selected.id,
          channel_name: `#${selected.name}`,
          purpose,
        }),
      });
      onAdded();
      onClose();
    } catch {
      setError('Failed to add channel');
    } finally {
      setSaving(false);
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-charcoal rounded-2xl shadow-xl w-full max-w-md border border-gray-100 dark:border-white/10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <h3 className="font-heading font-semibold text-base text-ink dark:text-white">Add Slack Channel</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <p className="text-sm text-coral bg-coral/10 rounded-xl px-4 py-3 border border-coral/20">{error}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-ink dark:text-white mb-1.5">Search channels</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div className="border border-gray-100 dark:border-white/[0.06] rounded-xl overflow-hidden max-h-52 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-body dark:text-gray-400 animate-pulse">Loading channels…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="p-4 text-center text-sm text-body dark:text-gray-400">No channels found</div>
            )}
            {!loading && filtered.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                  selected?.id === c.id
                    ? 'bg-teal text-white'
                    : 'text-ink dark:text-white hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                {c.is_private ? <Lock size={13} className="flex-shrink-0 opacity-60" /> : <Hash size={13} className="flex-shrink-0 opacity-60" />}
                {c.name}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink dark:text-white mb-1.5">Purpose</label>
            <select
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              <option value="general">General Reports</option>
              <option value="alerts">Regression Alerts</option>
            </select>
          </div>
          <p className="text-xs text-body dark:text-gray-500">
            A test message will be sent to confirm the bot has access. Make sure you've invited the ADA bot to this channel first.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-white/[0.06]">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={!selected || saving}
            className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {testing ? <><RefreshCw size={13} className="animate-spin" /> Testing…</> :
             saving  ? <><RefreshCw size={13} className="animate-spin" /> Adding…</> :
                       <><Plus size={13} /> Add Channel</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Connect Teams Modal ───────────────────────────────────────────────────────
function ConnectTeamsModal({ onClose, onConnected }) {
  const [webhookUrl, setWebhookUrl]         = useState('');
  const [channelName, setChannelName]       = useState('');
  const [workspaceName, setWorkspaceName]   = useState('');
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');

  async function handleConnect() {
    setError('');
    if (!webhookUrl.trim() || !channelName.trim()) {
      setError('Webhook URL and channel name are required');
      return;
    }
    setLoading(true);
    try {
      const res  = await apiFetch('/api/integrations/teams/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_url:    webhookUrl.trim(),
          channel_name:   channelName.trim(),
          workspace_name: workspaceName.trim() || 'Microsoft Teams',
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Connection failed'); return; }
      onConnected();
      onClose();
    } catch {
      setError('Could not reach the webhook URL');
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
            <TeamsLogo size={20} />
            <h3 className="font-heading font-semibold text-base text-ink dark:text-white">Connect Microsoft Teams</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <p className="text-sm text-coral bg-coral/10 rounded-xl px-4 py-3 border border-coral/20">{error}</p>
          )}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-4 py-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
            <p className="font-semibold">How to get a webhook URL:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Go to the Teams channel you want to connect</li>
              <li>Click ··· → Connectors → Incoming Webhook</li>
              <li>Name it "ADA" and click Create</li>
              <li>Copy the webhook URL and paste it below</li>
            </ol>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink dark:text-white">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://XXX.webhook.office.com/webhookb2/..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink dark:text-white">Channel name</label>
              <input
                type="text"
                value={channelName}
                onChange={e => setChannelName(e.target.value)}
                placeholder="#accessibility"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink dark:text-white">Workspace label</label>
              <input
                type="text"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="My Team"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
          </div>
          <p className="text-xs text-body dark:text-gray-500">
            A test message will be sent to confirm the connection.
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
              ? <><RefreshCw size={13} className="animate-spin" /> Connecting…</>
              : <><CheckCircle2 size={13} /> Connect & Test</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Connected workspace panel ─────────────────────────────────────────────────
function WorkspacePanel({ integration, onDisconnect, onChannelAdded }) {
  const [channels, setChannels]       = useState([]);
  const [chLoading, setChLoading]     = useState(true);
  const [showAddChannel, setShowAdd]  = useState(false);
  const [removing, setRemoving]       = useState(null);
  const [expanded, setExpanded]       = useState(true);

  const loadChannels = useCallback(() => {
    setChLoading(true);
    apiFetch(`/api/integrations/${integration.id}/channels`)
      .then(r => r.json())
      .then(d => { if (d.ok) setChannels(d.channels || []); })
      .catch(() => {})
      .finally(() => setChLoading(false));
  }, [integration.id]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function handleRemoveChannel(channelId) {
    setRemoving(channelId);
    try {
      await apiFetch(`/api/integrations/${integration.id}/channels/${channelId}`, { method: 'DELETE' });
      loadChannels();
    } catch {} finally { setRemoving(null); }
  }

  const isSlack = integration.platform === 'slack';

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          {isSlack ? <SlackLogo size={20} /> : <TeamsLogo size={20} />}
          <div>
            <p className="font-semibold text-sm text-ink dark:text-white">{integration.workspace_name}</p>
            <p className="text-[11px] text-body dark:text-gray-500">
              {integration.channel_count} channel{integration.channel_count !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDisconnect(integration.id)}
            className="flex items-center gap-1.5 text-xs font-medium text-body dark:text-gray-400 hover:text-coral transition-colors px-2.5 py-1.5 rounded-lg hover:bg-coral/5"
          >
            <Trash2 size={13} /> Disconnect
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-white/[0.06] px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-body dark:text-gray-500">Channels</p>
            {isSlack && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-teal hover:underline"
              >
                <Plus size={13} /> Add Channel
              </button>
            )}
          </div>

          {chLoading && (
            <div className="space-y-2">
              {[1,2].map(i => <div key={i} className="h-9 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          )}

          {!chLoading && channels.length === 0 && (
            <div className="text-center py-6 text-sm text-body dark:text-gray-400">
              {isSlack
                ? 'No channels added yet. Click "Add Channel" to configure a destination.'
                : 'No channels configured.'}
            </div>
          )}

          {!chLoading && channels.map(ch => (
            <div key={ch.channel_id} className="flex items-center justify-between bg-gray-50 dark:bg-white/[0.03] rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-body dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm font-medium text-ink dark:text-white">{ch.channel_name}</span>
                {ch.purpose && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
                    {ch.purpose}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemoveChannel(ch.channel_id)}
                disabled={removing === ch.channel_id}
                className="p-1.5 rounded-lg text-gray-400 hover:text-coral transition-colors disabled:opacity-40"
                title="Remove channel"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAddChannel && isSlack && (
        <AddSlackChannelModal
          integrationId={integration.id}
          onClose={() => setShowAdd(false)}
          onAdded={() => { loadChannels(); onChannelAdded(); }}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IntegrationsPage() {
  const [integrations, setIntegrations]   = useState([]);
  const [deliveries, setDeliveries]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showTeamsModal, setShowTeams]    = useState(false);
  const [connectingSlack, setConnSlack]   = useState(false);
  const [slackError, setSlackError]       = useState('');
  const [disconnecting, setDisconnecting] = useState(null);
  const [toast, setToast]                 = useState('');

  const slackIntegrations = integrations.filter(i => i.platform === 'slack');
  const teamsIntegrations = integrations.filter(i => i.platform === 'teams');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [intRes, delRes] = await Promise.all([
        apiFetch('/api/integrations').then(r => r.json()),
        apiFetch('/api/integrations/deliveries?limit=15').then(r => r.json()),
      ]);
      if (intRes.ok)  setIntegrations(intRes.integrations || []);
      if (delRes.ok)  setDeliveries(delRes.deliveries || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Listen for OAuth popup result
  useEffect(() => {
    function onMessage(event) {
      if (event.data?.type === 'ada_slack_connected') {
        setConnSlack(false);
        showToast(`Connected to ${event.data.workspaceName}`);
        load();
      }
      if (event.data?.type === 'ada_oauth_error') {
        setConnSlack(false);
        setSlackError(event.data.error || 'Slack authorization failed');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleConnectSlack() {
    setSlackError('');
    setConnSlack(true);
    try {
      const res  = await apiFetch('/api/integrations/slack/start');
      const data = await res.json();
      if (!data.ok) {
        setSlackError(data.error || 'Could not start Slack authorization');
        setConnSlack(false);
        return;
      }
      const popup = window.open(
        data.auth_url,
        'slack_oauth',
        'width=600,height=700,left=200,top=100,menubar=no,toolbar=no,location=no'
      );
      if (!popup) {
        setSlackError('Popup blocked — please allow popups for this site and try again.');
        setConnSlack(false);
      }
    } catch {
      setSlackError('Failed to start Slack connection');
      setConnSlack(false);
    }
  }

  async function handleDisconnect(integrationId) {
    setDisconnecting(integrationId);
    try {
      await apiFetch(`/api/integrations/${integrationId}`, { method: 'DELETE' });
      showToast('Integration disconnected');
      load();
    } catch {} finally { setDisconnecting(null); }
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[900px] mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">Integrations</h1>
          <p className="text-body dark:text-gray-400 text-[0.9375rem]">
            Connect ADA to Slack or Microsoft Teams and send accessibility reports directly to your team's channels.
          </p>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-ink dark:bg-white text-white dark:text-ink text-sm font-semibold px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
            <CheckCircle2 size={16} className="text-sage" /> {toast}
          </div>
        )}

        {/* Connector cards */}
        <div className="grid sm:grid-cols-2 gap-5">

          {/* Slack card */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#4A154B]/10 flex items-center justify-center">
                  <SlackLogo size={22} />
                </div>
                <div>
                  <p className="font-heading font-semibold text-base text-ink dark:text-white">Slack</p>
                  <p className="text-[11px] text-body dark:text-gray-500">Post reports to any Slack channel</p>
                </div>
              </div>
              {slackIntegrations.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sage bg-sage/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={12} /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2.5 py-1 rounded-full">
                  <Circle size={12} /> Not connected
                </span>
              )}
            </div>
            <p className="text-sm text-body dark:text-gray-400 leading-relaxed">
              Authenticate with Slack to let ADA post scan summaries, crawl reports, and regression alerts to your team's channels.
            </p>
            {slackError && (
              <p className="text-xs text-coral bg-coral/10 rounded-xl px-3 py-2 border border-coral/20">{slackError}</p>
            )}
            <button
              onClick={handleConnectSlack}
              disabled={connectingSlack}
              className="btn-primary text-sm mt-auto flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {connectingSlack
                ? <><RefreshCw size={14} className="animate-spin" /> Connecting…</>
                : <><Plug size={14} /> Connect Slack Workspace</>}
            </button>
          </div>

          {/* Teams card */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5059C9]/10 flex items-center justify-center">
                  <TeamsLogo size={22} />
                </div>
                <div>
                  <p className="font-heading font-semibold text-base text-ink dark:text-white">Microsoft Teams</p>
                  <p className="text-[11px] text-body dark:text-gray-500">Post reports via incoming webhook</p>
                </div>
              </div>
              {teamsIntegrations.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sage bg-sage/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={12} /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2.5 py-1 rounded-full">
                  <Circle size={12} /> Not connected
                </span>
              )}
            </div>
            <p className="text-sm text-body dark:text-gray-400 leading-relaxed">
              Use a Teams Incoming Webhook connector to receive accessibility reports in any Teams channel — no admin consent needed.
            </p>
            <button
              onClick={() => setShowTeams(true)}
              className="btn-secondary text-sm mt-auto flex items-center justify-center gap-2"
            >
              <Plus size={14} /> Add Teams Channel
            </button>
          </div>
        </div>

        {/* Connected workspaces */}
        {loading && (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="h-24 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {!loading && integrations.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-heading font-semibold text-base text-ink dark:text-white">Connected Workspaces</h2>
            {integrations.map(integration => (
              <WorkspacePanel
                key={integration.id}
                integration={integration}
                onDisconnect={id => {
                  if (window.confirm('Disconnect this integration? Configured channels will be removed.')) {
                    handleDisconnect(id);
                  }
                }}
                onChannelAdded={load}
              />
            ))}
          </div>
        )}

        {/* Delivery log */}
        {!loading && deliveries.length > 0 && (
          <div>
            <h2 className="font-heading font-semibold text-base text-ink dark:text-white mb-4">Recent Deliveries</h2>
            <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/[0.06]">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">Report</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">Channel</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">Platform</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">Time</th>
                    <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d, i) => (
                    <tr
                      key={d.id}
                      className={`${i < deliveries.length - 1 ? 'border-b border-gray-50 dark:border-white/[0.04]' : ''} hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors`}
                    >
                      <td className="px-5 py-3 text-ink dark:text-white font-medium">
                        <ReportTypeLabel type={d.report_type} />
                      </td>
                      <td className="px-5 py-3 text-body dark:text-gray-400">{d.channel_name || '—'}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-body dark:text-gray-400">
                          {d.platform === 'slack' ? <SlackLogo size={13} /> : <TeamsLogo size={13} />}
                          {d.workspace_name}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-body dark:text-gray-400 text-xs">
                        <span className="flex items-center gap-1"><Clock size={11} />{formatDate(d.sent_at)}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DeliveryStatusBadge status={d.status} />
                        {d.error_message && (
                          <p className="text-[10px] text-coral mt-0.5">{d.error_message}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && integrations.length === 0 && (
          <div className="text-center py-12 text-body dark:text-gray-400 space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-4">
              <Send className="w-7 h-7 text-teal" />
            </div>
            <p className="font-heading font-semibold text-base text-ink dark:text-white">No integrations connected yet</p>
            <p className="text-sm max-w-xs mx-auto">
              Connect Slack or Microsoft Teams to start sending accessibility reports directly to your team's channels.
            </p>
          </div>
        )}

        {/* Setup note */}
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl px-5 py-4 text-xs text-body dark:text-gray-500 space-y-1">
          <p className="font-semibold text-ink dark:text-gray-300">Slack setup note</p>
          <p>
            Slack requires a registered Slack App with <code className="font-mono text-[10px]">chat:write</code>, <code className="font-mono text-[10px]">channels:read</code>, and <code className="font-mono text-[10px]">groups:read</code> scopes.
            Set <code className="font-mono text-[10px]">SLACK_CLIENT_ID</code> and <code className="font-mono text-[10px]">SLACK_CLIENT_SECRET</code> in your environment variables to enable OAuth.
          </p>
        </div>

      </div>

      {showTeamsModal && (
        <ConnectTeamsModal
          onClose={() => setShowTeams(false)}
          onConnected={() => { showToast('Teams channel connected'); load(); }}
        />
      )}
    </main>
  );
}
