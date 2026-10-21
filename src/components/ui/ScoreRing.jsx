// White-on-dark circular score gauge, for use on the teal gradient report/dashboard heroes.
export default function ScoreRing({ value, className = 'w-32 h-32' }) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={`relative flex-shrink-0 ${className}`} role="img" aria-label={value == null ? 'No score yet' : `Score ${value} out of 100`}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset .8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="font-heading text-4xl font-bold leading-none">{value ?? '—'}</span>
        <span className="text-[11px] text-white/70 mt-1">out of 100</span>
      </div>
    </div>
  );
}
