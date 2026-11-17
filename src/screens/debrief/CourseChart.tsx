import React from 'react';
import type { ChartSeries } from './story';
import { formatClinical } from '../../review/formatClinical';
import { formatSimTime } from './story';

export interface CourseChartProps {
  series: ChartSeries[];
  decisionTimes?: number[];
}

const W = 560;
const H = 140;
const PADDING = { top: 22, right: 16, bottom: 24, left: 48 };
const PLOT_W = W - PADDING.left - PADDING.right;
const PLOT_H = H - PADDING.top - PADDING.bottom;

export const CourseChart: React.FC<CourseChartProps> = ({ series, decisionTimes = [] }) => {
  if (!series || series.length === 0) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-2)' }}>
        No course chart data recorded for this run.
      </div>
    );
  }

  // Determine global max sim time across all series and decision points
  const allTimes = [
    ...series.flatMap(s => s.points.map(p => p.t)),
    ...decisionTimes,
  ];
  const maxTime = Math.max(60, ...allTimes);

  return (
    <div className="space-y-4" data-testid="course-chart-container">
      {series.map(s => {
        const vals = s.points.map(p => p.v);
        let minVal = Math.min(...vals);
        let maxVal = Math.max(...vals);

        if (s.band) {
          // Every target line must lie inside the plotted range, whether the values sit above or below it.
          for (const edge of [s.band.lo, s.band.hi]) {
            if (edge !== null && edge !== undefined) {
              minVal = Math.min(minVal, edge);
              maxVal = Math.max(maxVal, edge);
            }
          }
        }

        if (minVal === maxVal) {
          minVal -= 5;
          maxVal += 5;
        }

        const span = maxVal - minVal;
        const padY = Math.max(1, span * 0.12);
        const yMin = minVal - padY;
        const yMax = maxVal + padY;

        const scaleX = (t: number) => PADDING.left + (Math.max(0, Math.min(maxTime, t)) / maxTime) * PLOT_W;
        const scaleY = (v: number) => PADDING.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

        // Path coordinates
        const pathD = s.points
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${scaleX(p.t).toFixed(1)} ${scaleY(p.v).toFixed(1)}`)
          .join(' ');

        // 3 Y-ticks
        const yTicks = [
          yMin + padY,
          (yMin + yMax) / 2,
          yMax - padY,
        ];
        const roundedYLabels = yTicks.map(yVal => formatClinical(s.kind, yVal));
        const hasDuplicateY =
          roundedYLabels[0] === roundedYLabels[1] ||
          roundedYLabels[1] === roundedYLabels[2] ||
          roundedYLabels[0] === roundedYLabels[2];
        const yTickLabels = hasDuplicateY
          ? yTicks.map(yVal => yVal.toFixed(1))
          : roundedYLabels;

        // 3 X-ticks
        const xTicks = [0, maxTime / 2, maxTime];

        return (
          <div key={s.key} className="border p-2.5" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
            <div className="flex items-center justify-between text-xs font-semibold px-1 pb-1">
              <span>{s.label}</span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>{s.unit}</span>
            </div>

            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto block"
              style={{ overflow: 'visible' }}
              aria-label={`${s.label} course chart`}
            >
              {/* Axes lines */}
              <line
                x1={PADDING.left}
                x2={W - PADDING.right}
                y1={H - PADDING.bottom}
                y2={H - PADDING.bottom}
                stroke="var(--line)"
                strokeWidth="1"
              />
              <line
                x1={PADDING.left}
                x2={PADDING.left}
                y1={PADDING.top}
                y2={H - PADDING.bottom}
                stroke="var(--line)"
                strokeWidth="1"
              />

              {/* Band if present */}
              {s.band && (
                <g className="chart-band">
                  {s.band.lo !== null && s.band.lo !== undefined && s.band.hi !== null && s.band.hi !== undefined ? (
                    <>
                      <rect
                        x={PADDING.left}
                        y={scaleY(s.band.hi)}
                        width={PLOT_W}
                        height={Math.max(1, scaleY(s.band.lo) - scaleY(s.band.hi))}
                        fill="var(--surface-3)"
                        fillOpacity="0.4"
                      />
                      <line
                        x1={PADDING.left}
                        x2={W - PADDING.right}
                        y1={scaleY(s.band.hi)}
                        y2={scaleY(s.band.hi)}
                        stroke="var(--text-3)"
                        strokeDasharray="2 2"
                        strokeWidth="1"
                      />
                      <line
                        x1={PADDING.left}
                        x2={W - PADDING.right}
                        y1={scaleY(s.band.lo)}
                        y2={scaleY(s.band.lo)}
                        stroke="var(--text-3)"
                        strokeDasharray="2 2"
                        strokeWidth="1"
                      />
                      <text
                        x={W - PADDING.right - 4}
                        y={scaleY(s.band.hi) + 10}
                        textAnchor="end"
                        fontSize="10"
                        fontFamily="monospace"
                        fill="var(--text-3)"
                      >
                        {s.band.label}
                      </text>
                    </>
                  ) : s.band.hi !== null && s.band.hi !== undefined ? (
                    <>
                      <line
                        x1={PADDING.left}
                        x2={W - PADDING.right}
                        y1={scaleY(s.band.hi)}
                        y2={scaleY(s.band.hi)}
                        stroke="var(--text-3)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={W - PADDING.right - 4}
                        y={scaleY(s.band.hi) - 4}
                        textAnchor="end"
                        fontSize="10"
                        fontFamily="monospace"
                        fill="var(--text-3)"
                      >
                        {s.band.label}
                      </text>
                    </>
                  ) : null}
                </g>
              )}

              {/* Decision vertical lines */}
              {decisionTimes
                .filter(t => t >= 0 && t <= maxTime)
                .map((t, idx) => (
                  <line
                    key={`dec-${idx}`}
                    x1={scaleX(t)}
                    x2={scaleX(t)}
                    y1={PADDING.top}
                    y2={H - PADDING.bottom}
                    stroke="var(--text-3)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                ))}

              {/* Data polyline */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="var(--act)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points */}
              {s.points.map((p, idx) => (
                <circle
                  key={`pt-${idx}`}
                  cx={scaleX(p.t)}
                  cy={scaleY(p.v)}
                  r="2.5"
                  fill="var(--act)"
                />
              ))}

              {/* Y-axis ticks and labels */}
              {yTicks.map((yVal, idx) => {
                const yPos = scaleY(yVal);
                return (
                  <g key={`y-${idx}`}>
                    <line
                      x1={PADDING.left - 4}
                      x2={PADDING.left}
                      y1={yPos}
                      y2={yPos}
                      stroke="var(--line)"
                      strokeWidth="1"
                    />
                    <text
                      x={PADDING.left - 6}
                      y={yPos + 3}
                      textAnchor="end"
                      fontSize="9"
                      fontFamily="monospace"
                      fill="var(--text-3)"
                    >
                      {yTickLabels[idx]}
                    </text>
                  </g>
                );
              })}

              {/* X-axis ticks and labels */}
              {xTicks.map((tVal, idx) => {
                const xPos = scaleX(tVal);
                return (
                  <g key={`x-${idx}`}>
                    <line
                      x1={xPos}
                      x2={xPos}
                      y1={H - PADDING.bottom}
                      y2={H - PADDING.bottom + 4}
                      stroke="var(--line)"
                      strokeWidth="1"
                    />
                    <text
                      x={xPos}
                      y={H - PADDING.bottom + 14}
                      textAnchor="middle"
                      fontSize="9"
                      fontFamily="monospace"
                      fill="var(--text-3)"
                    >
                      {formatSimTime(tVal)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
};
