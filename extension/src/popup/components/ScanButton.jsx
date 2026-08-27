import React from 'react'
import { ScanLine } from 'lucide-react'

/**
 * Primary CTA — triggers a new scan of the current tab.
 * Disabled while a scan is already in progress (parent passes disabled=true).
 */
export default function ScanButton({ onClick, disabled = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 fade-in">
      <p className="text-xs text-body dark:text-gray-400 mb-4 text-center">
        Run an accessibility scan on the current page
      </p>
      <button
        onClick={onClick}
        disabled={disabled}
        className="btn-primary px-8 py-3 text-sm gap-2 shadow-glow"
      >
        <ScanLine className="w-4 h-4" />
        Scan this page
      </button>
    </div>
  )
}
