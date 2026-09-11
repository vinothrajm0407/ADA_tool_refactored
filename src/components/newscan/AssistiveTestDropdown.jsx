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
        <div className="absolute right-0 top-full mt-2.5 w-80 bg-white rounded-2xl border border-gray-100 shadow-xl z-20 overflow-hidden">
          {/* Small pointer connecting the popover visually back to the button it came from */}
          <span className="absolute -top-1.5 right-5 w-3 h-3 bg-white border-t border-l border-gray-100 rotate-45" aria-hidden="true" />

          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <p className="text-[11px] font-bold uppercase tracking-widest text-body">
              Which tests should run?
            </p>
          </div>

          <div className="p-2">
            {ACTIVE_MODULES.map(m => (
              <label key={m.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-xl hover:bg-teal/5 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleModule(m.id)}
                  className="checkbox-base mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">{m.label}</span>
                  <span className="block text-[11px] text-body leading-snug mt-0.5">{m.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="p-3 pt-1 space-y-2 border-t border-gray-100">
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
              className="w-full text-center text-[11.5px] font-medium text-teal hover:underline flex items-center justify-center gap-1 py-0.5"
            >
              <ExternalLink size={11} /> Open full Assistive Testing page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
