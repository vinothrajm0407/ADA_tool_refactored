// Adapts an assistive-testing module's own issue shape into the axe-core-like
// violation ("rule") object /api/auto-fix expects (see ViolationList.jsx's
// AutoFixControl / app.py:/api/auto-fix). `html` is the issue's real captured
// outerHTML when the backend could tie it to one specific element (see
// services/url_processor.py) — left blank only for issues that describe a
// page-wide condition with no single element to patch (e.g. "no H1 found"),
// which Auto-Fix will then fail to locate a source match for, same as any
// other unfixable violation.
function slug(str) {
  return (str || 'issue')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

export function buildAssistiveViolation({ testType, url, message, detail, severity, wcag, selector, html, ruleId }) {
  return {
    // Auto-Fix uses this id verbatim inside a git branch name
    // (`ada/fix/{id}-{hash}` — see auto_fix_service.py) — git branch names
    // reject ':', so this must stay hyphen/slash-safe, unlike a free-form id.
    // `ruleId`, when given, is the real underlying axe rule this assistive
    // check wraps (e.g. color-contrast is a real axe check under the hood) —
    // passing it through as the actual id (instead of the generic
    // "assistive-<testType>-<slug>" id) is what lets it qualify for
    // RULES_WITH_FALLBACK's free, deterministic fixes instead of always
    // costing a Gemini call. Most assistive checks are bespoke heuristics
    // with no axe equivalent, so this stays optional.
    id: ruleId || `assistive-${testType}-${slug(message)}`,
    description: message,
    help: message,
    detail,
    impact: severity === 'error' ? 'serious' : 'moderate',
    wcag,
    nodes: (selector || html) ? [{ html: html || '', target: selector ? [selector] : [] }] : [],
    sourceUrl: url,
    sourceScanId: 'assistive',
  };
}
