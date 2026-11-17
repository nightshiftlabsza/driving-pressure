// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { WaveformPlot } from './WaveformPlot';
import type { WaveformSample } from '../shared/engineTypes';

// Small synthetic test dataset clearly labelled as mock data for testing render paths
const SYNTHETIC_TEST_WAVEFORM_SAMPLES: WaveformSample[] = [
  {
    tSec: 0.0,
    pawCmH2O: 5.0,
    flowLps: 0.0,
    volumeMl: 0.0,
    pmusCmH2O: 0.0,
    phase: 'insp',
    breathType: 'mandatory',
  },
  {
    tSec: 0.5,
    pawCmH2O: 22.0,
    flowLps: 1.0,
    volumeMl: 250.0,
    pmusCmH2O: 0.0,
    phase: 'insp',
    breathType: 'mandatory',
  },
  {
    tSec: 1.0,
    pawCmH2O: 18.0,
    flowLps: 0.0,
    volumeMl: 500.0,
    pmusCmH2O: 0.0,
    phase: 'insp',
    breathType: 'mandatory',
  },
  {
    tSec: 1.5,
    pawCmH2O: 6.0,
    flowLps: -0.8,
    volumeMl: 200.0,
    pmusCmH2O: 0.0,
    phase: 'exp',
    breathType: 'mandatory',
  },
  {
    tSec: 2.5,
    pawCmH2O: 5.0,
    flowLps: 0.0,
    volumeMl: 0.0,
    pmusCmH2O: 0.0,
    phase: 'exp',
    breathType: 'mandatory',
  },
];

describe('WaveformPlot Component', () => {
  it('renders a distinct SVG path for pressure, flow, and volume channels from synthetic samples', () => {
    const { container } = render(<WaveformPlot samples={SYNTHETIC_TEST_WAVEFORM_SAMPLES} />);

    // Channel 1: Pressure
    const pressurePath = screen.getByTestId('waveform-path-pressure');
    expect(pressurePath).toBeTruthy();
    expect(pressurePath.getAttribute('d')).toContain('M');

    // Channel 2: Flow
    const flowPath = screen.getByTestId('waveform-path-flow');
    expect(flowPath).toBeTruthy();
    expect(flowPath.getAttribute('d')).toContain('M');

    // Channel 3: Volume
    const volumePath = screen.getByTestId('waveform-path-volume');
    expect(volumePath).toBeTruthy();
    expect(volumePath.getAttribute('d')).toContain('M');

    // Labels with units
    expect(container.textContent).toContain('Pressure (cmH2O)');
    expect(container.textContent).toContain('Flow (L/s)');
    expect(container.textContent).toContain('Volume (mL)');
    expect(container.textContent).toContain('Time (s)');
  });

  it('renders empty message gracefully when no samples are provided', () => {
    render(<WaveformPlot samples={[]} />);
    expect(screen.getByText('No waveform data available')).toBeTruthy();
  });
});
