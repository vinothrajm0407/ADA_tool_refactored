import { Clock } from 'lucide-react';

function ActiveCard({ mod, selected, onSelect }) {
  const Icon = mod.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(mod.id)}
      className={[
        'text-left border-2 rounded-2xl p-4 transition-all duration-150 w-full',
        selected
          ? 'border-teal bg-teal/5 dark:bg-teal/10 shadow-sm'
          : 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-charcoal hover:border-teal/40 hover:shadow-sm',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon
          size={15}
          className={selected ? 'text-teal' : 'text-body dark:text-gray-400'}
        />
        <span
          className={`font-heading font-semibold text-sm leading-none ${
            selected ? 'text-teal' : 'text-ink dark:text-white'
          }`}
        >
          {mod.label}
        </span>
      </div>
      <p className="text-xs text-body dark:text-gray-500 leading-relaxed">
        {mod.description}
      </p>
    </button>
  );
}

function PlannedCard({ mod }) {
  const Icon = mod.icon;
  return (
    <div className="relative border border-dashed border-gray-200 dark:border-white/[0.06] rounded-xl p-3 bg-gray-50/50 dark:bg-white/[0.02]">
      <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-600 px-1.5 py-0.5 rounded-full">
        Soon
      </span>
      <div className="flex items-center gap-1.5 mb-1 pr-10">
        <Icon size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 truncate">
          {mod.label}
        </span>
      </div>
      <p className="text-[11px] text-gray-300 dark:text-gray-600 leading-relaxed line-clamp-2">
        {mod.description}
      </p>
    </div>
  );
}

export default function ModuleSelector({ modules, activeModuleId, onSelect }) {
  const active = modules.filter((m) => m.status === 'active');
  const planned = modules.filter((m) => m.status === 'planned');

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-500 mb-2.5">
          Available Now
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {active.map((mod) => (
            <ActiveCard
              key={mod.id}
              mod={mod}
              selected={activeModuleId === mod.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      {planned.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-500">
              Coming Soon
            </p>
            <Clock size={11} className="text-body dark:text-gray-500" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {planned.map((mod) => (
              <PlannedCard key={mod.id} mod={mod} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
