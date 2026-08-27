import { useState, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/api';
import {
  Keyboard, Eye, Play, AlertCircle, Search,
  Layers, FileText, MousePointer, ArrowUpDown, AlignLeft, Image, Volume2,
} from 'lucide-react';
import GlowInput from '../components/ui/GlowInput';
import ScanProgress from '../components/newscan/ScanProgress';
import './NewScanPage.css';
import ModuleSelector from '../components/assistive/ModuleSelector';

// ─── Module registry ────────────────────────────────────────────────────────
// Add new modules here. Set status: 'active' + endpoint when ready to ship.
const MODULES = [
  {
    id: 'keyboard',
    label: 'Keyboard Navigation',
    icon: Keyboard,
    status: 'active',
    description: 'Tab order, focus traps, skip links, visible focus indicators',
    endpoint: '/api/assisted/keyboard',
  },
  {
    id: 'color-contrast',
    label: 'Color Contrast',
    icon: Eye,
    status: 'active',
    description: 'WCAG 1.4.3 contrast ratio analysis across all text elements',
    endpoint: '/api/assisted/color-contrast',
  },
  {
    id: 'modal',
    label: 'Modal Accessibility',
    icon: Layers,
    status: 'planned',
    description: 'Focus trapping, dialog roles, escape key handling',
  },
  {
    id: 'forms',
    label: 'Forms Accessibility',
    icon: FileText,
    status: 'active',
    description: 'Labels, required fields, autocomplete attributes, fieldset grouping',
    endpoint: '/api/assisted/forms',
  },
  {
    id: 'interactive',
    label: 'Interactive Components',
    icon: MousePointer,
    status: 'planned',
    description: 'Custom widgets, ARIA states, keyboard interaction patterns',
  },
  {
    id: 'focus-order',
    label: 'Focus Order Analysis',
    icon: ArrowUpDown,
    status: 'planned',
    description: 'Visual vs DOM order comparison, focus sequence logic',
  },
  {
    id: 'page-structure',
    label: 'Page Structure',
    icon: AlignLeft,
    status: 'active',
    description: 'Heading hierarchy, landmark regions, document outline',
    endpoint: '/api/assisted/page-structure',
  },
  {
    id: 'alt-text',
    label: 'Images & Alt Text',
    icon: Image,
    status: 'planned',
    description: 'Alt text quality, decorative image detection, figure elements',
  },
  {
    id: 'screen-reader',
    label: 'Screen Reader Readiness',
    icon: Volume2,
    status: 'planned',
    description: 'ARIA labels, live regions, announcement quality',
  },
];

// ─── Generic result normalizer ───────────────────────────────────────────────
// Wraps raw API data into the AssistiveTestResult shape.
// Module components access result.metadata for raw API fields.
function buildResult(rawData, testType, url) {
  return {
    testType,
    url,
    score: null,
    findings: rawData?.issues ?? rawData?.elements ?? rawData?.results ?? rawData?.items ?? [],
    metadata: rawData,
    executedAt: new Date().toISOString(),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AssistiveTestingPage() {
  const {
    pendingAssistiveUrl, setPendingAssistiveUrl,
    pendingAssistiveModule, setPendingAssistiveModule,
    setAssistiveResult, navigate,
  } = useApp();
  const [activeModuleId, setActiveModuleId] = useState('keyboard');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRun, setAutoRun] = useState(false);

  useEffect(() => {
    if (pendingAssistiveUrl) {
      setUrl(pendingAssistiveUrl);
      setPendingAssistiveUrl('');
    }
    if (pendingAssistiveModule) {
      setActiveModuleId(pendingAssistiveModule);
      setPendingAssistiveModule(null);
      setAutoRun(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRun && url.trim()) {
      setAutoRun(false);
      handleRunTest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, url]);

  const activeModule = MODULES.find((m) => m.id === activeModuleId);

  const handleRunTest = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a URL to test.');
      return;
    }
    if (!activeModule || activeModule.status !== 'active') return;

    setLoading(true);
    setError('');

    try {
      const res = await apiFetch(activeModule.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Test failed. Please check the URL and try again.');
      } else {
        setAssistiveResult(buildResult(data.result ?? data, activeModuleId, trimmed));
        navigate('assistive-results');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [url, activeModule, activeModuleId, setAssistiveResult, navigate]);

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">

      {/* HEADER */}
      <div>
        <h1 className="font-heading font-bold text-2xl text-ink dark:text-white">
          Assistive Testing
        </h1>
        <p className="text-sm text-body dark:text-gray-400 mt-1">
          Run advanced accessibility validations that go beyond automated WCAG scanning.
        </p>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
          <ScanProgress bare url={url} />
        </div>
      ) : (
        <>
          {/* STEP 1 — URL INPUT */}
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
              Step 1 — Enter URL
            </p>
            <GlowInput
              large
              icon={Search}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRunTest(); }}
              placeholder="https://example.com"
              aria-label="URL to test"
            />
          </div>

          {/* STEP 2 — MODULE SELECTOR */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3 px-1">
              Step 2 — Select Test
            </p>
            <ModuleSelector
              modules={MODULES}
              activeModuleId={activeModuleId}
              onSelect={(id) => { setActiveModuleId(id); setError(''); }}
            />
          </div>

          {/* STEP 3 — RUN */}
          {activeModule?.status === 'active' && (
            <div>
              <button
                onClick={handleRunTest}
                disabled={!url.trim()}
                className="btn-primary w-full justify-center py-4 text-base font-semibold"
              >
                <Play className="w-5 h-5" />
                Run Test
              </button>

              {error && (
                <div className="mt-3 flex items-start gap-2 bg-coral/15 text-coral rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
}
