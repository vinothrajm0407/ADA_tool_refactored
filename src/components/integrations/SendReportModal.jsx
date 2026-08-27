import { useState, useEffect } from 'react';
import { X, Send, RefreshCw, CheckCircle2, Hash } from 'lucide-react';
import { apiFetch } from '../../utils/api';

const REPORT_TYPES = [
  { id: 'scan_summary',  label: 'Scan Summary',  desc: 'Score, violations, and pass rate.' },
  { id: 'crawl_summary', label: 'Crawl Summary', desc: 'Pages scanned, avg score, total violations.' },
  { id: 'score_card',    label: 'Score Card',    desc: 'Accessibility score and pass rate only.' },
];

function SlackIcon({ size = 16 }) {
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

function TeamsIcon({ size = 16 }) {
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

/**
 * Reusable modal for sending an ADA report to a Slack or Teams channel.
 *
 * Props:
 *   onClose()              — close the modal
 *   defaultReportType      — 'scan_summary' | 'crawl_summary' | 'score_card'
 *   context                — { url, score, violations, pass_rate, pages?, reference? }
 */
export default function SendReportModal({ onClose, defaultReportType = 'scan_summary', context = {} }) {
  const [integrations, setIntegrations] = useState([]);
  const [channels, setChannels]         = useState([]);
  const [selectedInt, setSelectedInt]   = useState(null);
  const [selectedCh, setSelectedCh]     = useState(null);
  const [reportType, setReportType]     = useState(defaultReportType);
  const [note, setNote]                 = useState('');
  const [loading, setLoading]           = useState(true);
  const [chLoading, setChLoading]       = useState(false);
  const [sending, setSending]           = useState(false);
  const [sent, setSent]                 = useState(false);
  const [error, setError]               = useState('');

  useEffect(() => {
    apiFetch('/api/integrations')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.integrations.length > 0) {
          setIntegrations(d.integrations);
          setSelectedInt(d.integrations[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedInt) { setChannels([]); return; }
    setChLoading(true);
    setSelectedCh(null);
    apiFetch(`/api/integrations/${selectedInt.id}/channels`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setChannels(d.channels || []);
          if (d.channels?.length > 0) setSelectedCh(d.channels[0]);
        }
      })
      .catch(() => {})
      .finally(() => setChLoading(false));
  }, [selectedInt]);

  async function handleSend() {
    if (!selectedInt || !selectedCh) return;
    setError('');
    setSending(true);
    try {
      const res = await apiFetch('/api/integrations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integration_id: selectedInt.id,
          channel_id:     selectedCh.channel_id,
          report_type:    reportType,
          context,
          note,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Delivery failed'); return; }
      setSent(true);
      setTimeout(onClose, 1800);
    } catch {
      setError('Could not send report — check your connection');
    } finally {
      setSending(false);
    }
  }

  const canSend = selectedInt && selectedCh && !sending && !sent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-charcoal rounded-2xl shadow-xl w-full max-w-md border border-gray-100 dark:border-white/10">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Send size={16} className="text-teal" />
            <h3 className="font-heading font-semibold text-base text-ink dark:text-white">Send Report to Channel</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-ink dark:hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">

          {sent && (
            <div className="flex flex-col items-center py-4 gap-3 text-center">
              <CheckCircle2 size={40} className="text-sage" />
              <p className="font-semibold text-ink dark:text-white">Report sent successfully!</p>
            </div>
          )}

          {!sent && (
            <>
              {error && (
                <p className="text-sm text-coral bg-coral/10 rounded-xl px-4 py-3 border border-coral/20">{error}</p>
              )}

              {loading && (
                <p className="text-sm text-body dark:text-gray-400 animate-pulse text-center py-4">Loading integrations…</p>
              )}

              {!loading && integrations.length === 0 && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-sm text-body dark:text-gray-400">No integrations connected.</p>
                  <p className="text-xs text-body dark:text-gray-500">Go to Integrations to connect Slack or Teams first.</p>
                </div>
              )}

              {!loading && integrations.length > 0 && (
                <>
                  {/* Workspace selector */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-ink dark:text-white">Workspace</label>
                    <div className="flex flex-wrap gap-2">
                      {integrations.map(int => (
                        <button
                          key={int.id}
                          onClick={() => setSelectedInt(int)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                            selectedInt?.id === int.id
                              ? 'border-teal bg-teal/10 text-teal'
                              : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-teal/50'
                          }`}
                        >
                          {int.platform === 'slack' ? <SlackIcon size={14} /> : <TeamsIcon size={14} />}
                          {int.workspace_name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Channel selector */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-ink dark:text-white">Channel</label>
                    {chLoading && <p className="text-xs text-body dark:text-gray-400 animate-pulse">Loading channels…</p>}
                    {!chLoading && channels.length === 0 && (
                      <p className="text-xs text-body dark:text-gray-400">
                        No channels configured for this workspace. Add one on the Integrations page.
                      </p>
                    )}
                    {!chLoading && channels.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {channels.map(ch => (
                          <button
                            key={ch.channel_id}
                            onClick={() => setSelectedCh(ch)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                              selectedCh?.channel_id === ch.channel_id
                                ? 'border-teal bg-teal/10 text-teal'
                                : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-teal/50'
                            }`}
                          >
                            <Hash size={12} />
                            {ch.channel_name.replace(/^#/, '')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Report type */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-ink dark:text-white">Report type</label>
                    <div className="space-y-2">
                      {REPORT_TYPES.map(rt => (
                        <label
                          key={rt.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                            reportType === rt.id
                              ? 'border-teal bg-teal/5'
                              : 'border-gray-100 dark:border-white/[0.06] hover:border-teal/30'
                          }`}
                        >
                          <input
                            type="radio"
                            name="reportType"
                            value={rt.id}
                            checked={reportType === rt.id}
                            onChange={() => setReportType(rt.id)}
                            className="mt-0.5 accent-teal flex-shrink-0"
                          />
                          <div>
                            <p className="text-sm font-semibold text-ink dark:text-white">{rt.label}</p>
                            <p className="text-xs text-body dark:text-gray-400">{rt.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Optional note */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-ink dark:text-white">
                      Note <span className="text-body dark:text-gray-500 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      rows={2}
                      placeholder="e.g. Post-deploy scan for homepage redesign"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal resize-none"
                    />
                  </div>

                  {/* Preview strip */}
                  {context.url && (
                    <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl px-4 py-3 text-xs text-body dark:text-gray-400 space-y-1">
                      <p className="font-semibold text-ink dark:text-white text-[11px] uppercase tracking-widest">Preview</p>
                      <p><span className="font-medium text-ink dark:text-white">Site:</span> {context.url}</p>
                      {context.score != null && <p><span className="font-medium text-ink dark:text-white">Score:</span> {context.score}/100</p>}
                      {context.violations != null && <p><span className="font-medium text-ink dark:text-white">Violations:</span> {context.violations}</p>}
                      {context.pass_rate != null && <p><span className="font-medium text-ink dark:text-white">Pass Rate:</span> {context.pass_rate}%</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!sent && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-white/[0.06]">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {sending
                ? <><RefreshCw size={13} className="animate-spin" /> Sending…</>
                : <><Send size={13} /> Send Report</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
