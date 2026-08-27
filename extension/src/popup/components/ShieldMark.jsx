import React from 'react'

/**
 * Inline SVG shield — identical to BrandLogo.jsx ShieldMark in the web app.
 * Kept here so the extension has zero dependency on the main app's components.
 * If the shield SVG changes in BrandLogo.jsx, update this file too.
 */
export default function ShieldMark({ size = 40 }) {
  const h = Math.round(size * 46 / 40)
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 40 46"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* Shield body */}
      <path
        d="M20 2L37 9V28C37 36.5 20 44 20 44C20 44 3 36.5 3 28V9L20 2Z"
        fill="#0F766E"
      />
      {/* Head */}
      <circle cx="20" cy="13.5" r="3" fill="white" />
      {/* Torso */}
      <line x1="20" y1="17" x2="20" y2="26" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      {/* Arms raised */}
      <path
        d="M12 21L20 18L28 21"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Legs */}
      <path
        d="M20 26L16.5 33M20 26L23.5 33"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Checkmark */}
      <path
        d="M14 36.5L18 40L26.5 33.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
