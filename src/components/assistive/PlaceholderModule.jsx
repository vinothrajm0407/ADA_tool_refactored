import { Clock } from 'lucide-react';

export default function PlaceholderModule({ module }) {
  const Icon = module?.icon;
  return (
    <div className="card p-12 flex flex-col items-center justify-center gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-white/[0.05] flex items-center justify-center">
        {Icon
          ? <Icon size={24} className="text-gray-300 dark:text-gray-600" />
          : <Clock size={24} className="text-gray-300 dark:text-gray-600" />
        }
      </div>
      <div>
        <p className="font-heading font-bold text-base text-ink dark:text-white mb-1">
          {module?.label ?? 'Module'} — Coming Soon
        </p>
        <p className="text-sm text-body dark:text-gray-500 max-w-sm leading-relaxed">
          {module?.description ?? 'This test module is being developed and will be available in a future update.'}
        </p>
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider bg-teal/10 text-teal px-3 py-1.5 rounded-full border border-teal/20">
        In Development
      </span>
    </div>
  );
}
