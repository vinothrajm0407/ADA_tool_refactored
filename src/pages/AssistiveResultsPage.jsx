import { useEffect } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import KeyboardNavigationModule from '../components/assistive/KeyboardNavigationModule';
import ColorContrastModule from '../components/assistive/ColorContrastModule';
import PageStructureModule from '../components/assistive/PageStructureModule';
import FormsAccessibilityModule from '../components/assistive/FormsAccessibilityModule';
import PlaceholderModule from '../components/assistive/PlaceholderModule';

const MODULE_LABELS = {
  keyboard:       'Keyboard Navigation',
  'color-contrast': 'Color Contrast',
  'page-structure': 'Page Structure',
  forms:          'Forms Accessibility',
};

function ResultsContent({ result }) {
  const { testType } = result;
  if (testType === 'keyboard')       return <KeyboardNavigationModule result={result} />;
  if (testType === 'color-contrast') return <ColorContrastModule result={result} />;
  if (testType === 'page-structure') return <PageStructureModule result={result} />;
  if (testType === 'forms')          return <FormsAccessibilityModule result={result} />;
  return <PlaceholderModule module={{ label: MODULE_LABELS[testType] ?? testType }} />;
}

export default function AssistiveResultsPage() {
  const { assistiveResult, setAssistiveResult, navigate } = useApp();

  useEffect(() => {
    if (!assistiveResult) navigate('assistive-test');
  }, [assistiveResult, navigate]);

  if (!assistiveResult) return null;

  const moduleLabel = MODULE_LABELS[assistiveResult.testType] ?? assistiveResult.testType;

  function handleRunAnother() {
    setAssistiveResult(null);
    navigate('assistive-test');
  }

  function handleRerun() {
    // Pre-fill the same URL + module and navigate back to run again
    navigate('assistive-test');
  }

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">

      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={handleRunAnother}
              className="flex items-center gap-1.5 text-sm text-body dark:text-gray-400 hover:text-ink dark:hover:text-white transition-colors"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          </div>
          <h1 className="font-heading font-bold text-2xl text-ink dark:text-white">
            {moduleLabel}
          </h1>
          <p className="text-sm text-body dark:text-gray-400 mt-0.5 truncate max-w-lg" title={assistiveResult.url}>
            {assistiveResult.url}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleRerun}
            className="btn-secondary flex items-center gap-2 py-2 px-4 text-sm"
          >
            <RotateCcw size={14} />
            Run Another Test
          </button>
        </div>
      </div>

      {/* RESULTS */}
      <ResultsContent result={assistiveResult} />

    </div>
  );
}
