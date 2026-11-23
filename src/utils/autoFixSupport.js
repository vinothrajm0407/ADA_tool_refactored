import { useEffect, useState } from 'react';
import { apiFetch } from './api';

// Which rules Auto Fix can handle (GET /api/auto-fix/support), fetched once per page load.
let cached;
function loadSupport() {
  cached ??= apiFetch('/api/auto-fix/support')
    .then(res => res.json())
    .then(data => (data.ok ? data : null))
    .catch(() => null);
  return cached;
}

export function useAutoFixSupport() {
  const [support, setSupport] = useState(null);
  useEffect(() => { loadSupport().then(setSupport); }, []);
  return support;
}

// Why Auto Fix can't run for this rule, or null when it can (or support is
// unknown — never block on a failed lookup; the run itself still reports why).
// A node with no HTML is a page-wide fix, which always needs the AI.
export function autoFixUnavailableReason(support, ruleId, hasNodeHtml = true) {
  if (!support || support.ai) return null;
  if (hasNodeHtml && support.rules.includes(ruleId)) return null;
  return hasNodeHtml
    ? 'Auto Fix isn’t available for this rule yet — it has no built-in fix and AI fixes are off (no GEMINI_API_KEY). Fix it manually using the guidance above.'
    : 'Auto Fix can’t add missing page-wide elements without AI fixes (no GEMINI_API_KEY). Fix it manually using the guidance above.';
}
