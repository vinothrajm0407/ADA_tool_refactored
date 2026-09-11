import React from "react";

const getStrokeColor = (score) => {
  if (score >= 80) return "#0F766E";
  if (score >= 60) return "#F59E0B";
  return "#E76F51";
};

export function ScoreGauge({ score = 0, size = 120, label = 'Score', color }) {
  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.min(100, Math.max(0, score));
  const offset = circumference - (clampedScore / 100) * circumference;
  const strokeColor = color || getStrokeColor(clampedScore);
  const center = size / 2;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* Outer track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#E8E4DC"
          strokeWidth={strokeWidth}
          className=""
        />
        {/* Fill arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease",
          }}
        />
      </svg>

      {/* Center label — rotate back to upright */}
      <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0 select-none">
        <span
          className="font-heading font-bold text-2xl leading-none"
          style={{ color: strokeColor }}
        >
          {clampedScore}
        </span>
        <span className="text-xs text-body font-body mt-0.5 leading-none">
          {label}
        </span>
      </div>
    </div>
  );
}

export default ScoreGauge;
