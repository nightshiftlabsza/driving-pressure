// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SweepWaveforms } from '../../src/display/SweepWaveforms';
import type { WaveformSample } from '../../src/shared/engineTypes';

const samples: WaveformSample[] = Array.from({ length: 20 }, (_, i) => ({
  tSec: i * 0.1,
  pawCmH2O: 10,
  flowLps: 0.5,
  volumeMl: 100,
  pmusCmH2O: 0,
  phase: 'insp',
  breathType: 'mandatory',
}));

describe('SweepWaveforms channel legend toggles', () => {
  afterEach(cleanup);

  it('shows a legend entry per channel, pressed by default', () => {
    render(<SweepWaveforms samples={samples} playing={false} />);
    for (const label of ['Paw', 'Flow', 'Volume']) {
      const btn = screen.getByTestId(`waveform-legend-${label}`) as HTMLButtonElement;
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('toggles a channel off and back on from its legend label', () => {
    render(<SweepWaveforms samples={samples} playing={false} />);
    const flow = screen.getByTestId('waveform-legend-Flow') as HTMLButtonElement;
    fireEvent.click(flow);
    expect(flow.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByTestId('waveform-legend-Paw') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(flow);
    expect(flow.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles channels independently', () => {
    render(<SweepWaveforms samples={samples} playing={false} />);
    fireEvent.click(screen.getByTestId('waveform-legend-Paw'));
    fireEvent.click(screen.getByTestId('waveform-legend-Volume'));
    expect((screen.getByTestId('waveform-legend-Paw') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByTestId('waveform-legend-Flow') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('waveform-legend-Volume') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
  });
});

import { timeAxisLabels } from '../../src/display/SweepWaveforms';

describe('time axis labels', () => {
  it('labels every second of the fixed 10-second window, with the unit on the last label', () => {
    const labels = timeAxisLabels(10);
    expect(labels).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10 s']);
  });
});
