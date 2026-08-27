const RULE_FIX_TIPS = {
  'aria-allowed-attr': [
    'Remove ARIA attributes not supported for this element or role.',
    'Prefer native HTML semantics first; add ARIA only when necessary and valid.',
  ],
  'aria-required-attr': [
    'Add required ARIA attributes for the current role.',
    'Verify the role/attribute combination against ARIA spec.',
  ],
  'aria-valid-attr': [
    'Use valid ARIA attribute names only.',
    'Fix typos and remove custom/non-standard aria-* attributes.',
  ],
  'aria-valid-attr-value': [
    'Use supported values for ARIA attributes.',
    'For boolean ARIA values, use "true" or "false".',
  ],
  'autocomplete-valid': [
    'Use valid autocomplete tokens (for example: name, email, organization, street-address).',
    'Remove invalid or custom autocomplete values.',
  ],
  'button-name': [
    'Add accessible text to the button (visible text or aria-label/aria-labelledby).',
    'If icon-only, keep aria-label concise and descriptive.',
  ],
  'color-contrast': [
    'Increase text/background contrast to meet WCAG thresholds.',
    'Check hover, focus, and disabled states too, not only the default state.',
  ],
  'frame-title': [
    'Add a clear, unique title attribute to each frame/iframe.',
    'Make the title describe the embedded content purpose.',
  ],
  'heading-order': [
    'Use heading levels in sequence (h1 -> h2 -> h3).',
    'Do not skip levels for visual styling only.',
  ],
  'html-has-lang': [
    'Add a valid lang attribute on the <html> element.',
    'Use BCP 47 language tags such as en, en-US, fr, etc.',
  ],
  'image-alt': [
    'Add meaningful alt text for informative images.',
    'Use empty alt="" only for decorative images.',
  ],
  label: [
    'Associate each form control with a visible <label>.',
    'For custom components, use aria-labelledby or aria-label correctly.',
  ],
  'link-name': [
    'Ensure every link has discernible text (or aria-label/aria-labelledby).',
    'Avoid empty links and links with only decorative icons without labels.',
  ],
  'list-item': [
    'Ensure <li> elements are children of <ul> or <ol>.',
    'Do not use list styling without semantic list markup.',
  ],
  'meta-viewport': [
    'Set a responsive viewport meta tag.',
    'Avoid disabling zoom (do not use user-scalable=no).',
  ],
  region: [
    'Use landmark regions (<main>, <nav>, <header>, <footer>, <aside>) for structure.',
    'Ensure important page sections are inside landmarks.',
  ],
}

const RULE_FIX_EXAMPLES = {
  'aria-allowed-attr': [
    { label: 'Use valid ARIA on supported role', code: '<div role="button" aria-pressed="false">Toggle</div>' },
  ],
  'aria-required-attr': [
    { label: 'Required ARIA for combobox', code: '<input role="combobox" aria-expanded="false" aria-controls="city-list" />' },
  ],
  'aria-valid-attr': [
    { label: 'Valid aria-* usage', code: '<button aria-label="Close dialog">×</button>' },
  ],
  'aria-valid-attr-value': [
    { label: 'Boolean aria value', code: '<button aria-expanded="true">Filters</button>' },
  ],
  'autocomplete-valid': [
    { label: 'Valid autocomplete token', code: '<input type="email" autocomplete="email" />' },
  ],
  'button-name': [
    { label: 'Icon-only button', code: '<button aria-label="Open chat"><img src="/chat.svg" alt="" /></button>' },
    { label: 'Visible text', code: '<button type="button">Open chat</button>' },
  ],
  'color-contrast': [
    { label: 'Increase contrast', code: '.btn { color: #111827; background: #ffffff; }' },
  ],
  'frame-title': [
    { label: 'Accessible iframe title', code: '<iframe src="/report" title="Accessibility report"></iframe>' },
  ],
  'heading-order': [
    { label: 'Sequential headings', code: '<h1>Page</h1><h2>Section</h2><h3>Subsection</h3>' },
  ],
  'html-has-lang': [
    { label: 'Language on root html', code: '<html lang="en">' },
  ],
  'image-alt': [
    { label: 'Informative image', code: '<img src="/chart.png" alt="Quarterly sales chart for 2026" />' },
    { label: 'Decorative image', code: '<img src="/divider.png" alt="" role="presentation" />' },
  ],
  label: [
    { label: 'Explicit label', code: '<label for="email">Email</label><input id="email" type="email" />' },
  ],
  'link-name': [
    { label: 'Label icon link', code: '<a href="/home" aria-label="Home"><svg aria-hidden="true"></svg></a>' },
  ],
  'list-item': [
    { label: 'Semantic list', code: '<ul><li>Step one</li><li>Step two</li></ul>' },
  ],
  'meta-viewport': [
    { label: 'Responsive viewport', code: '<meta name="viewport" content="width=device-width, initial-scale=1" />' },
  ],
  region: [
    { label: 'Main landmark', code: '<main><h1>Accessibility report</h1></main>' },
  ],
}

const RULE_WHY_MATTERS = {
  'button-name': 'Screen reader users rely on button labels to understand what actions are available. A button without an accessible name is effectively silent to assistive technology — it may be skipped or announced as just "button" with no context.',
  'color-contrast': 'Low contrast text is unreadable for users with low vision or color blindness. WCAG requires a 4.5:1 ratio for normal text and 3:1 for large text — failing this can exclude up to 8% of the population.',
  'image-alt': 'Screen readers announce alt text in place of images. Without it, meaningful visuals convey nothing to users who cannot see them, breaking the information flow entirely.',
  'link-name': 'Screen reader users navigate pages by jumping between links. An unnamed link provides no destination context, making navigation unreliable and potentially unusable.',
  'label': 'Form controls without labels cannot be identified by assistive technology. Users may not know what information is required or what they are editing, leading to errors and abandonment.',
  'heading-order': 'Screen reader users navigate documents by heading structure. Skipped or reversed heading levels break this navigation model and obscure the hierarchy of content.',
  'html-has-lang': 'The language attribute tells screen readers which voice profile and pronunciation rules to apply. Without it, content may be mispronounced or completely unintelligible.',
  'frame-title': 'Screen reader users need frame titles to understand embedded content before deciding whether to navigate into it. Untitled frames are announced without any context.',
  'region': 'Landmark regions let screen reader users skip directly to main content, navigation, or search. Pages without landmarks require reading every element from the top on each visit.',
  'meta-viewport': 'Disabling pinch-to-zoom forces users with low vision to read at a fixed size. This can make text completely illegible without other assistive tools and violates WCAG 1.4.4.',
  'list-item': 'Screen readers announce list context such as "list of 5 items". Broken list markup strips that context and may produce confusing or incorrect announcements.',
  'aria-allowed-attr': 'Invalid ARIA attributes can confuse assistive technology or cause it to misreport an element\'s role, state, or properties, leading to incorrect user expectations.',
  'aria-required-attr': 'Required ARIA attributes are essential for assistive technology to correctly describe interactive components like menus, dialogs, and grids. Missing them leaves the accessible interface incomplete.',
  'aria-valid-attr': 'Non-existent ARIA attributes are silently ignored or cause errors in screen readers, leaving the accessible interface broken without any visible indication.',
  'aria-valid-attr-value': 'Incorrect ARIA values cause screen readers to announce wrong states — for example, a collapsed menu announced as expanded — creating a mismatch between what users hear and what they see.',
  'autocomplete-valid': 'Valid autocomplete values help password managers and assistive technology pre-fill form fields accurately, reducing friction and errors for all users.',
}

const IMPACT_WHY_FALLBACK = {
  critical: 'This issue prevents some users from accessing or completing this interaction entirely.',
  serious:  'This issue creates a significant barrier for users relying on assistive technology and should be prioritised.',
  moderate: 'This issue causes friction for some users with disabilities and degrades the accessible experience.',
  minor:    'This is a low-risk gap that may affect some users in specific assistive technology configurations.',
}

function normalizeRuleId(ruleId) {
  return (ruleId || '').toLowerCase()
}

export function getRuleFixTips(ruleId) {
  return RULE_FIX_TIPS[normalizeRuleId(ruleId)] || []
}

export function getRuleFixExamples(ruleId) {
  return RULE_FIX_EXAMPLES[normalizeRuleId(ruleId)] || []
}

export function getRuleWhyMatters(ruleId, impact) {
  return (
    RULE_WHY_MATTERS[normalizeRuleId(ruleId)] ||
    IMPACT_WHY_FALLBACK[(impact || 'minor').toLowerCase()] ||
    IMPACT_WHY_FALLBACK.minor
  )
}

export function splitFailureSummary(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ─── Effort levels ────────────────────────────────────────────────────────────
const RULE_EFFORT = {
  'aria-allowed-attr':     'quick',
  'aria-required-attr':    'quick',
  'aria-valid-attr':       'quick',
  'aria-valid-attr-value': 'quick',
  'autocomplete-valid':    'quick',
  'button-name':           'quick',
  'frame-title':           'quick',
  'html-has-lang':         'quick',
  'image-alt':             'quick',
  'link-name':             'quick',
  'list-item':             'quick',
  'meta-viewport':         'quick',
  'color-contrast':        'moderate',
  'heading-order':         'moderate',
  'label':                 'moderate',
  'region':                'moderate',
}

export function getRuleEffort(ruleId) {
  return RULE_EFFORT[normalizeRuleId(ruleId)] || 'quick'
}

// ─── Impacted user groups ─────────────────────────────────────────────────────
const RULE_IMPACTED_USERS = {
  'aria-allowed-attr':     ['Screen reader users', 'Keyboard users'],
  'aria-required-attr':    ['Screen reader users'],
  'aria-valid-attr':       ['Screen reader users'],
  'aria-valid-attr-value': ['Screen reader users'],
  'autocomplete-valid':    ['Screen reader users', 'Motor impaired'],
  'button-name':           ['Screen reader users', 'Voice control users'],
  'color-contrast':        ['Low vision users', 'Color blind users'],
  'frame-title':           ['Screen reader users'],
  'heading-order':         ['Screen reader users', 'Cognitive'],
  'html-has-lang':         ['Screen reader users'],
  'image-alt':             ['Screen reader users', 'Low vision users'],
  'label':                 ['Screen reader users', 'Voice control users', 'Cognitive'],
  'link-name':             ['Screen reader users', 'Voice control users'],
  'list-item':             ['Screen reader users'],
  'meta-viewport':         ['Low vision users', 'Mobile users'],
  'region':                ['Screen reader users', 'Keyboard users'],
}

const IMPACT_USERS_FALLBACK = {
  critical: ['Screen reader users', 'Keyboard users'],
  serious:  ['Screen reader users'],
  moderate: ['Screen reader users', 'Low vision users'],
  minor:    ['Screen reader users'],
}

export function getRuleImpactedUsers(ruleId, impact) {
  return (
    RULE_IMPACTED_USERS[normalizeRuleId(ruleId)] ||
    IMPACT_USERS_FALLBACK[(impact || 'minor').toLowerCase()] ||
    IMPACT_USERS_FALLBACK.minor
  )
}

// ─── Before / After code pairs ────────────────────────────────────────────────
const RULE_CODE_PAIRS = {
  'aria-allowed-attr': {
    before: '<div aria-expanded="false" class="menu-toggle">\n  Settings\n</div>',
    after:  '<button aria-expanded="false" class="menu-toggle">\n  Settings\n</button>',
  },
  'aria-required-attr': {
    before: '<input role="combobox" placeholder="Search cities">',
    after:  '<input role="combobox"\n       aria-expanded="false"\n       aria-controls="city-list"\n       placeholder="Search cities">',
  },
  'aria-valid-attr': {
    before: '<button aria-lable="Close dialog">×</button>',
    after:  '<button aria-label="Close dialog">×</button>',
  },
  'aria-valid-attr-value': {
    before: '<button aria-expanded="yes">Filters</button>',
    after:  '<button aria-expanded="false">Filters</button>',
  },
  'autocomplete-valid': {
    before: '<input type="email" autocomplete="user-email">',
    after:  '<input type="email" autocomplete="email">',
  },
  'button-name': {
    before: '<button>\n  <svg viewBox="0 0 24 24">...</svg>\n</button>',
    after:  '<button aria-label="Close dialog">\n  <svg viewBox="0 0 24 24" aria-hidden="true">...</svg>\n</button>',
  },
  'color-contrast': {
    before: '/* ratio: 2.3:1 — fails WCAG AA */\n.hint { color: #aaaaaa; background: #ffffff; }',
    after:  '/* ratio: 7.0:1 — passes WCAG AA ✓ */\n.hint { color: #595959; background: #ffffff; }',
  },
  'frame-title': {
    before: '<iframe src="/embed/map"></iframe>',
    after:  '<iframe src="/embed/map" title="Office location map"></iframe>',
  },
  'heading-order': {
    before: '<h1>Site Title</h1>\n<!-- skips h2 -->\n<h3>Section Name</h3>',
    after:  '<h1>Site Title</h1>\n<h2>Section Name</h2>',
  },
  'html-has-lang': {
    before: '<html>',
    after:  '<html lang="en">',
  },
  'image-alt': {
    before: '<img src="revenue-chart.png">',
    after:  '<img src="revenue-chart.png"\n     alt="Q4 revenue chart showing 23% YoY growth">',
  },
  'label': {
    before: '<input type="email" placeholder="Enter email">',
    after:  '<label for="email">Email address</label>\n<input id="email" type="email"\n       placeholder="you@example.com">',
  },
  'link-name': {
    before: '<a href="/home">\n  <svg>...</svg>\n</a>',
    after:  '<a href="/home" aria-label="Go to homepage">\n  <svg aria-hidden="true">...</svg>\n</a>',
  },
  'list-item': {
    before: '<div>\n  <li>Step one</li>\n  <li>Step two</li>\n</div>',
    after:  '<ul>\n  <li>Step one</li>\n  <li>Step two</li>\n</ul>',
  },
  'meta-viewport': {
    before: '<meta name="viewport"\n      content="width=device-width, initial-scale=1, user-scalable=no">',
    after:  '<meta name="viewport"\n      content="width=device-width, initial-scale=1">',
  },
  'region': {
    before: '<div class="content">\n  <p>Main page content</p>\n</div>',
    after:  '<main>\n  <p>Main page content</p>\n</main>',
  },
}

export function getRuleCodePair(ruleId) {
  return RULE_CODE_PAIRS[normalizeRuleId(ruleId)] || null
}

// ─── Post-fix validation checklist ───────────────────────────────────────────
const RULE_VALIDATION_STEPS = {
  'aria-allowed-attr': [
    'Tab to the element — role is announced correctly by screen reader',
    'Confirm no ARIA attribute warnings in browser accessibility tree',
    'Re-run axe — rule clears with zero violations',
  ],
  'aria-required-attr': [
    'Open screen reader — interactive component announces state (e.g. "collapsed")',
    'Verify aria-controls points to an existing element ID',
    'Re-run axe — rule clears',
  ],
  'aria-valid-attr': [
    'Inspect element in browser — no unknown aria-* attributes in computed accessibility',
    'Re-run axe — rule clears',
  ],
  'aria-valid-attr-value': [
    'Toggle component — screen reader announces correct state change',
    'Verify boolean attrs use "true" / "false" strings, not 1/0 or yes/no',
    'Re-run axe — rule clears',
  ],
  'autocomplete-valid': [
    'Focus the field — browser or password manager suggests saved values',
    'Verify token matches the W3C autocomplete attribute list',
    'Re-run axe — rule clears',
  ],
  'button-name': [
    'Tab to button — screen reader announces the label, not just "button"',
    'Label describes the action clearly without surrounding context',
    'Voice control users can activate button by saying its label',
    'Re-run axe — rule clears',
  ],
  'color-contrast': [
    'Check contrast ratio with browser DevTools or Colour Contrast Analyser',
    'Verify hover, focus, and disabled states independently',
    'View page in grayscale — text is still legible',
    'Re-run axe — rule clears',
  ],
  'frame-title': [
    'Tab to iframe — screen reader announces the title before entering',
    'Title describes the embedded content purpose, not "iframe"',
    'Re-run axe — rule clears',
  ],
  'heading-order': [
    'Review page heading structure with screen reader heading list',
    'No heading levels skipped in sequence',
    'Re-run axe — rule clears',
  ],
  'html-has-lang': [
    'Screen reader uses correct voice/pronunciation profile for the language',
    'lang attribute uses a valid BCP 47 tag (e.g. en, en-US, fr)',
    'Re-run axe — rule clears',
  ],
  'image-alt': [
    'Screen reader announces the alt text in place of the image filename',
    'Decorative images have alt="" and are skipped by screen reader',
    'Alt text conveys the same information the image provides visually',
    'Re-run axe — rule clears',
  ],
  'label': [
    'Tab to field — screen reader announces the label before the field type',
    'Click the label text — browser moves focus to the input',
    'Voice control: saying the label activates the correct field',
    'Re-run axe — rule clears',
  ],
  'link-name': [
    'Tab to link — screen reader announces meaningful destination',
    'Link text makes sense out of context (read in isolation)',
    'Voice control: saying the link text navigates correctly',
    'Re-run axe — rule clears',
  ],
  'list-item': [
    'Screen reader announces "list of N items" when entering the list',
    'Confirm list markup in browser accessibility tree',
    'Re-run axe — rule clears',
  ],
  'meta-viewport': [
    'Pinch-to-zoom works on mobile device',
    'Page remains usable at 200% browser zoom',
    'Re-run axe — rule clears',
  ],
  'region': [
    'Screen reader landmark navigation reaches all key page sections',
    'Each landmark has a unique label if multiple of the same type exist',
    'Skip-to-main-content link jumps inside the <main> landmark',
    'Re-run axe — rule clears',
  ],
}

export function getRuleValidationSteps(ruleId) {
  return RULE_VALIDATION_STEPS[normalizeRuleId(ruleId)] || [
    'Verify the fix in a screen reader (NVDA, VoiceOver, or JAWS)',
    'Test keyboard navigation — Tab order is logical',
    'Re-run axe scan — violation is cleared',
  ]
}
