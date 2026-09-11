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
          ?'border-teal bg-teal/5'
          :'border-gray-200 bg-white hover:border-teal/40 hover:',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon
          size={15}
          className={selected ?'text-teal':'text-body'}
        />
        <span
          className={`font-heading font-semibold text-sm leading-none ${
            selected ?'text-teal':'text-ink'
          }`}
        >
          {mod.label}
        </span>
      </div>
      <p className="text-xs text-body leading-relaxed">
        {mod.description}
      </p>
    </button>
  );
}

function PlannedCard({ mod }) {
  const Icon = mod.icon;
  return (
    <div className="relative border border-dashed border-gray-200 rounded-xl p-3 bg-gray-50/50">
      <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
        Soon
      </span>
      <div className="flex items-center gap-1.5 mb-1 pr-10">
        <Icon size={12} className="text-gray-300 shrink-0"/>
        <span className="text-xs font-medium text-gray-400 truncate">
          {mod.label}
        </span>
      </div>
      <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2">
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
        <p className="text-[10px] font-semibold uppercase tracking-widest text-body mb-2.5">
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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-body">
              Coming Soon
            </p>
            <Clock size={11} className="text-body"/>
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
