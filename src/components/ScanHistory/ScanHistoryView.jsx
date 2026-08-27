import { apiFetch } from '../../utils/api';
import React, { useState, useEffect, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, Keyboard, Eye, RotateCcw, AlignLeft } from 'lucide-react'
import { formatDateTime } from '../../utils/format'
import GlowInput from '../ui/GlowInput'
import { useApp } from '../../context/AppContext'
import { CrawlHistoryContent } from './CrawlHistoryContent'

const PAGE_SIZE = 50

// ─── Shared badge components ─────────────────────────────────────────────────

function PassRateBadge({ value }) {
  if (value == null) return '—'
  const cls =
    value >= 90
      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      : value >= 70
        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {value}%
    </span>
  )
}

function ViolationsBadge({ value }) {
  if (value == null) return '—'
  const cls =
    value === 0
      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      : value <= 5
        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {value}
    </span>
  )
}

function SourceBadge({ usedFallback }) {
  return usedFallback ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
      Fallback
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal/10 dark:bg-teal/20 text-teal">
      Live run
    </span>
  )
}

function ResultBadge({ passed }) {
  return passed ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
      Passed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
      Failed
    </span>
  )
}

function ScanTypeBadge({ scanType }) {
  if (scanType === 'keyboard') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400">
        <Keyboard size={11} />
        Keyboard
      </span>
    )
  }
  if (scanType === 'page-structure') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sage/10 text-sage">
        <AlignLeft size={11} />
        Page Structure
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
      <Eye size={11} />
      Contrast
    </span>
  )
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function Paginator({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-body dark:text-gray-400">
      <span>Page {currentPage} of {totalPages}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white text-xs font-medium hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Prev
        </button>
        <span className="px-1 tabular-nums">{currentPage} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white text-xs font-medium hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── ADA Scans tab ────────────────────────────────────────────────────────────

const ADA_SORT_OPTIONS = [
  { value: 'newest',          label: 'Newest First' },
  { value: 'oldest',          label: 'Oldest First' },
  { value: 'violations-desc', label: 'Highest Violations' },
  { value: 'violations-asc',  label: 'Lowest Violations' },
  { value: 'pass-rate-desc',  label: 'Highest Pass Rate' },
  { value: 'pass-rate-asc',   label: 'Lowest Pass Rate' },
]

function AdaScansTab({ onScanClick }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [historyMessage, setHistoryMessage] = useState('')
  const [historyAvailable, setHistoryAvailable] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [currentPage, setCurrentPage] = useState(1)

  const handleScanIdClick = (item) => {
    if (!onScanClick || !item?.id) return
    const numId = item.id.replace(/^SCAN-/, '')
    const id = parseInt(numId, 10)
    if (!Number.isNaN(id)) onScanClick(id)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch('/api/history')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && Array.isArray(data.items)) {
          setItems(data.items)
          setHistoryAvailable(data.available !== false)
          setHistoryMessage(data.message || '')
        } else {
          setError(data.error || 'Failed to load history')
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Network error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { setCurrentPage(1) }, [searchQuery, sortKey])

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? items.filter(item =>
          (item.url || '').toLowerCase().includes(q) ||
          (item.id || '').toLowerCase().includes(q) ||
          (item.usedFallback ? 'fallback' : 'live run').includes(q)
        )
      : items
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'oldest':          return new Date(a.timestamp) - new Date(b.timestamp)
        case 'violations-desc': return (b.violations ?? 0) - (a.violations ?? 0)
        case 'violations-asc':  return (a.violations ?? 0) - (b.violations ?? 0)
        case 'pass-rate-desc':  return (b.passRate ?? 0) - (a.passRate ?? 0)
        case 'pass-rate-asc':   return (a.passRate ?? 0) - (b.passRate ?? 0)
        default:                return new Date(b.timestamp) - new Date(a.timestamp)
      }
    })
  }, [items, searchQuery, sortKey])

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedItems = filteredAndSorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const showControls = !loading && !error && items.length > 0 && historyAvailable

  return (
    <>
      {!loading && !error && historyMessage && (
        <p className={historyAvailable
          ? 'mt-4 text-[0.95rem] text-body dark:text-gray-400'
          : 'mt-4 text-[0.95rem] text-ink dark:text-white bg-teal/10 dark:bg-teal/[0.15] px-4 py-3 rounded-xl border border-teal'}
          role={historyAvailable ? undefined : 'status'}
        >
          {historyMessage}
        </p>
      )}
      {loading && <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">Loading scan history…</p>}
      {error && (
        <p className="mt-4 text-[0.95rem] text-ink dark:text-white bg-teal/10 dark:bg-teal/[0.15] px-4 py-3 rounded-xl border border-teal" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && historyAvailable && (
        <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">
          No scans yet. Run a URL from the New Scan page and results will appear here.
        </p>
      )}

      {showControls && (
        <div className="flex flex-col sm:flex-row gap-3 mt-4 mb-2">
          <div className="flex-1">
            <GlowInput
              icon={Search}
              type="search"
              placeholder="Search by URL, ID, or source…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="sm:w-52 px-3 py-2 text-sm bg-white dark:bg-charcoal border border-gray-200 dark:border-white/[0.1] rounded-xl text-ink dark:text-white focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal"
          >
            {ADA_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {showControls && filteredAndSorted.length === 0 && (
        <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">
          No results match <strong>&ldquo;{searchQuery}&rdquo;</strong>.
        </p>
      )}

      {showControls && filteredAndSorted.length > 0 && (
        <>
          <div className="mt-3 bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-night border-b border-gray-100 dark:border-white/[0.06]">
                  <tr>
                    {['ID', 'URL', 'Timestamp', 'Pass rate', 'Violations', 'Profile', 'Source'].map(h => (
                      <th key={h} className="py-3 px-3.5 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map(item => (
                    <tr
                      key={item.id}
                      className="border-b border-gray-100 dark:border-white/[0.06] last:border-b-0 even:bg-black/[0.02] dark:even:bg-white/[0.03] hover:bg-teal/[0.05] dark:hover:bg-teal/[0.08] transition-colors"
                    >
                      <td className="py-3 px-3.5 whitespace-nowrap font-mono text-xs text-body dark:text-gray-400">
                        {onScanClick ? (
                          <button
                            type="button"
                            className="bg-transparent border-0 p-0 font-[inherit] text-teal cursor-pointer underline-offset-2 hover:underline"
                            onClick={() => handleScanIdClick(item)}
                          >
                            {item.id}
                          </button>
                        ) : item.id}
                      </td>
                      <td className="py-3 px-3.5 max-w-[200px]">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-teal hover:underline underline-offset-2 break-all">
                            {item.url}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap text-body dark:text-gray-400">
                        {formatDateTime(item.timestamp)}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap"><PassRateBadge value={item.passRate} /></td>
                      <td className="py-3 px-3.5 whitespace-nowrap"><ViolationsBadge value={item.violations} /></td>
                      <td className="py-3 px-3.5 text-body dark:text-gray-400 whitespace-nowrap text-xs">
                        {item.includeBestPractices ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <SourceBadge usedFallback={item.usedFallback} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Paginator currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </>
      )}
    </>
  )
}

// ─── Assistive Tests tab ──────────────────────────────────────────────────────

const ASSISTIVE_SORT_OPTIONS = [
  { value: 'newest',  label: 'Newest First' },
  { value: 'oldest',  label: 'Oldest First' },
  { value: 'passed',  label: 'Passed First' },
  { value: 'failed',  label: 'Failed First' },
]

const TYPE_FILTER_OPTIONS = [
  { value: '',               label: 'All Types' },
  { value: 'keyboard',       label: 'Keyboard' },
  { value: 'contrast',       label: 'Color Contrast' },
  { value: 'page-structure', label: 'Page Structure' },
]

function AssistiveTestsTab() {
  const { navigate, setPendingAssistiveUrl, setPendingAssistiveModule } = useApp()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [available, setAvailable] = useState(true)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [currentPage, setCurrentPage] = useState(1)

  const SCAN_TYPE_TO_MODULE = {
    keyboard: 'keyboard',
    contrast: 'color-contrast',
    'page-structure': 'page-structure',
  }

  function handleRetest(item) {
    const moduleId = SCAN_TYPE_TO_MODULE[item.scan_type] ?? 'keyboard'
    setPendingAssistiveUrl(item.url)
    setPendingAssistiveModule(moduleId)
    navigate('assistive-test')
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch('/api/assistive-history')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && Array.isArray(data.items)) {
          setItems(data.items)
          setAvailable(data.available !== false)
          setMessage(data.message || '')
        } else {
          setError(data.error || 'Failed to load assistive scan history')
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Network error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { setCurrentPage(1) }, [searchQuery, typeFilter, sortKey])

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let filtered = typeFilter ? items.filter(i => i.scan_type === typeFilter) : items
    if (q) {
      filtered = filtered.filter(i =>
        (i.url || '').toLowerCase().includes(q) ||
        (i.scan_type || '').toLowerCase().includes(q)
      )
    }
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'oldest': return new Date(a.timestamp) - new Date(b.timestamp)
        case 'passed': return (b.passed ? 1 : 0) - (a.passed ? 1 : 0)
        case 'failed': return (a.passed ? 1 : 0) - (b.passed ? 1 : 0)
        default:       return new Date(b.timestamp) - new Date(a.timestamp)
      }
    })
  }, [items, searchQuery, typeFilter, sortKey])

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedItems = filteredAndSorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const showControls = !loading && !error && items.length > 0 && available

  return (
    <>
      {!loading && !error && message && (
        <p className={available
          ? 'mt-4 text-[0.95rem] text-body dark:text-gray-400'
          : 'mt-4 text-[0.95rem] text-ink dark:text-white bg-teal/10 dark:bg-teal/[0.15] px-4 py-3 rounded-xl border border-teal'}
          role={available ? undefined : 'status'}
        >
          {message}
        </p>
      )}
      {loading && <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">Loading assistive test history…</p>}
      {error && (
        <p className="mt-4 text-[0.95rem] text-ink dark:text-white bg-teal/10 dark:bg-teal/[0.15] px-4 py-3 rounded-xl border border-teal" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && available && (
        <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">
          No assistive tests yet. Run a keyboard or color contrast test from the Assistive Testing page.
        </p>
      )}

      {showControls && (
        <div className="flex flex-col sm:flex-row gap-3 mt-4 mb-2">
          <div className="flex-1">
            <GlowInput
              icon={Search}
              type="search"
              placeholder="Search by URL or type…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="sm:w-44 px-3 py-2 text-sm bg-white dark:bg-charcoal border border-gray-200 dark:border-white/[0.1] rounded-xl text-ink dark:text-white focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal"
          >
            {TYPE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="sm:w-44 px-3 py-2 text-sm bg-white dark:bg-charcoal border border-gray-200 dark:border-white/[0.1] rounded-xl text-ink dark:text-white focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-teal"
          >
            {ASSISTIVE_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {showControls && filteredAndSorted.length === 0 && (
        <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">
          No results match your filters.
        </p>
      )}

      {showControls && filteredAndSorted.length > 0 && (
        <>
          <div className="mt-3 bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-night border-b border-gray-100 dark:border-white/[0.06]">
                  <tr>
                    {['ID', 'URL', 'Type', 'Timestamp', 'Result', ''].map(h => (
                      <th key={h} className="py-3 px-3.5 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map(item => (
                    <tr
                      key={item.id}
                      className="border-b border-gray-100 dark:border-white/[0.06] last:border-b-0 even:bg-black/[0.02] dark:even:bg-white/[0.03] hover:bg-teal/[0.05] dark:hover:bg-teal/[0.08] transition-colors"
                    >
                      <td className="py-3 px-3.5 whitespace-nowrap font-mono text-xs text-body dark:text-gray-400">
                        {item.id}
                      </td>
                      <td className="py-3 px-3.5 max-w-[260px]">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-teal hover:underline underline-offset-2 break-all">
                            {item.url}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <ScanTypeBadge scanType={item.scan_type} />
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap text-body dark:text-gray-400">
                        {formatDateTime(item.timestamp)}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <ResultBadge passed={item.passed} />
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <button
                          onClick={() => handleRetest(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal hover:text-teal/70 transition-colors"
                          title="Re-run this test"
                        >
                          <RotateCcw size={12} />
                          Re-test
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Paginator currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </>
      )}
    </>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'ada',       label: 'ADA Scans' },
  { id: 'assistive', label: 'Assistive Tests' },
  { id: 'crawls',    label: 'Crawls' },
]

export default function ScanHistoryView({ onScanClick }) {
  const { pendingScanHistoryTab, setPendingScanHistoryTab } = useApp()
  const [activeTab, setActiveTab] = useState('ada')

  useEffect(() => {
    if (pendingScanHistoryTab) {
      setActiveTab(pendingScanHistoryTab)
      setPendingScanHistoryTab(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className={activeTab === 'crawls' ? 'max-w-[1100px] mx-auto' : 'max-w-[960px] mx-auto'}>

        <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-2">
          Scan History
        </h1>
        <p className="text-body dark:text-gray-400 text-[0.9375rem] mb-5">
          ADA scans and assistive test runs, saved for regression tracking and audit review.
        </p>

        {/* Tab switcher */}
        <div className="inline-flex bg-gray-100 dark:bg-charcoal/80 rounded-xl p-1 gap-0.5 mb-2 border border-gray-200 dark:border-white/[0.06]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'px-5 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                activeTab === tab.id
                  ? 'bg-white dark:bg-night shadow-sm text-teal font-semibold'
                  : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'ada' && <AdaScansTab onScanClick={onScanClick} />}
        {activeTab === 'assistive' && <AssistiveTestsTab />}
        {activeTab === 'crawls' && <CrawlHistoryContent />}

      </div>
    </main>
  )
}
