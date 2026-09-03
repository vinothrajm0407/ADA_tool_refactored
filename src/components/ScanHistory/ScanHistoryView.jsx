import { apiFetch } from '../../utils/api';
import React, { useState, useEffect, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, Keyboard, Eye, RotateCcw, AlignLeft, Globe, FileText, ExternalLink, ArrowRight, CheckCircle2 } from 'lucide-react'
import { formatDateTime } from '../../utils/format'
import GlowInput from '../ui/GlowInput'
import { useApp } from '../../context/AppContext'
import { CrawlHistoryContent } from './CrawlHistoryContent'

const DEFAULT_PAGE_SIZE = 10
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100]

// ─── Shared badge components ─────────────────────────────────────────────────

function PassRateBadge({ value }) {
  if (value == null) return '—'
  const cls =
    value >= 90
      ? 'bg-sage/15 text-sage-700 dark:text-sage-300'
      : value >= 70
        ? 'bg-amber/15 text-amber-700 dark:text-amber-300'
        : 'bg-coral/15 text-coral-700 dark:text-coral-300'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {value}
    </span>
  )
}

function ViolationsBadge({ value }) {
  if (value == null) return '—'
  const cls =
    value === 0
      ? 'bg-sage/15 text-sage-700 dark:text-sage-300'
      : value <= 5
        ? 'bg-amber/15 text-amber-700 dark:text-amber-300'
        : 'bg-coral/15 text-coral-700 dark:text-coral-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {value}
    </span>
  )
}

function SourceBadge({ usedFallback }) {
  return usedFallback ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber/15 text-amber-700 dark:text-amber-300">
      Fallback
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal/10 text-teal-700 dark:text-teal-300">
      Live run
    </span>
  )
}

// Every saved history record is, by definition, a finished scan — there's no
// "in progress" state in this data (in-progress scans live only in the New
// Scan tab session, not in /api/history), so this is always "Completed"
// rather than a fabricated multi-state field.
function CompletedStatusBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sage/15 text-sage-700 dark:text-sage-300">
      <CheckCircle2 size={12} />
      Completed
    </span>
  )
}

// Reuses the existing includeBestPractices flag (previously shown as plain
// "Profile" text) as the scan-type indicator — no new data invented.
function ScanProfileBadge({ includeBestPractices }) {
  const Icon = includeBestPractices ? Globe : FileText
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-body dark:text-gray-400 whitespace-nowrap">
      <Icon size={13} className="flex-shrink-0 text-gray-400" />
      {includeBestPractices ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}
    </span>
  )
}

function ResultBadge({ passed }) {
  return passed ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sage/15 text-sage-700 dark:text-sage-300">
      Passed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-coral/15 text-coral-700 dark:text-coral-300">
      Failed
    </span>
  )
}

function ScanTypeBadge({ scanType }) {
  if (scanType === 'keyboard') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal/15 text-teal-700 dark:text-teal-300">
        <Keyboard size={11} />
        Keyboard
      </span>
    )
  }
  if (scanType === 'page-structure') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sage/15 text-sage-700 dark:text-sage-300">
        <AlignLeft size={11} />
        Page Structure
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-terracotta/15 text-terracotta-700 dark:text-terracotta-300">
      <Eye size={11} />
      Contrast
    </span>
  )
}

// ─── Pagination footer ────────────────────────────────────────────────────────

function Paginator({ currentPage, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange, label }) {
  if (totalItems === 0) return null
  const firstShown = (currentPage - 1) * pageSize + 1
  const lastShown = Math.min(currentPage * pageSize, totalItems)
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm text-body dark:text-gray-400">
      <span>Showing {firstShown} to {lastShown} of {totalItems} results</span>
      <div className="flex items-center gap-4">
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-teal text-white text-xs font-semibold tabular-nums">
              {currentPage}
            </span>
            <span className="tabular-nums text-xs">of {totalPages}</span>
            <button
              type="button"
              onClick={() => onPageChange(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-charcoal text-ink dark:text-white hover:bg-ivory dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-xs">
            Rows per page:
            <select
              value={pageSize}
              onChange={e => onPageSizeChange(Number(e.target.value))}
              aria-label={`Rows per page for ${label}`}
              className="select-base w-auto py-1.5 pl-2.5 pr-7 text-xs"
            >
              {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

function NoResultsInRange({ message }) {
  return (
    <div className="mt-4 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-2xl px-6 py-10 flex flex-col items-center text-center gap-2">
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center">
        <Search size={16} className="text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-ink dark:text-white m-0">{message}</p>
      <p className="text-xs text-body dark:text-gray-400 m-0">Try adjusting your search or date range to see more results.</p>
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
  const { navigate } = useApp()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [historyMessage, setHistoryMessage] = useState('')
  const [historyAvailable, setHistoryAvailable] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

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

  useEffect(() => { setCurrentPage(1) }, [searchQuery, sortKey, dateFrom, dateTo, pageSize])

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let filtered = q
      ? items.filter(item =>
          (item.url || '').toLowerCase().includes(q) ||
          (item.id || '').toLowerCase().includes(q) ||
          (item.usedFallback ? 'fallback' : 'live run').includes(q)
        )
      : items
    if (dateFrom) {
      const from = new Date(dateFrom)
      filtered = filtered.filter(item => item.timestamp && new Date(item.timestamp) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      filtered = filtered.filter(item => item.timestamp && new Date(item.timestamp) <= to)
    }
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
  }, [items, searchQuery, sortKey, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedItems = filteredAndSorted.slice((safePage - 1) * pageSize, safePage * pageSize)
  const showControls = !loading && !error && items.length > 0 && historyAvailable
  const isFiltering = searchQuery.trim() !== '' || dateFrom !== '' || dateTo !== ''

  return (
    <>
      {!loading && !error && historyMessage && (
        <p className={historyAvailable
          ? 'mt-4 text-[0.95rem] text-body dark:text-gray-400'
          : 'alert-info mt-4'}
          role={historyAvailable ? undefined : 'status'}
        >
          {historyMessage}
        </p>
      )}
      {loading && <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">Loading scan history…</p>}
      {error && (
        <p className="alert-danger mt-4" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && historyAvailable && (
        <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">
          No scans yet. Run a URL from the New Scan page and results will appear here.
        </p>
      )}

      {showControls && (
        <div className="flex flex-col lg:flex-row gap-3 mt-4 mb-2">
          <div className="flex-1 min-w-[200px]">
            <GlowInput
              icon={Search}
              type="search"
              placeholder="Search websites…"
              aria-label="Search scan history by website, ID, or source"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="ada-date-from">From date</label>
            <input
              id="ada-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="select-base w-auto pr-3"
            />
            <span className="text-body dark:text-gray-500 text-sm" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="ada-date-to">To date</label>
            <input
              id="ada-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="select-base w-auto pr-3"
            />
          </div>
          <label className="sr-only" htmlFor="ada-sort">Sort scan history</label>
          <select
            id="ada-sort"
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="select-base lg:w-52"
          >
            {ADA_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => navigate('new-scan')}
            className="btn-primary whitespace-nowrap"
          >
            Run new audit
            <ArrowRight size={15} />
          </button>
        </div>
      )}

      {showControls && filteredAndSorted.length === 0 && (
        <NoResultsInRange message={`No scans match "${searchQuery}"${dateFrom || dateTo ? ' in this date range' : ''}.`} />
      )}

      {showControls && filteredAndSorted.length > 0 && (
        <>
          <div className="mt-3 bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    {['Website', 'Score', 'Issues', 'Scan type', 'Status', 'Date', 'Actions'].map(h => (
                      <th key={h} scope="col" className="whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map(item => (
                    <tr key={item.id}>
                      <td className="max-w-[220px]">
                        <span className="font-medium text-ink dark:text-white break-all">{item.url || '—'}</span>
                        <span className="block font-mono text-[11px] text-body dark:text-gray-500">{item.id}</span>
                      </td>
                      <td className="whitespace-nowrap"><PassRateBadge value={item.passRate} /></td>
                      <td className="whitespace-nowrap"><ViolationsBadge value={item.violations} /></td>
                      <td className="whitespace-nowrap"><ScanProfileBadge includeBestPractices={item.includeBestPractices} /></td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <CompletedStatusBadge />
                          <SourceBadge usedFallback={item.usedFallback} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-body dark:text-gray-400">
                        {formatDateTime(item.timestamp)}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {onScanClick && (
                            <button
                              type="button"
                              onClick={() => handleScanIdClick(item)}
                              aria-label={`View scan details for ${item.url || item.id}`}
                              title="View details"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${item.url} in a new tab`}
                              title="Open site"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Paginator
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredAndSorted.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            label="ADA scan history"
          />
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

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

  useEffect(() => { setCurrentPage(1) }, [searchQuery, typeFilter, sortKey, pageSize])

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

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedItems = filteredAndSorted.slice((safePage - 1) * pageSize, safePage * pageSize)
  const showControls = !loading && !error && items.length > 0 && available

  return (
    <>
      {!loading && !error && message && (
        <p className={available
          ? 'mt-4 text-[0.95rem] text-body dark:text-gray-400'
          : 'alert-info mt-4'}
          role={available ? undefined : 'status'}
        >
          {message}
        </p>
      )}
      {loading && <p className="mt-4 text-[0.95rem] text-body dark:text-gray-400">Loading assistive test history…</p>}
      {error && (
        <p className="alert-danger mt-4" role="alert">
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
              aria-label="Search assistive test history"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <label className="sr-only" htmlFor="assistive-type-filter">Filter by test type</label>
          <select
            id="assistive-type-filter"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="select-base sm:w-44"
          >
            {TYPE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="assistive-sort">Sort assistive test history</label>
          <select
            id="assistive-sort"
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="select-base sm:w-44"
          >
            {ASSISTIVE_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {showControls && filteredAndSorted.length === 0 && (
        <NoResultsInRange message="No results match your filters." />
      )}

      {showControls && filteredAndSorted.length > 0 && (
        <>
          <div className="mt-3 bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    {['ID', 'URL', 'Type', 'Timestamp', 'Result', 'Actions'].map(h => (
                      <th key={h} scope="col" className="whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map(item => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap font-mono text-xs text-body dark:text-gray-400">
                        {item.id}
                      </td>
                      <td className="max-w-[260px]">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-teal hover:underline underline-offset-2 break-all">
                            {item.url}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="whitespace-nowrap">
                        <ScanTypeBadge scanType={item.scan_type} />
                      </td>
                      <td className="whitespace-nowrap text-body dark:text-gray-400">
                        {formatDateTime(item.timestamp)}
                      </td>
                      <td className="whitespace-nowrap">
                        <ResultBadge passed={item.passed} />
                      </td>
                      <td className="whitespace-nowrap">
                        <button
                          onClick={() => handleRetest(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal hover:text-teal-700 dark:hover:text-teal-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 rounded px-1 py-0.5"
                          aria-label={`Re-run ${item.scan_type || 'assistive'} test for ${item.url || item.id}`}
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
          <Paginator
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredAndSorted.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            label="assistive test history"
          />
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
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night page-content min-h-0" role="main">
      <div className="mx-auto max-w-[1100px]">

        <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-2">
          Scan History
        </h1>
        <p className="text-body dark:text-gray-400 text-[0.9375rem] mb-5">
          Review previous audits and track progress over time.
        </p>

        {/* Tab switcher */}
        <div role="tablist" aria-label="Scan history views" className="inline-flex rounded-xl border border-gray-200 bg-white p-1 gap-0.5 mb-4 shadow-sm dark:border-white/[0.06] dark:bg-charcoal/80">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              id={`scan-history-tab-${tab.id}`}
              aria-controls={`scan-history-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id ? 'tab-active' : 'tab'}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`scan-history-panel-${activeTab}`} aria-labelledby={`scan-history-tab-${activeTab}`}>
          {activeTab === 'ada' && <AdaScansTab onScanClick={onScanClick} />}
          {activeTab === 'assistive' && <AssistiveTestsTab />}
          {activeTab === 'crawls' && <CrawlHistoryContent />}
        </div>

      </div>
    </main>
  )
}
