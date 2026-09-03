import ScoreGauge from './ScoreGauge';

const severityRows = [
  { label: 'Critical', count: 4,  max: 48, barColor: 'bg-coral',      textColor: 'text-coral-700 dark:text-coral-300',           bgColor: 'bg-coral/15' },
  { label: 'Serious',  count: 8,  max: 48, barColor: 'bg-terracotta', textColor: 'text-terracotta-700 dark:text-terracotta-300', bgColor: 'bg-terracotta/15' },
  { label: 'Moderate', count: 14, max: 48, barColor: 'bg-amber',      textColor: 'text-amber-800 dark:text-amber-300',           bgColor: 'bg-amber/15' },
  { label: 'Minor',    count: 22, max: 48, barColor: 'bg-sage',       textColor: 'text-sage-700 dark:text-sage-300',             bgColor: 'bg-sage/15' },
];

export default function HeroMockup() {
  return (
    <div className="card p-8 w-full max-w-lg shadow-glow border border-teal/20 rounded-3xl bg-white dark:bg-charcoal">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-medium text-body dark:text-gray-500 mb-0.5">ada.dev scan</p>
          <h3 className="text-lg font-semibold text-ink dark:text-white">Accessibility score</h3>
        </div>
        <div className="flex items-center gap-2 bg-sage/10 px-3 py-1.5 rounded-full">
          <span className="w-2.5 h-2.5 rounded-full bg-sage animate-pulse" />
          <span className="text-sm font-semibold text-sage-700 dark:text-sage-300">Passed</span>
        </div>
      </div>

      {/* Score gauge centered */}
      <div className="flex justify-center mb-8">
        <ScoreGauge score={92} size={160} />
      </div>

      {/* Severity breakdown rows */}
      <div className="flex flex-col gap-4 mb-8">
        {severityRows.map(({ label, count, max, barColor, textColor, bgColor }) => {
          const pct = Math.round((count / max) * 100);
          return (
            <div key={label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
                <span className={`text-sm font-bold px-2 py-0.5 rounded-md ${bgColor} ${textColor}`}>
                  {count}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-5 border-t border-gray-100 dark:border-gray-700">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pages Scanned: <span className="font-bold text-body dark:text-gray-300">45</span>
        </p>
        <span className="text-sm font-semibold text-sage-700 dark:text-sage-300">12 fixes generated</span>
      </div>
    </div>
  );
}
