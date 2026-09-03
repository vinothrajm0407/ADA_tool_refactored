import {
  Keyboard, Eye, Layers, FileText, MousePointer, ArrowUpDown, AlignLeft, Image, Volume2,
} from 'lucide-react';

// Add new modules here. Set status: 'active' + endpoint when ready to ship.
export const MODULES = [
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

// Wraps raw API data into the AssistiveTestResult shape.
// Module components access result.metadata for raw API fields.
export function buildAssistiveResult(rawData, testType, url) {
  return {
    testType,
    url,
    score: null,
    findings: rawData?.issues ?? rawData?.elements ?? rawData?.results ?? rawData?.items ?? [],
    metadata: rawData,
    executedAt: new Date().toISOString(),
  };
}
