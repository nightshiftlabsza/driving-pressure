// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CourseChart } from './CourseChart';
import type { ChartSeries } from './story';

describe('CourseChart', () => {
  it('renders fallback when series is empty', () => {
    render(<CourseChart series={[]} />);
    expect(screen.getByText(/No course chart data recorded for this run/i)).toBeTruthy();
  });

  it('renders SVG for series with band and decision lines', () => {
    const series: ChartSeries[] = [
      {
        key: 'spo2',
        label: 'SpO2',
        unit: '%',
        kind: 'spo2',
        points: [
          { t: 0, v: 88 },
          { t: 60, v: 92 },
          { t: 120, v: 94 },
        ],
        band: { lo: 88, hi: 95, label: 'Target 88-95% (ARDSNet)' },
      },
      {
        key: 'pplat',
        label: 'Plateau pressure',
        unit: 'cmH2O',
        kind: 'pplat',
        points: [
          { t: 0, v: 32 },
          { t: 60, v: 28 },
          { t: 120, v: 26 },
        ],
        band: { lo: null, hi: 30, label: 'Target at or below 30' },
      },
    ];

    const { container } = render(<CourseChart series={series} decisionTimes={[60]} />);

    expect(screen.getByText('SpO2')).toBeTruthy();
    expect(screen.getByText('Plateau pressure')).toBeTruthy();
    expect(screen.getByText('Target 88-95% (ARDSNet)')).toBeTruthy();
    expect(screen.getByText('Target at or below 30')).toBeTruthy();

    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(2);

    // Decision lines rendered
    const lines = container.querySelectorAll('line[stroke-dasharray="2 2"]');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('formats all three Y-ticks with one decimal when rounded labels would repeat (e.g. 48.0 to 49.4)', () => {
    const series: ChartSeries[] = [
      {
        key: 'paco2',
        label: 'PaCO2',
        unit: 'mmHg',
        kind: 'paco2',
        points: [
          { t: 0, v: 48.0 },
          { t: 120, v: 49.4 },
        ],
      },
    ];

    const { container } = render(<CourseChart series={series} />);
    const texts = Array.from(container.querySelectorAll('g text'))
      .map(el => el.textContent?.trim())
      .filter(t => t && (t.startsWith('48') || t.startsWith('49')));

    expect(texts).toEqual(['48.0', '48.7', '49.4']);
    expect(new Set(texts).size).toBe(3);
  });
});
