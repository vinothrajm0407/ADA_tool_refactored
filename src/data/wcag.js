/**
 * WCAG 2.2 Reference — Top 20 criteria by scan frequency.
 * Each entry has developer-first content: issue → fix → code example.
 * axeRules lists the axe-core rule IDs that trigger this criterion.
 */

export const WCAG_PRINCIPLES = ['Perceivable', 'Operable', 'Understandable', 'Robust']

export const WCAG_CRITERIA = [
  {
    id: '1.1.1',
    title: 'Non-text Content',
    level: 'A',
    principle: 'Perceivable',
    issue: 'Images and non-text elements have no text alternative, making them invisible to screen readers.',
    howToFix: [
      'Add a descriptive alt attribute to every <img> element.',
      'Use alt="" for purely decorative images so screen readers skip them.',
      'For complex images (charts, diagrams), provide a long description in nearby text or via aria-describedby.',
      'For <input type="image">, add an alt attribute describing the button action.',
    ],
    codeExamples: {
      bad: `<!-- Missing alt -->
<img src="hero.jpg">

<!-- Decorative image announced to screen reader -->
<img src="divider.png" alt="decorative line">`,
      good: `<!-- Descriptive alt -->
<img src="hero.jpg" alt="Team working in a modern open office">

<!-- Decorative: empty alt hides it from screen readers -->
<img src="divider.png" alt="">`,
    },
    axeRules: ['image-alt', 'area-alt', 'input-image-alt', 'object-alt', 'role-img-alt', 'svg-img-alt'],
  },
  {
    id: '1.3.1',
    title: 'Info and Relationships',
    level: 'A',
    principle: 'Perceivable',
    issue: 'Visual structure (headings, lists, tables, labels) is not conveyed programmatically to assistive technologies.',
    howToFix: [
      'Use semantic HTML: <h1>–<h6> for headings, <ul>/<ol> for lists, <table> with <th> for data tables.',
      'Associate form inputs with <label> elements using for/id or by wrapping.',
      'Use <thead>/<th> with scope attributes in data tables.',
      'Avoid using visual-only cues like bold or color to convey meaning without a semantic equivalent.',
    ],
    codeExamples: {
      bad: `<!-- No semantic heading -->
<div class="big-text">Section Title</div>

<!-- Input with no label -->
<input type="text" placeholder="Email">`,
      good: `<!-- Semantic heading -->
<h2>Section Title</h2>

<!-- Properly associated label -->
<label for="email">Email address</label>
<input type="text" id="email" placeholder="you@example.com">`,
    },
    axeRules: ['label', 'aria-required-children', 'aria-required-parent', 'definition-list', 'dlitem', 'list', 'listitem', 'td-headers-attr', 'th-has-data-cells', 'scope-attr-valid'],
  },
  {
    id: '1.3.5',
    title: 'Identify Input Purpose',
    level: 'AA',
    principle: 'Perceivable',
    issue: 'Form inputs that collect personal data have no autocomplete attribute, preventing browsers and assistive tools from pre-filling them.',
    howToFix: [
      'Add autocomplete attributes to inputs that collect personal data (name, email, phone, address, etc.).',
      'Use the standard autocomplete token list from the HTML spec.',
    ],
    codeExamples: {
      bad: `<input type="text" name="fname">
<input type="email" name="email">`,
      good: `<input type="text" name="fname" autocomplete="given-name">
<input type="email" name="email" autocomplete="email">`,
    },
    axeRules: ['autocomplete-valid'],
  },
  {
    id: '1.4.1',
    title: 'Use of Color',
    level: 'A',
    principle: 'Perceivable',
    issue: 'Color is the only visual means of conveying information, which fails users who are color-blind.',
    howToFix: [
      'Never rely on color alone — always pair it with a text label, icon, pattern, or shape.',
      'Error states: add an error icon or message alongside red text.',
      'Required fields: add an asterisk (*) alongside color.',
      'Charts: use patterns or labels in addition to color.',
    ],
    codeExamples: {
      bad: `<!-- Red border is the only error signal -->
<input class="border-red-500" type="text">`,
      good: `<!-- Error icon + text + border -->
<input class="border-red-500" aria-describedby="email-error" type="text">
<p id="email-error" class="text-red-600">
  <span aria-hidden="true">⚠ </span>Please enter a valid email address.
</p>`,
    },
    axeRules: [],
  },
  {
    id: '1.4.3',
    title: 'Contrast (Minimum)',
    level: 'AA',
    principle: 'Perceivable',
    issue: 'Text does not have sufficient contrast ratio against its background (minimum 4.5:1 for normal text, 3:1 for large text).',
    howToFix: [
      'Normal text (< 18pt / 14pt bold): minimum 4.5:1 contrast ratio.',
      'Large text (≥ 18pt or ≥ 14pt bold): minimum 3:1 contrast ratio.',
      'Use a contrast checker (e.g. WebAIM Contrast Checker) when choosing text/background colors.',
      'Do not convey meaning through color alone.',
    ],
    codeExamples: {
      bad: `/* Gray text on white — ratio ~2.3:1, FAILS */
.label { color: #aaaaaa; background: #ffffff; }`,
      good: `/* Dark gray on white — ratio ~7:1, PASSES */
.label { color: #374151; background: #ffffff; }`,
    },
    axeRules: ['color-contrast', 'color-contrast-enhanced'],
  },
  {
    id: '1.4.11',
    title: 'Non-text Contrast',
    level: 'AA',
    principle: 'Perceivable',
    issue: 'UI components (buttons, inputs, focus rings, icons) and informational graphics have insufficient contrast against adjacent colors (minimum 3:1).',
    howToFix: [
      'Ensure border/outline of interactive elements (inputs, checkboxes, buttons) meets 3:1 against background.',
      'Focus indicators must be visible with at least 3:1 contrast.',
      'Informational icons need 3:1 contrast against their background.',
    ],
    codeExamples: {
      bad: `/* Light gray border on white — fails 3:1 */
input { border: 1px solid #d1d5db; background: #fff; }`,
      good: `/* Darker border — passes 3:1 */
input { border: 1px solid #6b7280; background: #fff; }`,
    },
    axeRules: ['color-contrast'],
  },
  {
    id: '1.4.12',
    title: 'Text Spacing',
    level: 'AA',
    principle: 'Perceivable',
    issue: 'Content breaks or becomes unreadable when users override spacing properties (line height, letter spacing, word spacing, paragraph spacing).',
    howToFix: [
      'Avoid fixed-height containers for text content.',
      'Do not use fixed pixel heights on elements that contain text.',
      'Test with: line-height 1.5×, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em.',
    ],
    codeExamples: {
      bad: `/* Fixed height clips text when spacing increases */
.card { height: 80px; overflow: hidden; }`,
      good: `/* Min-height allows expansion */
.card { min-height: 80px; }`,
    },
    axeRules: [],
  },
  {
    id: '2.1.1',
    title: 'Keyboard',
    level: 'A',
    principle: 'Operable',
    issue: 'Interactive functionality cannot be operated using a keyboard alone, excluding users who cannot use a mouse.',
    howToFix: [
      'All interactive elements (links, buttons, forms, modals) must be reachable and operable via keyboard.',
      'Use native HTML elements (<button>, <a>, <input>) which have built-in keyboard support.',
      'Custom interactive elements need tabindex="0" and keyboard event handlers (Enter/Space for buttons).',
      'Ensure drag-and-drop has a keyboard alternative.',
    ],
    codeExamples: {
      bad: `<!-- div click handler — not keyboard accessible -->
<div onclick="submit()">Submit</div>`,
      good: `<!-- button is keyboard accessible by default -->
<button type="button" onClick={submit}>Submit</button>`,
    },
    axeRules: ['scrollable-region-focusable', 'frame-focusable-content'],
  },
  {
    id: '2.1.2',
    title: 'No Keyboard Trap',
    level: 'A',
    principle: 'Operable',
    issue: 'Keyboard focus gets trapped inside a component and the user cannot navigate away using standard keys.',
    howToFix: [
      'Modal dialogs should trap focus intentionally — but must release it when closed (Escape key).',
      'Custom widgets must allow Tab/Shift+Tab to move focus out.',
      'Test by tabbing into every interactive component and verifying Tab moves out.',
    ],
    codeExamples: {
      bad: `// Modal traps focus with no escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); /* always trapped */ }
})`,
      good: `// Modal traps focus but Escape closes it
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab') trapFocusInsideModal(e);
})`,
    },
    axeRules: [],
  },
  {
    id: '2.4.1',
    title: 'Bypass Blocks',
    level: 'A',
    principle: 'Operable',
    issue: 'There is no mechanism to skip repeated navigation blocks, forcing keyboard users to tab through the entire nav on every page.',
    howToFix: [
      'Add a "Skip to main content" link as the first focusable element on the page.',
      'The link can be visually hidden and revealed on focus.',
    ],
    codeExamples: {
      bad: `<!-- No skip link — user tabs through 30 nav items on every page -->
<nav>...</nav>
<main>...</main>`,
      good: `<!-- Skip link: visually hidden, shown on focus -->
<a href="#main-content" class="sr-only focus:not-sr-only">
  Skip to main content
</a>
<nav>...</nav>
<main id="main-content">...</main>`,
    },
    axeRules: ['skip-link', 'bypass'],
  },
  {
    id: '2.4.2',
    title: 'Page Titled',
    level: 'A',
    principle: 'Operable',
    issue: 'The page has no <title> element or the title does not describe the page topic.',
    howToFix: [
      'Every page must have a <title> that identifies the topic or purpose.',
      'Format: "Page Name — Site Name" gives context in browser tabs and screen readers.',
      'Update the title on route changes in SPAs.',
    ],
    codeExamples: {
      bad: `<title>Untitled</title>
<!-- or missing entirely -->`,
      good: `<title>Scan Results — ADA Accessibility Platform</title>`,
    },
    axeRules: ['document-title'],
  },
  {
    id: '2.4.3',
    title: 'Focus Order',
    level: 'A',
    principle: 'Operable',
    issue: 'Focus moves in a sequence that does not match the visual or logical reading order, confusing keyboard users.',
    howToFix: [
      'Avoid positive tabindex values (tabindex="1", "2") — they override natural DOM order.',
      'Ensure DOM order matches visual layout.',
      'When modals or overlays open, move focus to them; when closed, return focus to the trigger.',
    ],
    codeExamples: {
      bad: `<!-- Positive tabindex breaks natural focus order -->
<button tabindex="3">First visually</button>
<button tabindex="1">Second visually</button>`,
      good: `<!-- No tabindex — DOM order is the focus order -->
<button>First</button>
<button>Second</button>`,
    },
    axeRules: [],
  },
  {
    id: '2.4.4',
    title: 'Link Purpose (In Context)',
    level: 'A',
    principle: 'Operable',
    issue: 'Link text does not describe the link destination, e.g. "Click here" or "Read more" with no surrounding context.',
    howToFix: [
      'Write descriptive link text that makes sense out of context.',
      'If the visual text must stay generic, add aria-label or visually-hidden text.',
      'Avoid multiple links to different destinations sharing the same text.',
    ],
    codeExamples: {
      bad: `<a href="/report-2024.pdf">Click here</a>
<a href="/pricing">Read more</a>`,
      good: `<a href="/report-2024.pdf">Download 2024 Annual Report (PDF)</a>
<a href="/pricing">
  Read more <span class="sr-only">about our pricing plans</span>
</a>`,
    },
    axeRules: ['link-name', 'identical-links-same-purpose'],
  },
  {
    id: '2.4.6',
    title: 'Headings and Labels',
    level: 'AA',
    principle: 'Operable',
    issue: 'Headings and form labels are missing, empty, or do not describe their associated content.',
    howToFix: [
      'Every section of content should have a heading that describes it.',
      'Do not use empty headings (<h2></h2>) for spacing.',
      'Form labels should describe the expected input, not just the field type.',
    ],
    codeExamples: {
      bad: `<!-- Empty heading used for visual spacing -->
<h2></h2>

<!-- Vague label -->
<label for="f">Field</label>`,
      good: `<!-- Descriptive heading -->
<h2>Account Settings</h2>

<!-- Specific label -->
<label for="displayName">Display name</label>`,
    },
    axeRules: ['empty-heading', 'heading-order'],
  },
  {
    id: '2.4.7',
    title: 'Focus Visible',
    level: 'AA',
    principle: 'Operable',
    issue: 'Keyboard focus indicator is not visible, making it impossible for keyboard users to see where they are on the page.',
    howToFix: [
      'Never use outline: none or outline: 0 without providing a custom focus style.',
      'Provide a visible focus ring with sufficient contrast (3:1 minimum).',
      'Use :focus-visible for mouse-free styling, keeping it intact for keyboard users.',
    ],
    codeExamples: {
      bad: `/* Removes all focus indicators — NEVER do this */
* { outline: none; }
button:focus { outline: 0; }`,
      good: `/* Custom focus ring visible on keyboard navigation */
button:focus-visible {
  outline: 2px solid #0F766E;
  outline-offset: 2px;
}`,
    },
    axeRules: ['focus-visible'],
  },
  {
    id: '3.1.1',
    title: 'Language of Page',
    level: 'A',
    principle: 'Understandable',
    issue: 'The page has no lang attribute on <html>, preventing screen readers from using the correct language and pronunciation.',
    howToFix: [
      'Add a lang attribute to the <html> element using a valid BCP 47 language tag.',
      'For multilingual pages, add lang attributes to elements containing content in a different language.',
    ],
    codeExamples: {
      bad: `<html>
  <head>...</head>`,
      good: `<html lang="en">
  <head>...</head>`,
    },
    axeRules: ['html-has-lang', 'html-lang-valid'],
  },
  {
    id: '3.3.1',
    title: 'Error Identification',
    level: 'A',
    principle: 'Understandable',
    issue: 'Form validation errors are not identified to users in text, relying only on color or visual indicators.',
    howToFix: [
      'Describe each error in text, identifying the field with the error.',
      'Use aria-invalid="true" on the invalid input.',
      'Link the error message to the input with aria-describedby.',
      'Move focus to the first error or an error summary when the form is submitted.',
    ],
    codeExamples: {
      bad: `<!-- Red border only — no accessible error message -->
<input class="border-red-500" type="email">`,
      good: `<input
  type="email"
  aria-invalid="true"
  aria-describedby="email-error"
  class="border-red-500"
>
<p id="email-error" role="alert">
  Email address is invalid. Please enter a valid email.
</p>`,
    },
    axeRules: [],
  },
  {
    id: '3.3.2',
    title: 'Labels or Instructions',
    level: 'A',
    principle: 'Understandable',
    issue: 'Form inputs that require specific data formats have no labels or instructions, causing user errors.',
    howToFix: [
      'Every input must have a visible, descriptive label.',
      'Provide format hints (e.g. "MM/DD/YYYY") for date fields.',
      'Mark required fields with both a visual indicator and aria-required="true".',
      'Placeholder text alone does not count as a label.',
    ],
    codeExamples: {
      bad: `<!-- Placeholder is not a label — disappears on typing -->
<input type="text" placeholder="Date of Birth">`,
      good: `<label for="dob">
  Date of birth
  <span class="text-gray-500 text-sm">(MM/DD/YYYY)</span>
</label>
<input type="text" id="dob" aria-required="true" placeholder="01/15/1990">`,
    },
    axeRules: ['label', 'label-content-name-mismatch'],
  },
  {
    id: '4.1.2',
    title: 'Name, Role, Value',
    level: 'A',
    principle: 'Robust',
    issue: 'Custom UI components have no accessible name, role, or state information, making them invisible to assistive technologies.',
    howToFix: [
      'Use native HTML elements wherever possible — they have built-in ARIA roles.',
      'Custom widgets need appropriate ARIA roles (role="button", role="dialog", etc.).',
      'Dynamic state must be programmatically exposed: aria-expanded, aria-checked, aria-selected.',
      'All interactive elements need an accessible name via visible text, aria-label, or aria-labelledby.',
    ],
    codeExamples: {
      bad: `<!-- Custom toggle with no accessible name or state -->
<div class="toggle" onclick="toggle()"></div>`,
      good: `<!-- Button with role, name, and state -->
<button
  role="switch"
  aria-checked={isOn}
  aria-label="Enable notifications"
  onClick={toggle}
>
  <span aria-hidden="true">{isOn ? 'ON' : 'OFF'}</span>
</button>`,
    },
    axeRules: ['button-name', 'aria-allowed-attr', 'aria-prohibited-attr', 'aria-required-attr', 'aria-valid-attr', 'aria-valid-attr-value', 'aria-hidden-focus'],
  },
  {
    id: '4.1.3',
    title: 'Status Messages',
    level: 'AA',
    principle: 'Robust',
    issue: 'Status messages (success, loading, error notifications) are not exposed to screen readers because they lack ARIA live regions.',
    howToFix: [
      'Add role="status" (polite) or role="alert" (assertive) to dynamically injected messages.',
      'Use aria-live="polite" for non-critical updates, aria-live="assertive" for errors.',
      'The live region container must exist in the DOM before the message is injected.',
    ],
    codeExamples: {
      bad: `<!-- Dynamically shown — screen reader never announces it -->
{saved && <div class="toast">Changes saved!</div>}`,
      good: `<!-- Live region always in DOM; content change is announced -->
<div role="status" aria-live="polite" aria-atomic="true">
  {saved ? 'Changes saved!' : ''}
</div>`,
    },
    axeRules: ['aria-live-region-focusable'],
  },
]

/** Lookup a single criterion by ID. Returns undefined if not found. */
export function getWcagCriterion(id) {
  return WCAG_CRITERIA.find(c => c.id === id)
}

/** Map of axe rule ID → criterion IDs that it triggers (inverted from axeRules arrays). */
export const AXE_RULE_TO_CRITERIA = (() => {
  const map = {}
  for (const c of WCAG_CRITERIA) {
    for (const rule of c.axeRules) {
      if (!map[rule]) map[rule] = []
      map[rule].push(c.id)
    }
  }
  return map
})()
