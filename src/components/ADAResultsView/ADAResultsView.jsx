import { apiFetch } from '../../utils/api';
import React, { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Shield, Users, Clock, ExternalLink, Sparkles, BookOpen } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import {
  getRuleFixTips, getRuleWhyMatters, splitFailureSummary,
  getRuleEffort, getRuleImpactedUsers, getRuleCodePair, getRuleValidationSteps,
} from '../../config/axeFixGuidance'
import { formatDateTime } from '../../utils/format'

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

const WCAG_AA_CRITERIA = new Set([
  '1.2.4','1.2.5','1.3.4','1.3.5','1.4.3','1.4.4','1.4.5',
  '1.4.10','1.4.11','1.4.12','1.4.13','2.4.5','2.4.6','2.4.7',
  '3.1.2','3.2.3','3.2.4','3.3.3','3.3.4','4.1.3',
])

const WCAG_CRITERION_NAMES = {
  '1.1.1':'Non-text Content','1.3.1':'Info and Relationships','1.3.2':'Meaningful Sequence',
  '1.3.5':'Identify Input Purpose','1.4.1':'Use of Color','1.4.3':'Contrast (Minimum)',
  '1.4.4':'Resize Text','1.4.10':'Reflow','1.4.11':'Non-text Contrast','1.4.12':'Text Spacing',
  '2.1.1':'Keyboard','2.1.2':'No Keyboard Trap','2.4.1':'Bypass Blocks','2.4.2':'Page Titled',
  '2.4.3':'Focus Order','2.4.4':'Link Purpose (In Context)','2.4.6':'Headings and Labels',
  '2.4.7':'Focus Visible','3.1.1':'Language of Page','3.2.2':'On Input',
  '3.3.1':'Error Identification','3.3.2':'Labels or Instructions',
  '4.1.1':'Parsing','4.1.2':'Name, Role, Value','4.1.3':'Status Messages',
}

function wcagTagToMeta(tags) {
  if (!Array.isArray(tags)) return null
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const lower = tag.toLowerCase()
    if (/^wcag\d*a+$/.test(lower)) continue
    const m = lower.match(/^wcag(\d{3,})$/)
    if (!m) continue
    const digits = m[1]
    const criterion = `${digits[0]}.${digits[1]}.${digits.slice(2)}`
    const level = WCAG_AA_CRITERIA.has(criterion) ? 'AA' : 'A'
    const name = WCAG_CRITERION_NAMES[criterion] || null
    return { criterion, level, name }
  }
  return null
}

const SCORE_WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 }

function computeScore(violations) {
  let penalty = 0
  for (const v of violations) {
    const w = SCORE_WEIGHTS[(v.impact || 'minor').toLowerCase()] ?? 1
    penalty += (v.nodes?.length ?? 1) * w
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

function scoreGradeInfo(score) {
  if (score >= 90) return { grade: 'A', color: 'success' }
  if (score >= 75) return { grade: 'B', color: 'good' }
  if (score >= 60) return { grade: 'C', color: 'warning' }
  if (score >= 45) return { grade: 'D', color: 'serious' }
  return              { grade: 'F', color: 'critical' }
}

function scoreMessage(score) {
  if (score >= 90) return 'Excellent accessibility compliance. Minor or no issues found.'
  if (score >= 75) return 'Good accessibility baseline with some issues requiring attention.'
  if (score >= 60) return 'Moderate accessibility issues found. Prioritize critical and serious violations.'
  if (score >= 45) return 'Significant accessibility barriers detected. Remediation required.'
  return 'Critical accessibility failures present. Immediate remediation required.'
}

function buildSeverityBreakdown(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of violations) {
    const impact = (v.impact || 'minor').toLowerCase()
    if (impact in counts) counts[impact] += (v.nodes?.length ?? 1)
  }
  return counts
}

function buildTopIssues(violations) {
  const map = {}
  for (const v of violations) {
    const id = v.id || 'unknown'
    if (!map[id]) map[id] = { id, title: formatRuleTitle(v), count: 0 }
    map[id].count += (v.nodes?.length ?? 1)
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8)
}

const SEVERITY_ROWS = [
  { key: 'critical', label: 'Critical', sublabel: 'High Risk'   },
  { key: 'serious',  label: 'Serious',  sublabel: 'Medium Risk' },
  { key: 'moderate', label: 'Moderate', sublabel: 'Low Risk'    },
  { key: 'minor',    label: 'Minor',    sublabel: 'Info'        },
]

const IMPACT_CLS = {
  critical: 'bg-coral/10 text-coral',
  serious:  'bg-terracotta/[0.15] text-terracotta',
  moderate: 'bg-amber/10 text-[#92400e] dark:text-amber',
  minor:    'bg-sage/[0.12] text-sage',
}

const DIAL_CLS = {
  success:  'border-teal text-teal',
  good:     'border-sage text-sage',
  warning:  'border-amber text-amber',
  serious:  'border-terracotta text-terracotta',
  critical: 'border-coral text-coral',
}

const GRADE_CLS = {
  success:  'bg-teal/10 text-teal',
  good:     'bg-sage/[0.12] text-sage',
  warning:  'bg-amber/10 text-[#92400e] dark:text-amber',
  serious:  'bg-terracotta/[0.15] text-terracotta',
  critical: 'bg-coral/10 text-coral',
}

const SEV_DOT_CLS = {
  critical: 'bg-coral',
  serious:  'bg-terracotta',
  moderate: 'bg-amber',
  minor:    'bg-gray-400 dark:bg-gray-500',
}

const SEV_COUNT_CLS = {
  critical: 'text-coral',
  serious:  'text-terracotta',
  moderate: 'text-amber',
  minor:    'text-gray-400 dark:text-gray-500',
}

function ImpactBadge({ impact }) {
  if (!impact) return null
  const c = impact.toLowerCase()
  const label = c.charAt(0).toUpperCase() + c.slice(1)
  const cls = IMPACT_CLS[c] ?? 'bg-gray-100 dark:bg-white/10 text-body dark:text-gray-400'
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}

function formatRuleTitle(rule) {
  if (rule?.help && typeof rule.help === 'string') return rule.help
  const rawId = (rule?.id || '').toString().trim()
  if (!rawId) return 'Accessibility issue'
  return rawId
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function simplifyFailureLine(line) {
  if (!line) return ''
  const text = line
    .replace(/^Fix all of the following:\s*/i, '')
    .replace(/^Fix any of the following:\s*/i, '')
    .replace(/^Fix one of the following:\s*/i, '')
    .trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function getNodeSummary(node) {
  const lines = splitFailureSummary(node?.failureSummary)
  for (const line of lines) {
    const simplified = simplifyFailureLine(line)
    if (simplified) return simplified
  }
  return ''
}

const copyBtnBase = 'border rounded font-semibold whitespace-nowrap flex-shrink-0 font-[inherit] cursor-pointer transition-colors'
const copyBtnIdle = 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-charcoal text-body dark:text-gray-400 hover:border-teal hover:text-ink dark:hover:text-white'
const copyBtnDone = 'text-sage border-sage bg-transparent'

const EFFORT_META = {
  quick:       { label: 'Quick Fix',   desc: '< 30 min',  cls: 'text-sage bg-sage/10 border border-sage/20' },
  moderate:    { label: 'Moderate',    desc: '1–4 hours', cls: 'text-amber bg-amber/10 border border-amber/20' },
  significant: { label: 'Significant', desc: '1–2 days',  cls: 'text-coral bg-coral/10 border border-coral/20' },
}

function RecommendedFixCard({ rule, wcagMeta, copied, copyText, violationKey }) {
  const [checkedSteps, setCheckedSteps] = useState(new Set())
  const { navigate, setWcagCriterionId } = useApp()
  const ruleId = rule.id || ''
  const tips = getRuleFixTips(ruleId)
  const codePair = getRuleCodePair(ruleId)
  const effort = getRuleEffort(ruleId)
  const impactedUsers = getRuleImpactedUsers(ruleId, rule.impact)
  const validationSteps = getRuleValidationSteps(ruleId)
  const whyMatters = getRuleWhyMatters(ruleId, rule.impact)
  const effortInfo = EFFORT_META[effort] || EFFORT_META.quick

  const toggleStep = (i) =>
    setCheckedSteps(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  return (
    <div className="my-3.5 rounded-xl border border-teal/20 bg-white dark:bg-charcoal overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.06)]">

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
                  onClick={() => copyText(`code-${violationKey}`, codePair.after)}
                  className={`${copyBtnBase} px-2 py-0.5 text-[10px] ${copied[`code-${violationKey}`] ? copyBtnDone : copyBtnIdle}`}>
                  {copied[`code-${violationKey}`] ? '✓ Copied' : '⧉ Copy'}
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
            onClick={() => copyText(`fix-${violationKey}`, tips.join('\n'))}
            className={`${copyBtnBase} px-2.5 py-1 text-[11px] ${copied[`fix-${violationKey}`] ? copyBtnDone : copyBtnIdle}`}>
            {copied[`fix-${violationKey}`] ? '✓ Copied' : '⧉ Copy Guidance'}
          </button>
        )}
        {wcagMeta?.criterion && (
          <button
            type="button"
            onClick={() => { setWcagCriterionId(wcagMeta.criterion); navigate('wcag-reference') }}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal hover:underline whitespace-nowrap border-0 bg-transparent p-0 cursor-pointer"
          >
            <BookOpen size={10} />
            Learn More
          </button>
        )}
      </div>

    </div>
  )
}

export default function ADAResultsView({ initialResult = null, processResult = null, scanIdToLoad = null, onClearResult }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [filterImpact, setFilterImpact] = useState([])
  const [search, setSearch] = useState('')
  const [showPasses, setShowPasses] = useState(false)
  const [expandedRule, setExpandedRule] = useState(null)
  const [screenshotError, setScreenshotError] = useState(false)
  const [screenshotModal, setScreenshotModal] = useState(null)
  const [copied, setCopied] = useState({})
  const [loadedScanResult, setLoadedScanResult] = useState(null)
  const [loadingScan, setLoadingScan] = useState(false)
  const [loadScanError, setLoadScanError] = useState(null)

  const copyText = (key, text) => {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [key]: true }))
      setTimeout(() => setCopied((prev) => { const n = { ...prev }; delete n[key]; return n }), 2000)
    })
  }

  useEffect(() => {
    if (scanIdToLoad == null || scanIdToLoad === '') {
      setLoadedScanResult(null)
      setLoadScanError(null)
      return
    }
    let cancelled = false
    setLoadingScan(true)
    setLoadScanError(null)
    apiFetch(`/api/history/${scanIdToLoad}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok && data.result) {
          setLoadedScanResult(data.result)
          setError('')
        } else {
          setLoadedScanResult(null)
          setLoadScanError(data.error || 'Failed to load scan result')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadedScanResult(null)
          setLoadScanError(err.message || 'Network error')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingScan(false)
      })
    return () => { cancelled = true }
  }, [scanIdToLoad])

  const effectiveProcessResult = loadedScanResult ?? processResult
  const displayResult = loadedScanResult?.axeResult ?? result ?? initialResult
  const scanProfile = effectiveProcessResult?.includeBestPractices
    ? 'WCAG 2.1 AA + Best Practices'
    : 'WCAG 2.1 AA'
  const screenshotData = displayResult?.screenshot && typeof displayResult.screenshot === 'string'
    ? displayResult.screenshot.trim()
    : ''
  const screenshotType = displayResult?.screenshotType && typeof displayResult.screenshotType === 'string'
    ? displayResult.screenshotType.trim()
    : 'image/jpeg'
  const hasScreenshot = screenshotData.length > 0

  useEffect(() => {
    setScreenshotError(false)
  }, [displayResult])

  const handleFile = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result || '{}')
        if (!data.passes && !data.violations && !data.url) {
          setError('Not a valid axe-core result (expected url, passes, violations)')
          setResult(null)
          return
        }
        setResult(data)
        setExpandedRule(null)
        setScreenshotError(false)
      } catch (err) {
        setError('Invalid JSON: ' + (err.message || 'parse error'))
        setResult(null)
      }
    }
    reader.readAsText(file)
  }

  const violations = displayResult?.violations ?? []
  const passes = displayResult?.passes ?? []
  const incomplete = displayResult?.incomplete ?? []
  const impactCounts = violations.reduce((acc, v) => {
    const i = (v.impact || 'other').toLowerCase()
    acc[i] = (acc[i] || 0) + 1
    return acc
  }, {})

  const filteredViolations = violations.filter((v) => {
    const matchImpact = filterImpact.length === 0 || filterImpact.includes((v.impact || '').toLowerCase())
    const matchSearch =
      !search ||
      (v.id && v.id.toLowerCase().includes(search.toLowerCase())) ||
      (v.description && v.description.toLowerCase().includes(search.toLowerCase())) ||
      (v.help && v.help.toLowerCase().includes(search.toLowerCase()))
    return matchImpact && matchSearch
  })

  const findRuleByKey = (key) => {
    const idx = filteredViolations.findIndex((r, i) => `${r.id || JSON.stringify(r)}-${i}` === key)
    return idx >= 0 ? filteredViolations[idx] : null
  }

  const modalContent =
    screenshotModal?.kind === 'full' && hasScreenshot
      ? { src: `data:${screenshotType};base64,${screenshotData}`, title: 'Page as tested' }
      : screenshotModal?.kind === 'rule'
        ? (() => {
            const rule = findRuleByKey(screenshotModal.ruleKey)
            const shot = rule?.screenshot && typeof rule.screenshot === 'string' ? rule.screenshot.trim() : ''
            const type = rule?.screenshotType && typeof rule.screenshotType === 'string' ? rule.screenshotType.trim() : 'image/jpeg'
            return shot ? { src: `data:${type};base64,${shot}`, title: `${rule?.id || 'Violation'} – screenshot` } : null
          })()
        : null

  const totalRules = (displayResult?.passes?.length ?? 0) + (displayResult?.violations?.length ?? 0)
  const passRate = totalRules > 0 ? Math.round((displayResult?.passes?.length / totalRules) * 100) : 0

  const score = displayResult ? computeScore(violations) : null
  const gradeInfo = score !== null ? scoreGradeInfo(score) : null
  const severityBreakdown = displayResult ? buildSeverityBreakdown(violations) : null
  const topIssues = displayResult ? buildTopIssues(violations) : []
  const maxTopCount = topIssues.length > 0 ? topIssues[0].count : 1

  const scrollToViolation = (ruleId) => {
    setFilterImpact([])
    setSearch('')
    setTimeout(() => {
      document.getElementById(`vi-${ruleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const handleClearResult = () => {
    setResult(null)
    setError('')
    onClearResult?.()
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0">
      <div>
        <h1 className="mb-2 font-heading font-bold text-3xl text-ink dark:text-white">ADA Automation Results</h1>
        <p className="mb-5 text-[15px] text-body dark:text-gray-400">
          Upload an axe-core (or compatible) JSON result to view summary, violations, and passed rules.
        </p>

        {displayResult && effectiveProcessResult?.usedFallback && (
          <div className="px-4 py-3 bg-coral/10 text-coral rounded-lg mb-4" role="alert">
            This result came from the fallback sample, not a live accessibility scan.
            {effectiveProcessResult.fallbackError ? ` Scan error: ${effectiveProcessResult.fallbackError}` : ''}
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center cursor-pointer">
            <span className="px-5 py-2.5 bg-teal text-white rounded-lg font-semibold text-[15px] hover:opacity-90 transition-opacity select-none">
              Choose result file
            </span>
            <input type="file" accept=".json,application/json" onChange={handleFile} className="sr-only" />
          </label>
          {displayResult && (
            <button type="button" onClick={handleClearResult}
              className="px-3.5 py-2 bg-transparent border border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px] text-body dark:text-gray-400 cursor-pointer font-[inherit] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-ink dark:hover:text-white transition-colors">
              Clear result / Load another
            </button>
          )}
        </div>

        {error && (
          <div className="px-4 py-3 bg-coral/10 text-coral rounded-lg mb-4" role="alert">{error}</div>
        )}

        {scanIdToLoad != null && loadingScan && (
          <p className="p-6 bg-white dark:bg-charcoal border border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl text-body dark:text-gray-500 text-center">
            Loading scan result…
          </p>
        )}
        {scanIdToLoad != null && loadScanError && !loadingScan && (
          <div className="px-4 py-3 bg-coral/10 text-coral rounded-lg mb-4 flex flex-wrap items-center gap-3" role="alert">
            <span>{loadScanError}</span>
            {onClearResult && (
              <button type="button" onClick={onClearResult}
                className="px-3.5 py-2 bg-transparent border border-coral/40 rounded-lg text-[13px] font-[inherit] cursor-pointer text-coral hover:bg-coral/10 transition-colors">
                Close
              </button>
            )}
          </div>
        )}

        {displayResult && loadedScanResult && (
          <p className="mb-3 px-3.5 py-2.5 bg-teal/10 dark:bg-teal/[0.08] rounded-lg text-sm text-body dark:text-gray-400">
            Viewing stored scan from history (URL: {displayResult.url || '—'}).
          </p>
        )}
        {displayResult && initialResult && !result && !loadedScanResult && (
          <p className="mb-3 px-3.5 py-2.5 bg-teal/10 dark:bg-teal/[0.08] rounded-lg text-sm text-body dark:text-gray-400">
            Showing result from your last ADA check (URL: {displayResult.url || '—'}).
          </p>
        )}

        {!displayResult && !error && !(scanIdToLoad != null && (loadingScan || loadScanError)) && (
          <div className="p-6 bg-white dark:bg-charcoal border border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl text-body dark:text-gray-500 text-center">
            <p>No result loaded. Use the button above to upload a JSON file (e.g. CollectionPageADACheck*.json).</p>
          </div>
        )}

        {displayResult && hasScreenshot && (
          <section className="bg-white dark:bg-charcoal rounded-xl p-5 mb-6 shadow-soft" aria-label="Screenshot of tested page">
            <h2 className="mb-2 font-heading font-semibold text-lg text-ink dark:text-white">Page screenshot</h2>
            <p className="mb-3 text-sm text-body dark:text-gray-400 leading-snug">
              View the page as it was when the accessibility check ran.
            </p>
            <button type="button" onClick={() => setScreenshotModal({ kind: 'full' })}
              className="px-5 py-2.5 bg-teal text-white rounded-lg font-semibold text-[15px] cursor-pointer border-none font-[inherit] hover:opacity-90 transition-opacity">
              View page screenshot
            </button>
          </section>
        )}

        {displayResult && !hasScreenshot && (
          <div className="mb-5 px-4 py-3 bg-black/[0.05] dark:bg-white/[0.04] rounded-lg text-sm text-body dark:text-gray-400 space-y-2">
            {effectiveProcessResult?.usedFallback ? (
              <>
                <p><strong className="text-ink dark:text-white">Screenshots are not available</strong> because the accessibility check could not run; a fallback result was used instead.</p>
                {effectiveProcessResult.fallbackError && (
                  <p className="font-mono text-[12.8px] text-coral">{effectiveProcessResult.fallbackError}</p>
                )}
                {(effectiveProcessResult.fallbackError || '').toLowerCase().includes('greenlet') || (effectiveProcessResult.fallbackError || '').toLowerCase().includes('dll') ? (
                  <>
                    <p><strong className="text-ink dark:text-white">Fix (Windows):</strong> Install the <strong className="text-ink dark:text-white">Microsoft Visual C++ Redistributable</strong>, then re-run.</p>
                    <ol className="pl-5 my-2 list-decimal">
                      <li>Download and install: <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">VC++ Redistributable x64</a> (one-time).</li>
                      <li>Restart your terminal, then from the project folder run:</li>
                    </ol>
                    <pre className="my-2 px-3 py-2.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-lg text-[13.6px] overflow-x-auto font-mono">python -m playwright install chromium</pre>
                    <p>Then run <code className="font-mono bg-black/[0.06] dark:bg-white/[0.06] px-1 rounded">python app.py</code> and try <strong className="text-ink dark:text-white">Process</strong> again. See <code className="font-mono bg-black/[0.06] dark:bg-white/[0.06] px-1 rounded">TROUBLESHOOTING.md</code> in the project for more.</p>
                  </>
                ) : (
                  <>
                    <p>To get screenshots, install Playwright's Chromium from the project folder:</p>
                    <pre className="my-2 px-3 py-2.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-lg text-[13.6px] overflow-x-auto font-mono">python -m playwright install chromium</pre>
                    <p>Then run the app with <code className="font-mono bg-black/[0.06] dark:bg-white/[0.06] px-1 rounded">python app.py</code> and try <strong className="text-ink dark:text-white">Process</strong> again.</p>
                  </>
                )}
              </>
            ) : (
              <p>
                No screenshot for this result. Screenshots are included when you run <strong className="text-ink dark:text-white">Process</strong> from the app; they are not in sample or uploaded results from older runs.
              </p>
            )}
          </div>
        )}

        {displayResult && (
          <>
            {/* Score + Severity grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
              <section className="bg-white dark:bg-charcoal rounded-xl p-5 shadow-soft" aria-label="Accessibility Score">
                <h2 className="mb-4 text-[11px] font-bold tracking-[0.06em] uppercase text-gray-400 dark:text-gray-500">
                  Accessibility Score
                </h2>
                <div className="flex items-center gap-5">
                  <div className={`w-[88px] h-[88px] rounded-full border-4 flex flex-col items-center justify-center flex-shrink-0 ${DIAL_CLS[gradeInfo.color]}`}>
                    <span className="text-[26px] font-extrabold leading-none tracking-tight">{score}</span>
                    <span className="text-[11px] font-semibold opacity-65 mt-0.5">/ 100</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`inline-block text-[14px] font-bold px-2.5 py-0.5 rounded-full mb-2 ${GRADE_CLS[gradeInfo.color]}`}>
                      Grade {gradeInfo.grade}
                    </span>
                    <p className="m-0 text-[13px] text-body dark:text-gray-400 leading-snug">{scoreMessage(score)}</p>
                  </div>
                </div>
              </section>

              <section className="bg-white dark:bg-charcoal rounded-xl p-5 shadow-soft" aria-label="Severity Breakdown">
                <h2 className="mb-4 text-[11px] font-bold tracking-[0.06em] uppercase text-gray-400 dark:text-gray-500">
                  Severity Breakdown
                </h2>
                <div className="flex flex-col gap-2.5">
                  {SEVERITY_ROWS.map(({ key, label, sublabel }) => (
                    <div key={key} className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SEV_DOT_CLS[key]}`} />
                      <div className="flex-1 flex items-baseline gap-1.5">
                        <span className="text-sm text-body dark:text-gray-400">{label}</span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">{sublabel}</span>
                      </div>
                      <span className={`text-base font-bold min-w-[28px] text-right ${SEV_COUNT_CLS[key]}`}>
                        {severityBreakdown[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Summary */}
            <section className="bg-white dark:bg-charcoal rounded-xl p-5 mb-6 shadow-soft" aria-label="Run summary">
              <h2 className="mb-4 font-heading font-semibold text-lg text-ink dark:text-white">Summary</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 mb-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">URL</span>
                  <a href={displayResult.url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-teal break-all hover:underline">
                    {displayResult.url || '—'}
                  </a>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">Timestamp</span>
                  <span className="text-sm text-ink dark:text-white">{formatDateTime(displayResult.timestamp)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">Engine</span>
                  <span className="text-sm text-ink dark:text-white">{displayResult.testEngine?.name} {displayResult.testEngine?.version}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">Viewport</span>
                  <span className="text-sm text-ink dark:text-white">{displayResult.testEnvironment?.windowWidth} × {displayResult.testEnvironment?.windowHeight}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">Scan profile</span>
                  <span className="text-sm text-ink dark:text-white">{scanProfile}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-5 mb-3">
                <div className="flex flex-col items-center min-w-[70px]">
                  <span className="text-2xl font-bold text-sage">{passes.length}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Passed</span>
                </div>
                <div className="flex flex-col items-center min-w-[70px]">
                  <span className="text-2xl font-bold text-coral">{violations.length}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Violations</span>
                </div>
                <div className="flex flex-col items-center min-w-[70px]">
                  <span className="text-2xl font-bold text-amber">{incomplete.length}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Incomplete</span>
                </div>
                <div className="flex flex-col items-center min-w-[70px]">
                  <span className="text-2xl font-bold text-ink dark:text-white">{passRate}%</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Pass rate</span>
                </div>
              </div>
              {Object.keys(impactCounts).length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500">By impact:</span>
                  {IMPACT_ORDER.filter((i) => impactCounts[i]).map((i) => (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      <ImpactBadge impact={i} /> {impactCounts[i]}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Filters */}
            {(violations.length > 0 || search) && (
              <div className="flex flex-wrap gap-4 items-center mb-5">
                <input
                  type="search"
                  placeholder="Search by rule id or description"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 min-w-[200px] px-3.5 py-2.5 border border-gray-200 dark:border-white/[0.08] rounded-lg bg-white dark:bg-charcoal text-ink dark:text-white text-[15px] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition-colors"
                  aria-label="Search violations"
                />
                <div className="flex flex-wrap gap-3">
                  {IMPACT_ORDER.map((i) => (
                    <label key={i} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={filterImpact.includes(i)}
                        onChange={(e) =>
                          setFilterImpact((prev) =>
                            e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)
                          )
                        }
                        className="accent-teal"
                      />
                      <ImpactBadge impact={i} />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Top Issues */}
            {topIssues.length > 0 && (
              <section className="bg-white dark:bg-charcoal rounded-xl px-6 py-5 mb-6 shadow-soft" aria-label="Top issues summary">
                <h2 className="mb-3.5 font-heading font-semibold text-lg text-ink dark:text-white">Top Issues</h2>
                <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                  {topIssues.map((issue) => (
                    <li key={issue.id}>
                      <button type="button" onClick={() => scrollToViolation(issue.id)} title={`Scroll to ${issue.id}`}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 border-none bg-ivory dark:bg-night/50 rounded-lg cursor-pointer text-left hover:bg-teal/[0.08] transition-colors font-[inherit]">
                        <span className="flex-1 text-sm font-medium text-ink dark:text-white whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                          {issue.title}
                        </span>
                        <span className="w-[100px] h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden flex-shrink-0">
                          <span className="block h-full bg-teal rounded-full"
                            style={{ width: `${Math.round((issue.count / maxTopCount) * 100)}%`, transition: 'width 0.4s ease-out' }} />
                        </span>
                        <span className="min-w-[28px] text-right text-[13px] font-bold text-coral flex-shrink-0">
                          {issue.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Violations */}
            <section className="bg-white dark:bg-charcoal rounded-xl p-5 mb-6 shadow-soft" aria-label="Violations">
              <h2 className="mb-4 font-heading font-semibold text-lg text-ink dark:text-white">
                Violations ({filteredViolations.length})
              </h2>
              {filteredViolations.length === 0 ? (
                <p className="text-[15px] text-gray-400 dark:text-gray-500">No violations match the current filters.</p>
              ) : (
                <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
                  {filteredViolations.map((rule, violationIndex) => {
                    const key = `${rule.id || JSON.stringify(rule)}-${violationIndex}`
                    const isExpanded = expandedRule === key
                    const wcagMeta = wcagTagToMeta(rule.tags)
                    return (
                      <li key={key} id={`vi-${rule.id || violationIndex}`}
                        className="border border-gray-100 dark:border-white/[0.06] rounded-xl overflow-hidden bg-white dark:bg-charcoal hover:border-teal/40 hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)] hover:-translate-y-px transition-all duration-150">
                        <div
                          className="flex items-center gap-2.5 px-3.5 py-3 cursor-pointer bg-teal/[0.04] dark:bg-teal/[0.06] hover:bg-teal/[0.08] transition-colors"
                          onClick={() => setExpandedRule(isExpanded ? null : key)}
                          onKeyDown={(e) => e.key === 'Enter' && setExpandedRule(isExpanded ? null : key)}
                          role="button" tabIndex={0} aria-expanded={isExpanded}
                        >
                          <div className="min-w-0 flex flex-col gap-0.5 flex-1">
                            <span className="font-semibold text-[14.8px] text-ink dark:text-white overflow-hidden text-ellipsis whitespace-nowrap">
                              {formatRuleTitle(rule)}
                            </span>
                            {rule.id && (
                              <span className="font-mono text-[11.2px] text-gray-400 dark:text-gray-500 opacity-80">
                                Rule: {rule.id}
                              </span>
                            )}
                          </div>
                          <span className="min-w-[24px] h-6 px-2 rounded-full inline-flex items-center justify-center bg-ivory dark:bg-night/50 text-body dark:text-gray-400 text-xs font-bold border border-gray-100 dark:border-white/[0.06] mx-1" title="Affected elements">
                            {rule.nodes?.length ?? 0}
                          </span>
                          <ImpactBadge impact={rule.impact} />
                          {wcagMeta && (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em] uppercase bg-teal/10 text-teal whitespace-nowrap flex-shrink-0">
                              WCAG {wcagMeta.criterion} {wcagMeta.level}
                            </span>
                          )}
                          <span className="text-gray-400 dark:text-gray-500 ml-1 flex-shrink-0 flex items-center">
                            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="px-3.5 py-3.5 border-t border-gray-100 dark:border-white/[0.06] text-sm">
                            {rule.screenshot && typeof rule.screenshot === 'string' && rule.screenshot.trim() && (
                              <div className="mb-3">
                                <button type="button" onClick={() => setScreenshotModal({ kind: 'rule', ruleKey: key })}
                                  className="px-3.5 py-2 bg-coral/[0.12] text-[#b91c1c] border border-coral/30 rounded-lg text-[13px] font-medium cursor-pointer font-[inherit] hover:bg-coral/[0.18] transition-colors">
                                  View screenshot
                                </button>
                              </div>
                            )}
                            <p className="mb-1.5 text-ink dark:text-white">{rule.description}</p>
                            <p className="mb-0 text-body dark:text-gray-400">{rule.help}</p>

                            <RecommendedFixCard
                              rule={rule}
                              wcagMeta={wcagMeta}
                              copied={copied}
                              copyText={copyText}
                              violationKey={key}
                            />

                            <div className="mt-1">
                              <strong className="block mb-2 text-[13px] text-ink dark:text-white">
                                Affected elements ({rule.nodes?.length ?? 0})
                              </strong>
                              {(rule.nodes || []).slice(0, 20).map((node, idx) => (
                                <div key={idx} className="mb-3 p-2.5 bg-ivory dark:bg-night/50 rounded-lg">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <code className="block text-xs break-all text-body dark:text-gray-400">
                                      {(node.target && (Array.isArray(node.target) ? node.target.flat().join(' ') : node.target)) || '—'}
                                    </code>
                                    <button type="button" onClick={() => copyText(`node-${key}-${idx}`, node.html || '')}
                                      className={`${copyBtnBase} px-1.5 py-0.5 text-[10px] ${copied[`node-${key}-${idx}`] ? copyBtnDone : copyBtnIdle}`}>
                                      {copied[`node-${key}-${idx}`] ? '✓' : 'Copy'}
                                    </button>
                                  </div>
                                  {getNodeSummary(node) && (
                                    <p className="mb-1.5 text-[12.2px] text-body dark:text-gray-500">{getNodeSummary(node)}</p>
                                  )}
                                  <pre className="m-0 text-[11px] whitespace-pre-wrap break-all max-h-[120px] overflow-auto text-body dark:text-gray-400">
                                    {node.html || '—'}
                                  </pre>
                                </div>
                              ))}
                              {(rule.nodes?.length ?? 0) > 20 && (
                                <p className="mt-2 text-[13px] text-gray-400 dark:text-gray-500">
                                  … and {(rule.nodes?.length ?? 0) - 20} more
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Passes (collapsible) */}
            <section className="bg-white dark:bg-charcoal rounded-xl p-4 shadow-soft" aria-label="Passed rules">
              <button type="button" onClick={() => setShowPasses((p) => !p)} aria-expanded={showPasses}
                className="w-full py-2.5 border-none bg-transparent text-[15px] font-semibold text-ink dark:text-white cursor-pointer text-left hover:text-teal transition-colors font-[inherit] flex items-center gap-1.5">
                <span className="flex-shrink-0">{showPasses ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                Passed rules ({passes.length})
              </button>
              {showPasses && (
                <ul className="list-none mt-3 m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5">
                  {passes.map((rule) => (
                    <li key={rule.id || JSON.stringify(rule)}
                      className="flex justify-between px-2.5 py-1.5 bg-ivory dark:bg-night/50 rounded-lg text-[13px]">
                      <span className="font-mono text-ink dark:text-white">{rule.id}</span>
                      <span className="text-gray-400 dark:text-gray-500">{rule.nodes?.length ?? 0} nodes</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* Screenshot modal */}
        {modalContent && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6"
            role="dialog" aria-modal="true" aria-label={modalContent.title}
            onClick={() => setScreenshotModal(null)}>
            <div className="absolute inset-0 bg-slate-900/60" />
            <div className="relative bg-white dark:bg-charcoal rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
                <h3 className="m-0 text-base font-semibold text-ink dark:text-white">{modalContent.title}</h3>
                <button type="button" onClick={() => setScreenshotModal(null)} aria-label="Close"
                  className="w-9 h-9 p-0 border-none bg-transparent text-2xl leading-none text-body dark:text-gray-400 cursor-pointer rounded-lg hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-ink dark:hover:text-white transition-colors">
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-auto px-4 pb-4 pt-3 flex justify-center items-start min-h-0">
                <img src={modalContent.src} alt={modalContent.title}
                  className="w-full h-auto max-w-full block rounded-lg object-contain" />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
