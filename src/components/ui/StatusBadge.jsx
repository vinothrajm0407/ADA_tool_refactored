import React from 'react';

// text-{color}-700/300 (not bare text-{color}) so badge text hits WCAG AA
// 4.5:1 against its own tinted background in both themes — the bare color
// (used for icons/dots elsewhere) is roughly 2-3:1 and too light for text.
const STATUS_CLASSES = {
  Passed:'bg-sage/15 text-sage-700',
  'Needs review':'bg-amber/15 text-amber-700',
  Failed:'bg-coral/15 text-coral-700',
  Running:'bg-teal/15 text-teal-700',
};

const SEVERITY_CLASSES = {
  Critical:'bg-coral/15 text-coral-700',
  Serious:'bg-terracotta/15 text-terracotta-700',
  Moderate:'bg-amber/15 text-amber-700',
  Minor:'bg-sage/15 text-sage-700',
};

export function StatusBadge({ status }) {
  const classes = STATUS_CLASSES[status] ?? 'bg-body/15 text-body';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}

export function StatusPill({ severity }) {
  const classes = SEVERITY_CLASSES[severity] ?? 'bg-body/15 text-body';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>
      {severity}
    </span>
  );
}

export default StatusBadge;
