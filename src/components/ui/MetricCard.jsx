import React from 'react';

const colorClasses = {
  teal:'text-teal-800',
  coral:'text-coral-700',
  amber:'text-amber-800',
  sage:'text-sage-700',
  terracotta:'text-terracotta-700',
};

export function MetricCard({ title, value, trend, icon: Icon, color = 'teal', loading = false }) {
  const iconColor = colorClasses[color] || colorClasses.teal;

  if (loading) {
    return (
      <div className="card p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-gray-200 animate-pulse flex-shrink-0"/>
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 bg-gray-200 rounded animate-pulse w-2/3"/>
          <div className="h-6 bg-gray-200 rounded animate-pulse w-1/2"/>
          <div className="h-3 bg-gray-200 rounded animate-pulse w-1/3"/>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-ivory flex items-center justify-center flex-shrink-0">
        {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-body">{title}</p>
        <p className="text-2xl font-bold font-heading text-ink mt-0.5">{value}</p>
        {trend && (
          <p className="text-xs text-sage-700 mt-0.5">{trend}</p>
        )}
      </div>
    </div>
  );
}

export default MetricCard;
