import { useState } from 'react';
import { Shield, Users, Clock, ExternalLink, Sparkles } from 'lucide-react';
import {
  getRuleFixTips, getRuleWhyMatters,
  getRuleEffort, getRuleImpactedUsers, getRuleCodePair, getRuleValidationSteps,
} from '../../config/axeFixGuidance';
import { nsWcagTagToMeta, truncateHtml, P4_EFFORT } from './scanUtils';
import ScreenshotModal from './ScreenshotModal';

const copyBtnBase = 'border rounded font-semibold whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors';
const copyBtnIdle = 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-charcoal text-body dark:text-gray-400 hover:border-teal hover:text-ink dark:hover:text-white';
const copyBtnDone = 'text-sage border-sage bg-transparent';

const EFFORT_META = {
  quick:       { label: 'Quick Fix',   desc: '< 30 min',  cls: 'text-sage bg-sage/10 border border-sage/20' },
  moderate:    { label: 'Moderate',    desc: '1–4 hours', cls: 'text-amber bg-amber/10 border border-amber/20' },
  significant: { label: 'Significant', desc: '1–2 days',  cls: 'text-coral bg-coral/10 border border-coral/20' },
};

function RecommendedFixCard({ violation, wcagMeta }) {
  const [checkedSteps, setCheckedSteps] = useState(new Set());
  const [copied, setCopied] = useState({});

  const ruleId = violation.id || '';
  const tips = getRuleFixTips(ruleId);
  const codePair = getRuleCodePair(ruleId);
  const effort = getRuleEffort(ruleId);
  const impactedUsers = getRuleImpactedUsers(ruleId, violation.impact);
  const validationSteps = getRuleValidationSteps(ruleId);
  const whyMatters = getRuleWhyMatters(ruleId, violation.impact);
  const effortInfo = EFFORT_META[effort] || EFFORT_META.quick;

  const copyText = (key, text) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setCopied(prev => { const n = { ...prev }; delete n[key]; return n; }), 2000);
    });
  };

  const toggleStep = (i) =>
    setCheckedSteps(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="rounded-xl border border-teal/20 bg-white dark:bg-charcoal overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.06)]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-teal/10 bg-teal/[0.03] dark:bg-teal/[0.05]">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-teal flex-shrink-0" />
          <span className="text-[12.5px] font-semibold text-ink dark:text-white">Recommended Fix</span>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${effortInfo.cls}`}>
            <Clock size={9} />
            {effortInfo.label} · {effortInfo.desc}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sage whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-sage inline-block flex-shrink-0" />
            High confidence
          </span>
        </div>
      </div>

      {/* ── Compliance + Impact row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-white/[0.06] border-b border-gray-100 dark:border-white/[0.06]">
        <div className="flex items-center gap-2 px-4 py-2">
          <Shield size={12} className="text-teal flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {wcagMeta ? (
              <>
                <span className="text-[11.5px] font-semibold text-teal whitespace-nowrap">WCAG {wcagMeta.criterion}</span>
                {wcagMeta.name && <span className="text-[11px] text-body dark:text-gray-500 truncate">· {wcagMeta.name}</span>}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${wcagMeta.level === 'AA' ? 'bg-teal/10 text-teal' : 'bg-sage/10 text-sage'}`}>
                  Level {wcagMeta.level}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-body dark:text-gray-500">WCAG 2.1 AA</span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2 px-4 py-2">
          <Users size={12} className="text-body dark:text-gray-400 flex-shrink-0 mt-0.5" />
          <div className="flex flex-wrap gap-1">
            {impactedUsers.map(u => (
              <span key={u} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-body dark:text-gray-400 whitespace-nowrap">
                {u}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Root cause ── */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
        <p className="text-[12.5px] text-body dark:text-gray-400 leading-relaxed m-0">{whyMatters}</p>
      </div>

      {/* ── Before / After code ── */}
      {codePair ? (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-coral/70 flex-shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-coral/80">Before</span>
              </div>
              <pre className="m-0 text-[11px] px-3 py-2.5 bg-coral/[0.05] dark:bg-coral/[0.04] border border-coral/15 rounded-lg text-ink dark:text-white overflow-x-auto whitespace-pre leading-relaxed font-mono">
                {codePair.before}
              </pre>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-teal">After</span>
                </div>
                <button type="button"
                  onClick={() => copyText('code', codePair.after)}
                  className={`${copyBtnBase} px-2 py-0.5 text-[10px] ${copied['code'] ? copyBtnDone : copyBtnIdle}`}>
                  {copied['code'] ? '✓ Copied' : '⧉ Copy'}
                </button>
              </div>
              <pre className="m-0 text-[11px] px-3 py-2.5 bg-teal/[0.05] dark:bg-teal/[0.05] border border-teal/15 rounded-lg text-ink dark:text-white overflow-x-auto whitespace-pre leading-relaxed font-mono">
                {codePair.after}
              </pre>
            </div>
          </div>
          {tips.length > 0 && (
            <ul className="mt-2.5 mb-0 pl-3.5 space-y-1 text-[11.5px] text-body dark:text-gray-500 leading-snug">
              {tips.map(tip => <li key={tip}>{tip}</li>)}
            </ul>
          )}
        </div>
      ) : tips.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
          <ul className="m-0 pl-3.5 space-y-1.5 text-[12.5px] text-body dark:text-gray-400 leading-snug">
            {tips.map(tip => <li key={tip}>{tip}</li>)}
          </ul>
        </div>
      )}

      {/* ── Validation checklist ── */}
      {validationSteps.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 mt-0">
            Validation Checklist
          </p>
          <div className="flex flex-col gap-2">
            {validationSteps.map((step, i) => (
              <button key={i} type="button" onClick={() => toggleStep(i)}
                className="flex items-center gap-2.5 text-left cursor-pointer bg-transparent border-0 p-0 font-[inherit] group">
                <span className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                  checkedSteps.has(i)
                    ? 'bg-teal border-teal'
                    : 'border-gray-300 dark:border-white/20 group-hover:border-teal/60'
                }`}>
                  {checkedSteps.has(i) && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={`text-[12px] leading-snug transition-colors ${
                  checkedSteps.has(i) ? 'line-through text-gray-400 dark:text-gray-600' : 'text-body dark:text-gray-400'
                }`}>
                  {step}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Action row ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50/70 dark:bg-white/[0.02]">
        {tips.length > 0 && (
          <button type="button"
            onClick={() => copyText('fix', tips.join('\n'))}
            className={`${copyBtnBase} px-2.5 py-1 text-[11px] ${copied['fix'] ? copyBtnDone : copyBtnIdle}`}>
            {copied['fix'] ? '✓ Copied' : '⧉ Copy Guidance'}
          </button>
        )}
        {violation.helpUrl && (
          <a href={violation.helpUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal hover:underline whitespace-nowrap">
            <ExternalLink size={10} />
            WCAG Reference
          </a>
        )}
      </div>

    </div>
  );
}

export default function ViolationRow({ violation }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedNode, setCopiedNode] = useState(null);
  const [screenshotOpen, setScreenshotOpen] = useState(false);

  const impact = (violation.impact ?? 'minor').toLowerCase();
  const impactConfig = {
    critical: { badge: 'bg-coral/10 text-coral border border-coral/20',               dot: 'bg-coral',       sublabel: 'High Risk',   sublabelCls: 'text-coral/60' },
    serious:  { badge: 'bg-terracotta/10 text-terracotta border border-terracotta/20', dot: 'bg-terracotta',  sublabel: 'Medium Risk', sublabelCls: 'text-terracotta/60' },
    moderate: { badge: 'bg-amber/10 text-amber border border-amber/20',                dot: 'bg-amber',       sublabel: 'Low Risk',    sublabelCls: 'text-amber/60' },
    minor:    { badge: 'bg-sage/10 text-sage border border-sage/20',                   dot: 'bg-sage',        sublabel: 'Info',        sublabelCls: 'text-sage/60' },
  }[impact] ?? { badge: 'bg-gray-100 text-gray-600 border border-gray-200', dot: 'bg-gray-400', sublabel: '', sublabelCls: '' };

  const wcag = nsWcagTagToMeta(violation.tags);
  const nodes = violation.nodes ?? [];
  const hasScreenshot = typeof violation.screenshot === 'string' && violation.screenshot.trim().length > 0;
  const screenshotType = (typeof violation.screenshotType === 'string' && violation.screenshotType.trim()) || 'image/jpeg';

  const copyNode = (text, ni) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedNode(ni);
      setTimeout(() => setCopiedNode(null), 2000);
    });
  };

  return (
    <div className="border border-gray-100 dark:border-white/[0.07] rounded-xl overflow-hidden">

      {/* Header (always visible) */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left bg-white dark:bg-charcoal hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition-colors"
      >
        <span className={`mt-[18px] w-2 h-2 rounded-full flex-shrink-0 ${impactConfig.dot}`} />
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${impactConfig.badge}`}>
              {impact.charAt(0).toUpperCase() + impact.slice(1)}
              {impactConfig.sublabel && (
                <span className={`ml-1 font-normal normal-case ${impactConfig.sublabelCls}`}>· {impactConfig.sublabel}</span>
              )}
            </span>
            {wcag && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                WCAG {wcag.criterion} {wcag.level}
              </span>
            )}
            {P4_EFFORT[violation.id] && (
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                P4_EFFORT[violation.id] === 'Quick'    ? 'bg-sage/10 text-sage border-sage/20' :
                P4_EFFORT[violation.id] === 'Moderate' ? 'bg-amber/10 text-amber border-amber/20' :
                'bg-coral/10 text-coral border-coral/20'
              }`}>{P4_EFFORT[violation.id]} Fix</span>
            )}
          </div>
          <p className="text-sm font-semibold text-ink dark:text-white leading-snug">{violation.help || violation.description}</p>
          <p className="text-[11px] font-mono text-body dark:text-gray-500 mt-0.5">{violation.id}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-3">
          <span className="text-xs text-body dark:text-gray-400 whitespace-nowrap">
            {nodes.length} element{nodes.length !== 1 ? 's' : ''}
          </span>
          <span className={`text-body dark:text-gray-500 text-xs transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.02] px-4 pb-5 pt-4 space-y-4">

          {hasScreenshot && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setScreenshotOpen(true); }}
              className="px-3.5 py-2 bg-coral/[0.12] text-[#b91c1c] border border-coral/30 rounded-lg text-[13px] font-medium cursor-pointer hover:bg-coral/[0.18] transition-colors"
            >
              View screenshot
            </button>
          )}

          <RecommendedFixCard violation={violation} wcagMeta={wcag} />

          {/* Affected elements */}
          {nodes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">
                Affected Elements <span className="font-normal normal-case tracking-normal">({nodes.length})</span>
              </p>
              <div className="space-y-2">
                {nodes.slice(0, 3).map((node, ni) => (
                  <div key={ni}>
                    {node.failureSummary && (
                      <p className="text-[11px] text-amber mb-1">
                        {node.failureSummary.replace(/^Fix (?:all|any|one) of the following:\s*/i, '').trim()}
                      </p>
                    )}
                    <div className="relative group">
                      <pre className="text-xs bg-gray-900 dark:bg-black/50 text-emerald-300 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-24 m-0">
                        {truncateHtml(node.html)}
                      </pre>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); copyNode(node.html || '', ni); }}
                        className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-gray-300 hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        {copiedNode === ni ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
                {nodes.length > 3 && (
                  <p className="text-xs text-body dark:text-gray-500">… and {nodes.length - 3} more element{nodes.length - 3 !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {screenshotOpen && hasScreenshot && (
        <ScreenshotModal
          src={`data:${screenshotType};base64,${violation.screenshot.trim()}`}
          title={`${violation.id || 'Violation'} – screenshot`}
          onClose={() => setScreenshotOpen(false)}
        />
      )}
    </div>
  );
}
