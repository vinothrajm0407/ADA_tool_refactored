import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X, ChevronRight, ChevronDown, BookOpen, Code2, Wrench, ExternalLink } from 'lucide-react'
import { WCAG_CRITERIA, WCAG_PRINCIPLES, getWcagCriterion } from '../data/wcag'
import { useApp } from '../context/AppContext'

// ─── Level badge ─────────────────────────────────────────────────────────────

function LevelBadge({ level }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
      level === 'A'
        ? 'bg-teal/10 text-teal border-teal/20'
        : 'bg-amber/10 text-amber border-amber/20'
    }`}>
      {level === 'A' ? 'Level A' : 'Level AA'}
    </span>
  )
}

// ─── Principle badge ──────────────────────────────────────────────────────────

const PRINCIPLE_COLORS = {
  Perceivable:    'bg-brand-blue/10 text-brand-blue border-brand-blue/20',
  Operable:       'bg-teal/10 text-teal border-teal/20',
  Understandable: 'bg-sage/10 text-sage border-sage/20',
  Robust:         'bg-terracotta/10 text-terracotta border-terracotta/20',
}

function PrincipleBadge({ principle }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PRINCIPLE_COLORS[principle] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
      {principle}
    </span>
  )
}

// ─── Axe rule chip ────────────────────────────────────────────────────────────

function AxeChip({ rule }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono bg-gray-100 dark:bg-white/[0.06] text-body dark:text-gray-400 border border-gray-200 dark:border-white/[0.06]">
      {rule}
    </span>
  )
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ label, code, variant }) {
  return (
    <div className={`rounded-xl border overflow-hidden ${
      variant === 'bad'
        ? 'border-coral/20 bg-coral/5'
        : 'border-sage/20 bg-sage/5'
    }`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b text-[10px] font-semibold uppercase tracking-wide ${
        variant === 'bad'
          ? 'border-coral/20 text-coral bg-coral/10'
          : 'border-sage/20 text-sage bg-sage/10'
      }`}>
        <span>{variant === 'bad' ? '✗ Fails' : '✓ Passes'}</span>
        {label && <span className="text-inherit opacity-60">— {label}</span>}
      </div>
      <pre className="px-4 py-3 text-[11px] font-mono text-ink dark:text-gray-200 overflow-x-auto leading-relaxed whitespace-pre-wrap">
        {code.trim()}
      </pre>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function CriterionDetail({ criterion, onClose }) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="font-mono text-sm font-bold text-teal">{criterion.id}</span>
            <LevelBadge level={criterion.level} />
            <PrincipleBadge principle={criterion.principle} />
          </div>
          <h2 className="text-lg font-heading font-bold text-ink dark:text-white leading-snug">
            {criterion.title}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-body hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors flex-shrink-0"
          aria-label="Close detail panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Issue */}
        <section>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-body dark:text-gray-500 mb-2">
            <BookOpen size={12} />
            The Issue
          </h3>
          <p className="text-sm text-ink dark:text-gray-200 leading-relaxed">
            {criterion.issue}
          </p>
        </section>

        {/* How to Fix */}
        <section>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-body dark:text-gray-500 mb-3">
            <Wrench size={12} />
            How to Fix
          </h3>
          <ul className="space-y-2">
            {criterion.howToFix.map((tip, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink dark:text-gray-200 leading-relaxed">
                <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-teal/10 text-teal text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                {tip}
              </li>
            ))}
          </ul>
        </section>

        {/* Code Examples */}
        {criterion.codeExamples && (
          <section>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-body dark:text-gray-500 mb-3">
              <Code2 size={12} />
              Code Example
            </h3>
            <div className="space-y-3">
              <CodeBlock variant="bad" code={criterion.codeExamples.bad} />
              <CodeBlock variant="good" code={criterion.codeExamples.good} />
            </div>
          </section>
        )}

        {/* Axe Rules */}
        {criterion.axeRules.length > 0 && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-body dark:text-gray-500 mb-2">
              Triggered by axe-core rules
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {criterion.axeRules.map(rule => (
                <AxeChip key={rule} rule={rule} />
              ))}
            </div>
          </section>
        )}

        {/* W3C link */}
        <section className="pt-2 border-t border-gray-100 dark:border-white/[0.06]">
          <a
            href={`https://www.w3.org/WAI/WCAG22/Understanding/${criterion.id.replace(/\./g, '')}.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-body dark:text-gray-400 hover:text-teal transition-colors"
          >
            <ExternalLink size={11} />
            WCAG 2.2 official guidance
          </a>
        </section>

      </div>
    </div>
  )
}

// ─── Criterion card ───────────────────────────────────────────────────────────

function CriterionCard({ criterion, isSelected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-4 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/50 ${
        isSelected
          ? 'border-teal bg-teal/5 dark:bg-teal/10 shadow-glow'
          : 'border-gray-100 dark:border-white/[0.06] bg-white dark:bg-charcoal hover:border-teal/30 hover:shadow-soft'
      }`}
      aria-pressed={isSelected}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-mono text-sm font-bold text-teal">{criterion.id}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <LevelBadge level={criterion.level} />
        </div>
      </div>

      <p className="font-heading font-semibold text-[13px] text-ink dark:text-white leading-snug mb-1.5">
        {criterion.title}
      </p>

      <p className="text-[11px] text-body dark:text-gray-400 leading-snug line-clamp-2 mb-3">
        {criterion.issue}
      </p>

      {criterion.axeRules.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {criterion.axeRules.slice(0, 3).map(rule => (
            <AxeChip key={rule} rule={rule} />
          ))}
          {criterion.axeRules.length > 3 && (
            <span className="text-[10px] text-body dark:text-gray-500 px-1.5 py-0.5">
              +{criterion.axeRules.length - 3} more
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WcagReferencePage() {
  const { wcagCriterionId, setWcagCriterionId } = useApp()

  const [search, setSearch]         = useState('')
  const [filterLevel, setFilterLevel]         = useState('All')
  const [filterPrinciple, setFilterPrinciple] = useState('All')
  const [selectedId, setSelectedId] = useState(wcagCriterionId ?? null)

  // Sync incoming deep-link from ADAResultsView
  useEffect(() => {
    if (wcagCriterionId) setSelectedId(wcagCriterionId)
  }, [wcagCriterionId])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return WCAG_CRITERIA.filter(c => {
      if (filterLevel !== 'All' && c.level !== filterLevel) return false
      if (filterPrinciple !== 'All' && c.principle !== filterPrinciple) return false
      if (q) {
        return (
          c.id.includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.issue.toLowerCase().includes(q) ||
          c.axeRules.some(r => r.includes(q))
        )
      }
      return true
    })
  }, [search, filterLevel, filterPrinciple])

  const selectedCriterion = selectedId ? getWcagCriterion(selectedId) : null

  function handleSelect(id) {
    const next = selectedId === id ? null : id
    setSelectedId(next)
    setWcagCriterionId(next)
  }

  function handleClose() {
    setSelectedId(null)
    setWcagCriterionId(null)
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: list ── */}
      <div className={`flex flex-col ${selectedCriterion ? 'hidden lg:flex lg:w-[420px]' : 'flex-1'} flex-shrink-0 border-r border-gray-100 dark:border-white/[0.06] overflow-hidden`}>

        {/* Page header */}
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-heading font-bold text-2xl text-ink dark:text-white">
              WCAG Reference
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-teal/10 text-teal text-xs font-semibold">
              {WCAG_CRITERIA.length} criteria
            </span>
          </div>
          <p className="text-sm text-body dark:text-gray-400">
            Developer-focused guidance on the most common WCAG 2.2 violations.
          </p>
        </div>

        {/* Search + filters */}
        <div className="px-6 pb-4 space-y-3 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search criteria, rules, or keywords…"
              className="input-base pl-9 text-sm"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Level filter */}
            <div className="flex rounded-xl border border-gray-200 dark:border-white/[0.1] overflow-hidden">
              {['All', 'A', 'AA'].map(opt => (
                <button
                  key={opt}
                  onClick={() => setFilterLevel(opt)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filterLevel === opt
                      ? 'bg-teal text-white'
                      : 'text-body dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  {opt === 'All' ? 'All Levels' : `Level ${opt}`}
                </button>
              ))}
            </div>

            {/* Principle filter */}
            <div className="flex rounded-xl border border-gray-200 dark:border-white/[0.1] overflow-hidden">
              <button
                onClick={() => setFilterPrinciple('All')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filterPrinciple === 'All'
                    ? 'bg-teal text-white'
                    : 'text-body dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                All
              </button>
              {WCAG_PRINCIPLES.map(p => (
                <button
                  key={p}
                  onClick={() => setFilterPrinciple(p)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filterPrinciple === p
                      ? 'bg-teal text-white'
                      : 'text-body dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Active filter count */}
          {(search || filterLevel !== 'All' || filterPrinciple !== 'All') && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-body dark:text-gray-400">
                Showing {filtered.length} of {WCAG_CRITERIA.length} criteria
              </p>
              <button
                onClick={() => { setSearch(''); setFilterLevel('All'); setFilterPrinciple('All') }}
                className="text-xs text-teal hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-body dark:text-gray-400 text-sm">No criteria match your filters.</p>
              <button
                onClick={() => { setSearch(''); setFilterLevel('All'); setFilterPrinciple('All') }}
                className="mt-2 text-sm text-teal hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filtered.map(c => (
                <CriterionCard
                  key={c.id}
                  criterion={c}
                  isSelected={selectedId === c.id}
                  onClick={() => handleSelect(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail ── */}
      {selectedCriterion ? (
        <div className="flex-1 min-w-0 overflow-hidden">
          <CriterionDetail criterion={selectedCriterion} onClose={handleClose} />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-center px-8">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen size={22} className="text-teal" />
            </div>
            <p className="font-heading font-semibold text-ink dark:text-white mb-1">
              Select a criterion
            </p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs">
              Click any card to see the issue, how to fix it, and code examples.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
