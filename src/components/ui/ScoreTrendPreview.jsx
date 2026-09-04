const DATA = [
  { sprint: 'S1', score: 64 },
  { sprint: 'S2', score: 71 },
  { sprint: 'S3', score: 76 },
  { sprint: 'S4', score: 82 },
  { sprint: 'S5', score: 88 },
  { sprint: 'S6', score: 92 },
];

const W = 280, H = 110;
const PAD = { t: 12, r: 12, b: 26, l: 24 };
const CW = W - PAD.l - PAD.r;
const CH = H - PAD.t - PAD.b;
const MIN = 55, RANGE = 45;

function toX(i) { return PAD.l + (i / (DATA.length - 1)) * CW; }
function toY(s) { return PAD.t + (1 - (s - MIN) / RANGE) * CH; }

const PTS = DATA.map((d, i) => ({ x: toX(i), y: toY(d.score), ...d }));
const POLY = PTS.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const LAST = PTS[PTS.length - 1];
const AREA = [
  `M${PTS[0].x.toFixed(1)},${PTS[0].y.toFixed(1)}`,
  ...PTS.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
  `L${LAST.x.toFixed(1)},${(PAD.t + CH).toFixed(1)}`,
  `L${PTS[0].x.toFixed(1)},${(PAD.t + CH).toFixed(1)}`,
  'Z',
].join(' ');

const GUIDES = [60, 70, 80, 90];

export default function ScoreTrendPreview() {
  return (
    <div className="w-full max-w-[340px] bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/10 shadow-soft p-5 select-none">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-body dark:text-gray-500 mb-1">
            Accessibility Score
          </p>
          <div className="flex items-end gap-2">
            <span className="font-heading font-bold text-3xl text-teal leading-none">92</span>
            <span className="text-sm font-semibold text-sage-700 dark:text-sage-300 mb-0.5">↑ +28 pts</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-body dark:text-gray-500">Trend</p>
          <p className="text-xs font-semibold text-sage-700 dark:text-sage-300">Improving</p>
        </div>
      </div>

      {/* Chart */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
        {/* Guide lines */}
        {GUIDES.map((v) => {
          const y = toY(v);
          return (
            <g key={v}>
              <line
                x1={PAD.l} y1={y.toFixed(1)}
                x2={W - PAD.r} y2={y.toFixed(1)}
                stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3"
              />
              <text x={PAD.l - 4} y={(y + 3.5).toFixed(1)} fontSize="8" fill="#9ca3af" textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}

        {/* Area */}
        <path d={AREA} fill="rgba(15,118,110,0.08)" />

        {/* Line */}
        <polyline
          points={POLY}
          fill="none"
          stroke="#0F766E"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dots + sprint labels */}
        {PTS.map((p, i) => (
          <g key={p.sprint}>
            <circle
              cx={p.x.toFixed(1)}
              cy={p.y.toFixed(1)}
              r="3.5"
              fill={i === PTS.length - 1 ? '#0F766E' : 'white'}
              stroke="#0F766E"
              strokeWidth="2"
            />
            <text
              x={p.x.toFixed(1)}
              y={(H - 6).toFixed(1)}
              fontSize="8"
              fill="#9ca3af"
              textAnchor="middle"
            >
              {p.sprint}
            </text>
          </g>
        ))}

        {/* Score tooltip on last point */}
        <rect
          x={(LAST.x - 14).toFixed(1)}
          y={(LAST.y - 20).toFixed(1)}
          width="28" height="14" rx="4"
          fill="#0F766E"
        />
        <text
          x={LAST.x.toFixed(1)}
          y={(LAST.y - 9).toFixed(1)}
          fontSize="8" fill="white" textAnchor="middle" fontWeight="bold"
        >
          92
        </text>
      </svg>

      <p className="text-[10px] text-center text-body dark:text-gray-500 mt-2">
        Site-wide score across 6 development sprints
      </p>
    </div>
  );
}
