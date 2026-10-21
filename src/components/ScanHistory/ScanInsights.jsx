import React, { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// Trends + breakdown for the scans already loaded by Scan History (so it follows
// the page's filters). Per-scan impact / WCAG-level / needs-review counts come
// from ScanHistory.Breakdown, which only exists for scans saved after it was
// added — older scans still chart score and issue count, just without a breakdown.

const ASSISTIVE_LABELS = {
  keyboard: 'Keyboard navigation',
  contrast: 'Color contrast',
  'page-structure': 'Page structure',
  forms: 'Forms accessibility',
}

const LEVELS = [
  { key: 'a', label: 'Level A', cls: 'bg-teal' },
  { key: 'aa', label: 'Level AA', cls: 'bg-teal/70' },
  { key: 'aaa', label: 'Level AAA', cls: 'bg-teal/40' },
  { key: 'best_practice', label: 'Best practice', cls: 'bg-gray-400' },
]

const IMPACTS = [
  { key: 'critical', label: 'Critical', cls: 'bg-coral' },
  { key: 'serious', label: 'Serious', cls: 'bg-amber' },
  { key: 'moderate', label: 'Moderate', cls: 'bg-amber/60' },
  { key: 'minor', label: 'Minor', cls: 'bg-gray-400' },
]

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url || '' }
}

function Delta({ value, goodWhenDown }) {
  if (value == null) return null
  if (value === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-body"><Minus size={12} aria-hidden="true" />No change</span>
  const good = goodWhenDown ? value < 0 : value > 0
  const Icon = value > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? 'text-sage-700' : 'text-coral-700'}`}>
      <Icon size={12} aria-hidden="true" />
      {value > 0 ? '+' : ''}{value} since previous scan
    </span>
  )
}

function Bars({ title, rows, counts }) {
  const max = Math.max(1, ...rows.map(r => counts[r.key] ?? 0))
  return (
    <div>
      <p className="text-xs font-semibold text-ink mb-2">{title}</p>
      <ul className="space-y-1.5">
        {rows.map(r => {
          const n = counts[r.key] ?? 0
          return (
            <li key={r.key} className="flex items-center gap-2 text-xs">
              <span className="w-24 text-body">{r.label}</span>
              <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                <span className={`block h-full rounded-full ${r.cls}`} style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right font-semibold text-ink">{n}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function ScanInsights({ adaItems, assistiveItems }) {
  const sites = useMemo(() => {
    const seen = []
    for (const it of [...adaItems].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
      const h = host(it.url)
      if (h && !seen.includes(h)) seen.push(h)
    }
    return seen
  }, [adaItems])

  const [picked, setPicked] = useState('')
  const site = sites.includes(picked) ? picked : sites[0]

  // One point per day (that day's last scan), last 30 days with data — a site
  // scanned hundreds of times would otherwise draw an unreadable band.
  const series = useMemo(() => {
    const byDay = new Map()
    for (const it of adaItems.filter(i => host(i.url) === site).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))) {
      const d = new Date(it.timestamp)
      byDay.set(d.toDateString(), {
        id: it.id,
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        score: it.passRate,
        issues: it.violations,
        breakdown: it.breakdown,
      })
    }
    return [...byDay.values()].slice(-30)
  }, [adaItems, site])

  const modules = useMemo(() => {
    const byType = {}
    for (const it of assistiveItems.filter(i => host(i.url) === site)) {
      const m = (byType[it.scan_type] ??= { runs: 0, passed: 0, last: null, lastTs: 0 })
      m.runs += 1
      if (it.passed) m.passed += 1
      const ts = new Date(it.timestamp).getTime()
      if (ts >= m.lastTs) { m.lastTs = ts; m.last = it.passed }
    }
    return Object.entries(byType)
  }, [assistiveItems, site])

  if (!site || series.length === 0) return null

  const latest = series[series.length - 1]
  const prev = series.length > 1 ? series[series.length - 2] : null
  const b = latest.breakdown
  const summary = `${site}: score ${latest.score} and ${latest.issues} issues on the latest of ${series.length} days with scans`

  return (
    <section className="card p-5 mt-4" aria-label="Trends and breakdown">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-heading font-semibold text-sm text-ink">Trends &amp; breakdown</h2>
        {sites.length > 1 && (
          <>
            <label className="sr-only" htmlFor="insights-site">Website</label>
            <select
              id="insights-site"
              value={site}
              onChange={e => setPicked(e.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-ink cursor-pointer"
            >
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-body">Latest score</p>
          <p className="text-2xl font-bold text-ink">{latest.score}</p>
          <Delta value={prev ? latest.score - prev.score : null} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-body">Open issues</p>
          <p className="text-2xl font-bold text-ink">{latest.issues}</p>
          <Delta value={prev ? latest.issues - prev.issues : null} goodWhenDown />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-body">Needs manual review</p>
          <p className="text-2xl font-bold text-ink">{b ? b.review : '—'}</p>
          <p className="text-xs text-body">axe results it couldn&rsquo;t decide on its own</p>
        </div>
      </div>

      {series.length > 1 ? (
        <div role="img" aria-label={`${summary}. Line chart of score and issues over time.`}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#e5e7eb" />
              <YAxis tick={{ fontSize: 10 }} stroke="#e5e7eb" />
              <Tooltip />
              <Line type="monotone" dataKey="score" name="Score" stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="issues" name="Issues" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-body">Run this site again to start a trend line.</p>
      )}

      {b ? (
        <div className="grid sm:grid-cols-2 gap-6 mt-5">
          <Bars title="Open issues by WCAG level (latest scan)" rows={LEVELS} counts={b.level} />
          <Bars title="Open issues by impact (latest scan)" rows={IMPACTS} counts={b.impact} />
        </div>
      ) : (
        <p className="text-xs text-body mt-4">WCAG level and impact breakdown is recorded for scans run after this feature was added — scan this site again to see it.</p>
      )}

      {modules.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-ink mb-2">Assistive Testing by module</p>
          <table className="w-full text-xs">
            <caption className="sr-only">Assistive Testing results per module for {site}</caption>
            <thead>
              <tr className="text-left text-body">
                <th scope="col" className="py-1 font-medium">Module</th>
                <th scope="col" className="py-1 font-medium">Runs</th>
                <th scope="col" className="py-1 font-medium">Pass rate</th>
                <th scope="col" className="py-1 font-medium">Latest</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(([type, m]) => (
                <tr key={type} className="border-t border-gray-100">
                  <td className="py-1.5 text-ink">{ASSISTIVE_LABELS[type] ?? type}</td>
                  <td className="py-1.5">{m.runs}</td>
                  <td className="py-1.5">{Math.round((m.passed / m.runs) * 100)}%</td>
                  <td className={`py-1.5 font-medium ${m.last ? 'text-sage-700' : 'text-coral-700'}`}>{m.last ? 'Passed' : 'Failed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
