import React from 'react';

export function SectionHeading({ eyebrow, title, subtitle, center = false }) {
  return (
    <div className={center ? 'text-center' : ''}>
      {eyebrow && (
        <p className="uppercase tracking-widest text-xs font-semibold text-teal mb-2">
          {eyebrow}
        </p>
      )}
      {title && (
        <h2 className="font-heading font-bold text-2xl md:text-3xl text-ink">
          {title}
        </h2>
      )}
      {subtitle && (
        <p
          className={`mt-3 text-body text-base max-w-2xl${
            center ? ' mx-auto' : ''
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function ChartCard({ title, subtitle, children, action }) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h3 className="text-lg font-heading font-bold text-ink leading-snug">
          {title}
        </h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {subtitle && (
        <p className="text-sm text-body mb-4">{subtitle}</p>
      )}
      <div className="mt-4 w-full min-h-[200px] sm:min-h-[240px] md:min-h-[280px]">
        {children}
      </div>
    </div>
  );
}

export default ChartCard;
