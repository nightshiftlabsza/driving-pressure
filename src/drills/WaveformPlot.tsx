import React from 'react';
import type { WaveformSample } from '../shared/engineTypes';

export interface WaveformPlotProps {
  samples: WaveformSample[];
  width?: number;
  height?: number;
  className?: string;
}

interface ChannelConfig {
  id: 'paw' | 'flow' | 'volume';
  label: string;
  unit: string;
  color: string;
  getValue: (s: WaveformSample) => number;
  testId: string;
  zeroLine?: boolean;
  minScalePadding?: number;
}

export const WaveformPlot: React.FC<WaveformPlotProps> = ({
  samples,
  width = 640,
  height = 360,
  className = '',
}) => {
  if (!samples || samples.length === 0) {
    return (
      <div
        className={`flex items-center justify-center border p-4 text-xs ${className}`}
        style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-3)', width, height }}
      >
        No waveform data available
      </div>
    );
  }

  const margin = { top: 18, right: 20, bottom: 28, left: 60 };
  const plotWidth = Math.max(100, width - margin.left - margin.right);
  const totalPlotHeight = Math.max(120, height - margin.top - margin.bottom);

  const tMin = samples[0].tSec;
  const tMax = Math.max(samples[samples.length - 1].tSec, tMin + 0.1);
  const tRange = tMax - tMin;

  const channels: ChannelConfig[] = [
    {
      id: 'paw',
      label: 'Pressure',
      unit: 'cmH2O',
      color: '#f59e0b', // amber-500
      getValue: (s) => s.pawCmH2O,
      testId: 'waveform-path-pressure',
      minScalePadding: 5,
    },
    {
      id: 'flow',
      label: 'Flow',
      unit: 'L/s',
      color: '#10b981', // emerald-500
      getValue: (s) => s.flowLps,
      testId: 'waveform-path-flow',
      zeroLine: true,
      minScalePadding: 0.2,
    },
    {
      id: 'volume',
      label: 'Volume',
      unit: 'mL',
      color: '#3b82f6', // blue-500
      getValue: (s) => s.volumeMl,
      testId: 'waveform-path-volume',
      minScalePadding: 50,
    },
  ];

  const channelHeight = totalPlotHeight / channels.length;
  const gap = 8;
  const subPlotHeight = channelHeight - gap;

  const getX = (t: number) => margin.left + ((t - tMin) / tRange) * plotWidth;

  return (
    <div
      className={`relative border overflow-hidden ${className}`}
      style={{ borderColor: 'var(--line)', background: 'var(--wave-bg)' }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="font-mono text-xs select-none block w-full h-auto"
        aria-label="Ventilator Waveform Scalar Plots"
      >
        {channels.map((chan, idx) => {
          const subPlotTop = margin.top + idx * channelHeight;
          const subPlotBottom = subPlotTop + subPlotHeight;

          const values = samples.map(chan.getValue);
          let vMin = Math.min(...values);
          let vMax = Math.max(...values);

          if (chan.zeroLine) {
            vMin = Math.min(vMin, -0.2);
            vMax = Math.max(vMax, 0.2);
          }

          const pad = (chan.minScalePadding ?? 1);
          vMin = Math.floor(vMin - pad);
          vMax = Math.ceil(vMax + pad);
          const vRange = Math.max(vMax - vMin, 0.001);

          const getY = (val: number) => {
            const normalized = (val - vMin) / vRange;
            return subPlotBottom - normalized * subPlotHeight;
          };

          // Generate SVG path command
          const pathData = samples.reduce((acc, sample, i) => {
            const x = getX(sample.tSec).toFixed(1);
            const y = getY(chan.getValue(sample)).toFixed(1);
            return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
          }, '');

          const zeroY = chan.zeroLine && vMin <= 0 && vMax >= 0 ? getY(0) : null;

          return (
            <g key={chan.id}>
              {/* Subplot background grid */}
              <rect
                x={margin.left}
                y={subPlotTop}
                width={plotWidth}
                height={subPlotHeight}
                fill="#030712"
                stroke="#1f2937"
                strokeWidth="1"
              />

              {/* Zero baseline for bipolar channels like flow */}
              {zeroY !== null && (
                <line
                  x1={margin.left}
                  y1={zeroY}
                  x2={margin.left + plotWidth}
                  y2={zeroY}
                  stroke="#374151"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}

              {/* Y Axis tick and labels */}
              <text
                x={margin.left - 6}
                y={subPlotTop + 10}
                fill="#9ca3af"
                textAnchor="end"
                fontSize="10"
              >
                {vMax}
              </text>
              <text
                x={margin.left - 6}
                y={subPlotBottom - 2}
                fill="#9ca3af"
                textAnchor="end"
                fontSize="10"
              >
                {vMin}
              </text>

              {/* Channel Label with Units */}
              <text
                x={margin.left + 8}
                y={subPlotTop + 13}
                fill={chan.color}
                fontSize="11"
                fontWeight="bold"
              >
                {chan.label} ({chan.unit})
              </text>

              {/* Channel Waveform Path */}
              <path
                d={pathData}
                fill="none"
                stroke={chan.color}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid={chan.testId}
              />
            </g>
          );
        })}

        {/* X Axis Time Labels at bottom */}
        <g transform={`translate(0, ${height - 8})`}>
          <text
            x={margin.left}
            y="0"
            fill="#9ca3af"
            textAnchor="start"
            fontSize="10"
          >
            {tMin.toFixed(1)}s
          </text>
          <text
            x={margin.left + plotWidth / 2}
            y="0"
            fill="#9ca3af"
            textAnchor="middle"
            fontSize="10"
          >
            Time (s)
          </text>
          <text
            x={margin.left + plotWidth}
            y="0"
            fill="#9ca3af"
            textAnchor="end"
            fontSize="10"
          >
            {tMax.toFixed(1)}s
          </text>
        </g>
      </svg>
    </div>
  );
};
