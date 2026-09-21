import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Download, Mail, Loader2, Check } from 'lucide-react'
import { apiFetch } from '../../utils/api'
import { useApp } from '../../context/AppContext'

const POPOVER_WIDTH = 256 // w-64

// Download/email actions for the "full technical audit report" (every
// violation node's selector/HTML for a scan, every check for an assistive
// test, every page for a crawl) — the detailed log a technical architect
// needs, as opposed to the score-only Executive Summary PDF.

async function downloadReport(kind, id) {
  const res = await apiFetch(`/api/report/${kind}/${id}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to generate report')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-report-${kind}-${id}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function ReportActions({ kind, id }) {
  const { user } = useApp()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [mailOpen, setMailOpen] = useState(false)
  const [email, setEmail] = useState(user?.email || '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')
  const [popoverPos, setPopoverPos] = useState(null)
  const rootRef = useRef(null)
  const mailBtnRef = useRef(null)

  useEffect(() => {
    if (!mailOpen) return
    function handleClickOutside(e) {
      if (rootRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-report-actions-popover]')) return
      setMailOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mailOpen])

  function openMail(e) {
    e.stopPropagation()
    const rect = mailBtnRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 12)
      setPopoverPos({ top: rect.bottom + 6, left: Math.max(12, left) })
    }
    setMailOpen(o => !o)
  }

  async function handleDownload(e) {
    e.stopPropagation()
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadReport(kind, id)
    } catch (err) {
      setDownloadError(err.message || 'Download failed')
    }
    setDownloading(false)
  }

  async function handleSend(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!email.trim() || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await apiFetch(`/api/report/${kind}/${id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to send')
      setSent(true)
      setTimeout(() => { setMailOpen(false); setSent(false) }, 1200)
    } catch (err) {
      setSendError(err.message || 'Failed to send')
    }
    setSending(false)
  }

  return (
    <div className="relative inline-flex items-center gap-1" ref={rootRef} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download full audit report"
        title={downloadError || 'Download full audit report (PDF)'}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
      >
        {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      </button>
      <button
        ref={mailBtnRef}
        type="button"
        onClick={openMail}
        aria-label="Email full audit report"
        title="Email full audit report (PDF)"
        aria-haspopup="true"
        aria-expanded={mailOpen}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-body hover:text-teal hover:bg-teal/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
      >
        <Mail size={14} />
      </button>

      {mailOpen && popoverPos && createPortal(
        <div
          data-report-actions-popover
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
          className="z-50 bg-white rounded-xl border border-gray-100 shadow-soft p-4 text-left"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-xs font-semibold text-ink mb-2">Email full audit report</p>
          <form onSubmit={handleSend} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="input-base text-sm"
            />
            <button type="submit" disabled={sending} className="btn-primary w-full text-xs py-1.5 justify-center disabled:opacity-60">
              {sent ? <><Check size={13} /> Sent</> : sending ? 'Sending…' : 'Send report'}
            </button>
            {sendError && <p className="text-[11px] text-coral">{sendError}</p>}
          </form>
        </div>,
        document.body
      )}
    </div>
  )
}
