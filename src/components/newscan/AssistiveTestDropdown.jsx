import { useState, useRef, useEffect } from 'react';
import { Play, ChevronDown, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import { MODULES, buildAssistiveResult } from '../../config/assistiveModules';

const ACTIVE_MODULES = MODULES.filter(m => m.status === 'active');

// Popover-triggered version of Assistive Testing — picks one or more modules
// and runs them right here on the scan results view, instead of navigating
// away to a separate page. Results persist on the scan session (see
// AssistiveResultsPanel, rendered alongside this in ScanResults.jsx) so
// they're still there if the user switches tabs and comes back.
export default function AssistiveTestDropdown({ scanUrl, sessionId }) {
  const { updateSessionAssistive, setPendingAssistiveUrl, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set([ACTIVE_MODULES[0]?.id].filter(Boolean)));
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function toggleModule(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runOne(module) {
    updateSessionAssistive(sessionId, module.id, { status: 'running' });
    try {
      const res = await apiFetch(module.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanUrl }),
      });
      const data = await res.json();
      if (!data.ok) {
        updateSessionAssistive(sessionId, module.id, { status: 'error', error: data.error ?? 'Test failed.' });
        return;
      }
      const result = buildAssistiveResult(data.result ?? data, module.id, scanUrl);
      updateSessionAssistive(sessionId, module.id, { status: 'done', result });
    } catch {
      updateSessionAssistive(sessionId, module.id, { status: 'error', error: 'Network error. Please try again.' });
    }
  }

  function handleRunSelected() {
    setOpen(false);
    ACTIVE_MODULES.filter(m => selected.has(m.id)).forEach(runOne);
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
      >
        <Play className="w-3.5 h-3.5" />
        Run Assistive Test
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-charcoal rounded-xl border border-gray-200 dark:border-white/10 shadow-lg z-20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-body dark:text-gray-400 px-1 mb-2">
            Which tests should run?
          </p>
          <div className="space-y-1 mb-3">
            {ACTIVE_MODULES.map(m => (
              <label key={m.id} className="flex items-start gap-2.5 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleModule(m.id)}
                  className="mt-0.5 accent-teal"
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink dark:text-white">{m.label}</span>
                  <span className="block text-[11px] text-body dark:text-gray-400">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRunSelected}
            disabled={selected.size === 0}
            className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Run Selected
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setPendingAssistiveUrl(scanUrl); navigate('assistive-test'); }}
            className="w-full text-center text-[11.5px] font-medium text-teal hover:underline mt-2 flex items-center justify-center gap-1"
          >
            <ExternalLink size={11} /> Open full Assistive Testing page
          </button>
        </div>
      )}
    </div>
  );
}
