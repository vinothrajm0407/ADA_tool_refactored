// ─── Accessibility Score Utilities ───────────────────────────────────────────

export const WCAG_AA_CRITERIA_NS = new Set([
  '1.2.4','1.2.5','1.3.4','1.3.5','1.4.3','1.4.4','1.4.5',
  '1.4.10','1.4.11','1.4.12','1.4.13','2.4.5','2.4.6','2.4.7',
  '3.1.2','3.2.3','3.2.4','3.3.3','3.3.4','4.1.3',
]);

export function nsWcagTagToMeta(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const lower = tag.toLowerCase();
    if (/^wcag\d*a+$/.test(lower)) continue;
    const m = lower.match(/^wcag(\d{3,})$/);
    if (!m) continue;
    const digits = m[1];
    const criterion = `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
    const level = WCAG_AA_CRITERIA_NS.has(criterion) ? 'AA' : 'A';
    return { criterion, level };
  }
  return null;
}

export const NS_SCORE_WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 };

export function nsComputeScore(violations) {
  let penalty = 0;
  for (const v of violations) {
    const w = NS_SCORE_WEIGHTS[(v.impact || 'minor').toLowerCase()] ?? 1;
    penalty += (v.nodes?.length ?? 1) * w;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function nsScoreGradeInfo(score) {
  if (score >= 90) return { grade: 'A', dialCls: 'text-teal border-teal',       badgeCls: 'bg-teal/10 text-teal' };
  if (score >= 75) return { grade: 'B', dialCls: 'text-sage border-sage',       badgeCls: 'bg-sage/10 text-sage' };
  if (score >= 60) return { grade: 'C', dialCls: 'text-amber border-amber',     badgeCls: 'bg-amber/10 text-amber' };
  if (score >= 45) return { grade: 'D', dialCls: 'text-terracotta border-terracotta', badgeCls: 'bg-terracotta/10 text-terracotta' };
  return              { grade: 'F', dialCls: 'text-coral border-coral',         badgeCls: 'bg-coral/10 text-coral' };
}

export function nsScoreMessage(score) {
  if (score >= 90) return 'Excellent accessibility compliance. Minor or no issues found.';
  if (score >= 75) return 'Good accessibility baseline with some issues requiring attention.';
  if (score >= 60) return 'Moderate accessibility issues found. Prioritize critical and serious violations.';
  if (score >= 45) return 'Significant accessibility barriers detected. Remediation required.';
  return 'Critical accessibility failures present. Immediate remediation required.';
}

export function nsBuildSeverityBreakdown(violations) {
  const c = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    const impact = (v.impact || 'minor').toLowerCase();
    if (impact in c) c[impact] += (v.nodes?.length ?? 1);
  }
  return c;
}

export function nsBuildTopIssues(violations) {
  const map = {};
  for (const v of violations) {
    const id = v.id || 'unknown';
    if (!map[id]) map[id] = { id, title: v.help || v.description || v.id || 'Unknown issue', count: 0 };
    map[id].count += (v.nodes?.length ?? 1);
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
}

export const NS_SEVERITY_ROWS = [
  { key: 'critical', label: 'Critical', dot: 'bg-coral',       sublabel: 'High Risk'   },
  { key: 'serious',  label: 'Serious',  dot: 'bg-terracotta',  sublabel: 'Medium Risk' },
  { key: 'moderate', label: 'Moderate', dot: 'bg-amber',       sublabel: 'Low Risk'    },
  { key: 'minor',    label: 'Minor',    dot: 'bg-sage',        sublabel: 'Info'        },
];

export const NS_IMPACT_FILTER = ['critical', 'serious', 'moderate', 'minor'];

export function truncateHtml(html, maxLen = 280) {
  if (!html) return '';
  return html.length <= maxLen ? html : html.slice(0, maxLen) + '…';
}

// ─── Phase 3: colors, localStorage, grouping, donut ──────────────────────────

export const SEV_COLORS = {
  critical: '#E76F51',
  serious:  '#D97757',
  moderate: '#F59E0B',
  minor:    '#6BA368',
};

const ADA_SCAN_PREFIX = 'ada_scan_summary_';

function adaScanKey(url) {
  try {
    const u = new URL((url || '').trim());
    const norm = (u.hostname + u.pathname).toLowerCase().replace(/\/$/, '') || '/';
    return ADA_SCAN_PREFIX + btoa(unescape(encodeURIComponent(norm))).slice(0, 48);
  } catch {
    return ADA_SCAN_PREFIX + String(url || '').toLowerCase().replace(/\/$/, '');
  }
}

export function loadPrevScan(url) {
  try { return JSON.parse(localStorage.getItem(adaScanKey(url)) || 'null'); } catch { return null; }
}

export function saveScanSummary(url, summary) {
  try { localStorage.setItem(adaScanKey(url), JSON.stringify(summary)); } catch {}
}

export function nsInferPageArea(nodes) {
  const t = (nodes || []).flatMap(n => [].concat(n.target || '').flat()).join(' ').toLowerCase();
  if (/\bnav\b|navbar|\bnavigation\b/.test(t)) return 'Navigation';
  if (/\bheader\b/.test(t)) return 'Header';
  if (/\bfooter\b/.test(t)) return 'Footer';
  if (/\bform\b|\binput\b|\bselect\b|\btextarea\b|\blabel\b/.test(t)) return 'Forms';
  if (/\bimg\b|\bimage\b|\bpicture\b|\bfigure\b/.test(t)) return 'Images & Media';
  if (/\ba\[href\]|\ba\./.test(t)) return 'Links';
  if (/\bbutton\b|\bbtn\b/.test(t)) return 'Controls';
  if (/h[1-6]/.test(t)) return 'Headings';
  if (/\bmain\b/.test(t)) return 'Main Content';
  return 'General';
}

export function nsGroupByArea(violations) {
  const groups = {};
  for (const v of violations) {
    const area = nsInferPageArea(v.nodes);
    if (!groups[area]) groups[area] = [];
    groups[area].push(v);
  }
  const ORDER = ['Navigation', 'Header', 'Main Content', 'Forms', 'Controls', 'Links', 'Images & Media', 'Headings', 'Footer', 'General'];
  return Object.keys(groups)
    .sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(area => ({ area, violations: groups[area] }));
}

export function buildDonutPaths(sevBreak) {
  const total = NS_SEVERITY_ROWS.reduce((s, r) => s + (sevBreak[r.key] || 0), 0);
  if (total === 0) return { paths: [], total: 0 };
  const CX = 50, CY = 50, OR = 44, IR = 28;
  let angle = -Math.PI / 2;
  const paths = [];
  for (const { key } of NS_SEVERITY_ROWS) {
    const val = sevBreak[key] || 0;
    if (!val) continue;
    const sweep = (val / total) * Math.PI * 2;
    const endA = angle + sweep;
    const laf = sweep > Math.PI ? 1 : 0;
    const x1o = CX + OR * Math.cos(angle), y1o = CY + OR * Math.sin(angle);
    const x2o = CX + OR * Math.cos(endA),  y2o = CY + OR * Math.sin(endA);
    const x1i = CX + IR * Math.cos(angle), y1i = CY + IR * Math.sin(angle);
    const x2i = CX + IR * Math.cos(endA),  y2i = CY + IR * Math.sin(endA);
    paths.push({
      key,
      fill: SEV_COLORS[key],
      d: `M${x1o.toFixed(2)},${y1o.toFixed(2)} A${OR},${OR} 0 ${laf} 1 ${x2o.toFixed(2)},${y2o.toFixed(2)} L${x2i.toFixed(2)},${y2i.toFixed(2)} A${IR},${IR} 0 ${laf} 0 ${x1i.toFixed(2)},${y1i.toFixed(2)} Z`,
    });
    angle = endA;
  }
  return { paths, total };
}

// ─── Phase 4: helpers ─────────────────────────────────────────────────────────

const ADA_TL_PREFIX = 'ada_tl_';

function p4tlKey(url) {
  try { return ADA_TL_PREFIX + btoa(unescape(encodeURIComponent(url || ''))).slice(0, 48); }
  catch { return ADA_TL_PREFIX + String(url || '').length; }
}

export function p4loadTimeline(url) {
  try { return JSON.parse(localStorage.getItem(p4tlKey(url)) || '[]'); } catch { return []; }
}

export function p4saveToTimeline(url, entry) {
  try {
    const arr = p4loadTimeline(url);
    arr.push(entry);
    localStorage.setItem(p4tlKey(url), JSON.stringify(arr.slice(-10)));
  } catch {}
}

export const P4_KB_IDS = new Set([
  'bypass', 'focus-order-semantics', 'focusable-content', 'focus-visible',
  'keyboard', 'keyboard-trap', 'tabindex', 'skip-link',
  'scrollable-region-focusable', 'aria-hidden-focus', 'interactive-supports-focus',
]);

export function p4keyboardViolations(violations) {
  return violations.filter(v => P4_KB_IDS.has(v.id));
}

export function p4riskLevel(score, sevBreak) {
  const c = sevBreak.critical || 0;
  if (score < 45 || c >= 5) return { level: 'Critical', badgeCls: 'bg-coral/10 text-coral border-coral/20',                action: 'Immediate remediation required' };
  if (score < 65 || c >= 2) return { level: 'High',     badgeCls: 'bg-terracotta/10 text-terracotta border-terracotta/20', action: 'Prioritize critical and serious issues' };
  if (score < 80)           return { level: 'Medium',   badgeCls: 'bg-amber/10 text-amber border-amber/20',               action: 'Address moderate issues to improve compliance' };
  if (score < 95)           return { level: 'Low',      badgeCls: 'bg-sage/10 text-sage border-sage/20',                 action: 'Monitor and address remaining minor issues' };
  return                           { level: 'Minimal',  badgeCls: 'bg-teal/10 text-teal border-teal/20',                 action: 'Maintain current accessibility practices' };
}

export function p4wcagLabel(violations) {
  let hasA = false, hasAA = false;
  for (const v of violations) {
    for (const tag of (v.tags || [])) {
      const t = (tag || '').toLowerCase();
      if (/^wcag\d+aa$/.test(t)) hasAA = true;
      else if (/^wcag\d+a$/.test(t)) hasA = true;
    }
  }
  if (!hasA && !hasAA) return 'AA Full';
  if (hasAA) return 'AA Partial';
  if (hasA)  return 'A Partial';
  return 'A';
}

export function p4wcagLevel(v) {
  for (const tag of (v.tags || [])) {
    const t = (tag || '').toLowerCase();
    if (/^wcag\d+aa$/.test(t)) return 'AA';
    if (/^wcag\d+a$/.test(t))  return 'A';
    if (t === 'best-practice') return 'BP';
  }
  return 'AA';
}

const ADA_VP_PREFIX = 'ada_vp_';

function p4vpKey(url) {
  try { return ADA_VP_PREFIX + btoa(unescape(encodeURIComponent(url || ''))).slice(0, 48); }
  catch { return ADA_VP_PREFIX + String(url || '').length; }
}

export function p4loadVpResults(url) {
  try { return JSON.parse(localStorage.getItem(p4vpKey(url)) || 'null'); } catch { return null; }
}

export function p4saveVpResults(url, results) {
  try { localStorage.setItem(p4vpKey(url), JSON.stringify(results)); } catch {}
}

export const P4_VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'tablet',  label: 'Tablet',  width: 768  },
  { id: 'mobile',  label: 'Mobile',  width: 375  },
];

export const P4_IMPACT_GROUPS = {
  'button-name':                  ['Screen reader users', 'Voice control users'],
  'color-contrast':               ['Low vision users', 'Color-blind users'],
  'image-alt':                    ['Screen reader users', 'Users with images disabled'],
  'label':                        ['Screen reader users', 'Voice control users', 'Motor-impaired users'],
  'link-name':                    ['Screen reader users', 'Keyboard-only users'],
  'keyboard':                     ['Keyboard-only users', 'Switch device users'],
  'keyboard-trap':                ['Keyboard-only users', 'Switch device users'],
  'focus-visible':                ['Keyboard-only users', 'Cognitive disability users'],
  'bypass':                       ['Keyboard-only users', 'Screen reader users'],
  'heading-order':                ['Screen reader users', 'Cognitive disability users'],
  'html-has-lang':                ['Screen reader users', 'Machine translation users'],
  'region':                       ['Screen reader users', 'Keyboard-only users'],
  'meta-viewport':                ['Low vision users', 'Mobile users with pinch-to-zoom'],
  'frame-title':                  ['Screen reader users'],
  'scrollable-region-focusable':  ['Keyboard-only users'],
  'interactive-supports-focus':   ['Keyboard-only users', 'Screen reader users'],
};

export const P4_EFFORT = {
  'color-contrast':               'Complex',
  'keyboard':                     'Complex',
  'keyboard-trap':                'Complex',
  'focus-order-semantics':        'Complex',
  'region':                       'Moderate',
  'heading-order':                'Moderate',
  'bypass':                       'Moderate',
  'label':                        'Quick',
  'button-name':                  'Quick',
  'image-alt':                    'Quick',
  'link-name':                    'Quick',
  'html-has-lang':                'Quick',
  'meta-viewport':                'Quick',
  'frame-title':                  'Quick',
  'tabindex':                     'Quick',
  'focus-visible':                'Quick',
};
