import { apiFetch } from '../../utils/api';
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Search, ChevronLeft, ChevronRight, Eye, RotateCcw, FileText, Accessibility, ExternalLink, ArrowRight, CheckCircle2, CalendarRange, ChevronDown } from 'lucide-react'
import { formatDateTime } from '../../utils/format'
import PageHeader from '../ui/PageHeader'
import DataTable from '../ui/DataTable'
import { StatusBadge } from '../ui/StatusBadge'
import { useApp } from '../../context/AppContext'
import { CrawlHistoryContent } from './CrawlHistoryContent'
import { ReportActions } from './ReportActions'

const DEFAULT_PAGE_SIZE = 5
const ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50, 100]

// One shared size/spacing/border so every filter control in the toolbar
// (search, status, date range, sort) reads as the same control, not a mix
// of differently-sized pieces.
const FILTER_CTRL_CLS = 'h-10 px-3 rounded-lg border border-gray-300 bg-white text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 transition-colors'

// Shows just the host ("web.whatsapp.com") instead of the full URL with
// scheme and path — matches the compact "app name" the design calls for,
// full URL is still available via the row's "Open site" action and the
// native title tooltip.
function siteLabel(url) {
  if (!url) return '—'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ─── Shared badge components ─────────────────────────────────────────────────

function PassRateBadge({ value }) {
  if (value == null) return '—'
  const cls =
    value >= 90
      ?'bg-sage/15 text-sage-700'
      : value >= 70
        ?'bg-amber/15 text-amber-700'
        :'bg-coral/15 text-coral-700'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {value}
    </span>
  )
}

function SourceBadge({ usedFallback }) {
  return usedFallback ? (
    <span className="text-[11px] text-amber-700">Fallback</span>
  ) : null
}

// Every saved history record is a finished result — there's no "in progress"
// state in this data (in-progress scans live only in the New Scan tab
// session), so ADA scans are always "Completed"; assistive tests are always
// "Passed" or "Failed". Three real states, not a fabricated status list.
function StatusPill({ status }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sage/15 text-sage-700">
        <CheckCircle2 size={12} /> Completed
      </span>
    )
  }
  return <StatusBadge status={status === 'passed' ? 'Passed' : 'Failed'} />
}

// "Scan type" as shown in Scan History: a page-level ADA audit, or an
// assistive test (keyboard / contrast / page structure) — the two kinds of
// history record this page actually has. Site-wide crawls have their own
// tab below since a crawl groups many pages under one root URL.
function ScanTypeCell({ kind }) {
  const Icon = kind === 'assistive' ? Accessibility : FileText
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-body whitespace-nowrap">
      <Icon size={13} className="flex-shrink-0 text-gray-400" />
      {kind === 'assistive' ? 'Assistive test' : 'Page scan'}
    </span>
  )
}

// ─── Pagination footer ────────────────────────────────────────────────────────

function Paginator({ currentPage, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange, label }) {
  if (totalItems === 0) return null
  const firstShown = (currentPage - 1) * pageSize + 1
  const lastShown = Math.min(currentPage * pageSize, totalItems)
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm text-body">
      <span>Showing {firstShown} to {lastShown} of {totalItems} results</span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            aria-label="Previous page"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-white text-ink hover:bg-ivory disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-teal text-white text-xs font-semibold tabular-nums">
            {currentPage}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            aria-label="Next page"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-white text-ink hover:bg-ivory disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
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

export function NoResultsInRange({ message, hint = 'Try adjusting your search or date range to see more results.' }) {
  return (
    <div className="mt-4 border-2 border-dashed border-gray-200 rounded-2xl px-6 py-10 flex flex-col items-center text-center gap-2">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
        <Search size={16} className="text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-ink m-0">{message}</p>
      <p className="text-xs text-body m-0">{hint}</p>
    </div>
  )
}

// ─── Date range filter ────────────────────────────────────────────────────────
// A single styled control instead of two raw <input type="date"> fields sitting
// in the toolbar — native date inputs can't be restyled consistently across
// browsers, so the summary lives on our own button and the pickers only show
// inside a popover.

function formatRangeLabel(from, to) {
  if (!from && !to) return 'All time'
  const fmt = (iso, withYear) =>
    new Date(iso).toLocaleDateString(undefined, withYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' })
  if (from && to) return `${fmt(from, false)} – ${fmt(to, true)}`
  if (from) return `From ${fmt(from, true)}`
  return `Until ${fmt(to, true)}`
}

function DateRangeFilter({ dateFrom, dateTo, onChangeFrom, onChangeTo, idPrefix }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center gap-2 hover:border-gray-400 ${FILTER_CTRL_CLS}`}
      >
        <CalendarRange size={15} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap">{formatRangeLabel(dateFrom, dateTo)}</span>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1.5 w-64 bg-white rounded-xl border border-gray-100 shadow-soft p-4">
          <div className="space-y-3">
            <div>
              <label htmlFor={`${idPrefix}-from`} className="block text-xs font-medium text-body mb-1">From</label>
              <input
                id={`${idPrefix}-from`}
                type="date"
                value={dateFrom}
                onChange={e => onChangeFrom(e.target.value)}
                className="input-base"
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-to`} className="block text-xs font-medium text-body mb-1">To</label>
              <input
                id={`${idPrefix}-to`}
                type="date"
                value={dateTo}
                onChange={e => onChangeTo(e.target.value)}
                className="input-base"
              />
            </div>
          </div>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { onChangeFrom(''); onChangeTo('') }}
              className="mt-3 text-xs font-semibold text-teal hover:underline"
            >
              Clear dates
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── All Scans tab (ADA page audits + assistive tests, merged) ───────────────
// Figma's Scan History has one flat table with a "Scan type" column (Full
// scan / Page scan / Assistive test) instead of separate tabs per source.
// We don't have "Full scan" (site-wide crawl) records in this shape — a crawl
// groups many pages under one root URL with its own compare/analytics UI, so
// it keeps its own tab below rather than being flattened into this table.

const SORT_OPTIONS = [
  { value: 'newest',          label: 'Newest First' },
  { value: 'oldest',          label: 'Oldest First' },
  { value: 'violations-desc', label: 'Highest Issues' },
  { value: 'violations-asc',  label: 'Lowest Issues' },
  { value: 'pass-rate-desc',  label: 'Highest Score' },
  { value: 'pass-rate-asc',   label: 'Lowest Score' },
]

const STATUS_FILTER_OPTIONS = [
  { value: '',          label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'passed',    label: 'Passed' },
  { value: 'failed',    label: 'Failed' },
]

const SCAN_TYPE_FILTER_OPTIONS = [
  { value: '',          label: 'All types' },
  { value: 'ada',        label: 'Page scan' },
  { value: 'assistive',  label: 'Assistive test' },
]

const SCAN_TYPE_TO_MODULE = {
  keyboard: 'keyboard',
  contrast: 'color-contrast',
  'page-structure': 'page-structure',
  forms: 'forms',
}

function normalizeAdaItem(item) {
  return {
    key: `ada-${item.id}`,
    kind: 'ada',
    url: item.url,
    idLabel: item.id,
    score: item.passRate,
    issues: item.violations,
    status: 'completed',
    timestamp: item.timestamp,
    usedFallback: item.usedFallback,
    raw: item,
  }
}

function normalizeAssistiveItem(item) {
  return {
    key: `assistive-${item.id}`,
    kind: 'assistive',
    url: item.url,
    idLabel: item.id,
    score: null,
    issues: null,
    status: item.passed ? 'passed' : 'failed',
    timestamp: item.timestamp,
    usedFallback: false,
    raw: item,
  }
}

function AllScansTab({ onScanClick }) {
  const { navigate, setPendingAssistiveUrl, setPendingAssistiveModule } = useApp()
  const [adaItems, setAdaItems] = useState([])
  const [assistiveItems, setAssistiveItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [available, setAvailable] = useState(true)
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [scanTypeFilter, setScanTypeFilter] = useState('')
  const [sortKey, setSortKey] = useState('newest')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const handleScanIdClick = (item) => {
    if (!onScanClick || !item.idLabel) return
    const numId = item.idLabel.replace(/^SCAN-/, '')
    const id = parseInt(numId, 10)
    if (!Number.isNaN(id)) onScanClick(id)
  }

  function handleRetest(item) {
    const moduleId = SCAN_TYPE_TO_MODULE[item.raw.scan_type] ?? 'keyboard'
    setPendingAssistiveUrl(item.url)
    setPendingAssistiveModule(moduleId)
    navigate('assistive-test')
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      apiFetch('/api/history').then(res => res.json()),
      apiFetch('/api/assistive-history').then(res => res.json()),
    ])
      .then(([historyData, assistiveData]) => {
        if (cancelled) return
        if (historyData.ok && Array.isArray(historyData.items)) {
          setAdaItems(historyData.items)
          setAvailable(historyData.available !== false)
          setMessage(historyData.message || '')
        } else {
          setError(historyData.error || 'Failed to load history')
        }
        if (assistiveData.ok && Array.isArray(assistiveData.items)) {
          setAssistiveItems(assistiveData.items)
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Network error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { setCurrentPage(1) }, [searchQuery, sortKey, dateFrom, dateTo, statusFilter, scanTypeFilter, pageSize])

  const allItems = useMemo(
    () => [...adaItems.map(normalizeAdaItem), ...assistiveItems.map(normalizeAssistiveItem)],
    [adaItems, assistiveItems]
  )

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let filtered = q
      ? allItems.filter(item =>
          (item.url || '').toLowerCase().includes(q) ||
          (item.idLabel || '').toLowerCase().includes(q)
        )
      : allItems
    if (statusFilter) {
      filtered = filtered.filter(item => item.status === statusFilter)
    }
    if (scanTypeFilter) {
      filtered = filtered.filter(item => item.kind === scanTypeFilter)
    }
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
        case 'violations-desc': return (b.issues ?? 0) - (a.issues ?? 0)
        case 'violations-asc':  return (a.issues ?? 0) - (b.issues ?? 0)
        case 'pass-rate-desc':  return (b.score ?? 0) - (a.score ?? 0)
        case 'pass-rate-asc':   return (a.score ?? 0) - (b.score ?? 0)
        default:                return new Date(b.timestamp) - new Date(a.timestamp)
      }
    })
  }, [allItems, searchQuery, sortKey, dateFrom, dateTo, statusFilter, scanTypeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedItems = filteredAndSorted.slice((safePage - 1) * pageSize, safePage * pageSize)
  const showControls = !loading && !error && allItems.length > 0 && available

  return (
    <>
      {!loading && !error && message && (
        <p className={available
          ?'mt-4 text-[0.95rem] text-body'
          : 'alert-info mt-4'}
          role={available ? undefined : 'status'}
        >
          {message}
        </p>
      )}
      {loading && <p className="mt-4 text-[0.95rem] text-body">Loading scan history…</p>}
      {error && (
        <p className="alert-danger mt-4" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && allItems.length === 0 && available && (
        <p className="mt-4 text-[0.95rem] text-body">
          No scans yet. Run a URL from the New Scan page and results will appear here.
        </p>
      )}

      {showControls && (
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mt-4 mb-2">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className={`flex-1 min-w-[200px] flex items-center gap-2 ${FILTER_CTRL_CLS}`}>
              <Search size={15} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
              <label className="sr-only" htmlFor="history-search">Search scan history by website or ID</label>
              <input
                id="history-search"
                type="search"
                placeholder="Search websites…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full border-0 p-0 bg-transparent text-sm text-ink placeholder-gray-400 focus:outline-none"
              />
            </div>
            <label className="sr-only" htmlFor="history-status-filter">Filter by status</label>
            <select
              id="history-status-filter"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className={`${FILTER_CTRL_CLS} sm:w-36 cursor-pointer`}
            >
              {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <label className="sr-only" htmlFor="history-scan-type-filter">Filter by scan type</label>
            <select
              id="history-scan-type-filter"
              value={scanTypeFilter}
              onChange={e => setScanTypeFilter(e.target.value)}
              className={`${FILTER_CTRL_CLS} sm:w-36 cursor-pointer`}
            >
              {SCAN_TYPE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <DateRangeFilter
              idPrefix="history-date"
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChangeFrom={setDateFrom}
              onChangeTo={setDateTo}
            />
            <label className="sr-only" htmlFor="history-sort">Sort scan history</label>
            <select
              id="history-sort"
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
              className={`${FILTER_CTRL_CLS} sm:w-44 cursor-pointer`}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => navigate('new-scan')}
            className="btn-primary whitespace-nowrap flex-shrink-0"
          >
            Run new audit
            <ArrowRight size={15} />
          </button>
        </div>
      )}

      {showControls && filteredAndSorted.length === 0 && (
        <NoResultsInRange
          message={searchQuery.trim() ? `No scans match "${searchQuery}".` : 'No scans match your filters.'}
          hint="Try adjusting your search, status, scan type, or date range to see more results."
        />
      )}

      {showControls && filteredAndSorted.length > 0 && (
        <>
          <div className="mt-3">
            <DataTable columns={['Website', 'Score', 'Issues', 'Scan type', 'Status', 'Date', 'Actions']} cellBorders>
              {paginatedItems.map(item => {
                const reportId = item.kind === 'ada' ? (item.idLabel || '').replace(/^SCAN-/, '') : item.raw.id
                return (
                    <tr key={item.key}>
                      <td className="max-w-[240px] border-r border-gray-100">
                        <span className="block font-medium text-ink truncate" title={item.url}>{siteLabel(item.url)}</span>
                        <span className="block font-mono text-[11px] text-body">{item.idLabel}</span>
                      </td>
                      <td className="whitespace-nowrap border-r border-gray-100"><PassRateBadge value={item.score} /></td>
                      <td className="whitespace-nowrap text-ink border-r border-gray-100">{item.issues ?? '—'}</td>
                      <td className="whitespace-nowrap border-r border-gray-100"><ScanTypeCell kind={item.kind} /></td>
                      <td className="whitespace-nowrap border-r border-gray-100">
                        <div className="flex flex-col gap-0.5 items-start">
                          <StatusPill status={item.status} />
                          <SourceBadge usedFallback={item.usedFallback} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-body border-r border-gray-100">
                        {formatDateTime(item.timestamp)}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {item.kind === 'ada' && onScanClick && (
                            <button
                              type="button"
                              onClick={() => handleScanIdClick(item)}
                              aria-label={`View scan details for ${item.url || item.idLabel}`}
                              title="View details"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          {item.kind === 'assistive' && (
                            <button
                              type="button"
                              onClick={() => handleRetest(item)}
                              aria-label={`Re-run assistive test for ${item.url || item.idLabel}`}
                              title="Re-test"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${item.url} in a new tab`}
                              title="Open site"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                          {reportId && (
                            <ReportActions kind={item.kind === 'ada' ? 'scan' : 'assistive'} id={reportId} />
                          )}
                        </div>
                      </td>
                    </tr>
                )
              })}
            </DataTable>
          </div>
          <Paginator
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredAndSorted.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            label="scan history"
          />
          {(dateFrom || dateTo) && safePage >= totalPages && (
            <NoResultsInRange
              message="No older scans in this date range."
              hint="Try adjusting the date range to see more results."
            />
          )}
        </>
      )}
    </>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'all',    label: 'All Scans' },
  { id: 'crawls', label: 'Crawls' },
]

export default function ScanHistoryView({ onScanClick }) {
  const { pendingScanHistoryTab, setPendingScanHistoryTab } = useApp()
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    if (pendingScanHistoryTab) {
      setActiveTab(pendingScanHistoryTab)
      setPendingScanHistoryTab(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="flex-1 overflow-auto bg-ivory p-6 min-h-0"role="main">
      <div className={activeTab === 'crawls' ? 'max-w-[1100px] mx-auto' : 'max-w-[1100px] mx-auto'}>

        <PageHeader title="Scan History" description="Review previous audits and track progress over time." className="mb-5" />

        {/* Tab switcher */}
        <div role="tablist"aria-label="Scan history views"className="inline-flex bg-gray-100 rounded-xl p-1 gap-0.5 mb-2 border border-gray-200">
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
          {activeTab === 'all' && <AllScansTab onScanClick={onScanClick} />}
          {activeTab === 'crawls' && <CrawlHistoryContent />}
        </div>

      </div>
    </main>
  )
}
