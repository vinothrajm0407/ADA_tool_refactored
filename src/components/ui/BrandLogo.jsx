import { Shield } from 'lucide-react';
import { BRAND } from '../../config/appConfig';

/**
 * Shield with ISA-inspired accessibility figure + checkmark.
 * All paths are inline — no external image files needed.
 * viewBox 0 0 40 46: shield fills the full frame.
 */
function ShieldMark({ size = 40 }) {
  const h = Math.round(size * 46 / 40);
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
        fill="#1a7a6a"
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
  );
}

/**
 * BrandLogo — three variants:
 *   "sidebar"  — teal icon tile + "ADA Tool" wordmark (matches the Figma redesign)
 *   "compact"  — icon only (mobile header)
 *   "landing"  — icon + product name (landing page header)
 */
export default function BrandLogo({ variant = 'sidebar' }) {
  if (variant === 'compact') {
    return <ShieldMark size={30} />;
  }

  if (variant === 'sidebar') {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-teal rounded-md flex items-center justify-center shrink-0">
          <Shield size={16} className="text-white" strokeWidth={2} />
        </div>
        <span className="font-heading font-bold text-ink text-[15px]">{BRAND.productName} Tool</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <ShieldMark size={34} />
      <div>
        <span className="block font-heading font-bold text-ink text-xl tracking-tight leading-none">
          {BRAND.productName}
        </span>
        <span className="block text-[11px] font-medium text-body tracking-wide mt-0.5">
          {BRAND.companyName}
        </span>
      </div>
    </div>
  );
}
