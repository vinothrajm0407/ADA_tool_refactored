import KeyboardNavigationModule from './KeyboardNavigationModule';
import ColorContrastModule from './ColorContrastModule';
import PageStructureModule from './PageStructureModule';
import FormsAccessibilityModule from './FormsAccessibilityModule';
import PlaceholderModule from './PlaceholderModule';

export const MODULE_LABELS = {
  keyboard:         'Keyboard Navigation',
  'color-contrast': 'Color Contrast',
  'page-structure': 'Page Structure',
  forms:            'Forms Accessibility',
};

// Shared per-module result renderer — used by both the dedicated Assistive
// Results page and the inline "Run Assistive Test" panel on the scan results view.
export default function AssistiveResultView({ result }) {
  const { testType } = result;
  if (testType === 'keyboard')       return <KeyboardNavigationModule result={result} />;
  if (testType === 'color-contrast') return <ColorContrastModule result={result} />;
  if (testType === 'page-structure') return <PageStructureModule result={result} />;
  if (testType === 'forms')          return <FormsAccessibilityModule result={result} />;
  return <PlaceholderModule module={{ label: MODULE_LABELS[testType] ?? testType }} />;
}
