// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SweepWaveforms } from '../../src/display/SweepWaveforms';
import type { WaveformSample } from '../../src/shared/engineTypes';

// Rising pressure over 2 seconds so the two caliper points read different values.
const samples: WaveformSample[] = Array.from({ length: 20 }, (_, i) => ({
  tSec: i * 0.1,
  pawCmH2O: 10 + i,
  flowLps: 0.5 + i * 0.01,
  volumeMl: 100 + i,
  pmusCmH2O: 0,
  phase: 'insp',
  breathType: 'mandatory',
}));

describe('SweepWaveforms two-point caliper', () => {
  afterEach(cleanup);

  it('first click places point A with its readout, no delta yet', () => {
    render(<SweepWaveforms samples={samples} playing={false} />);
    const canvas = screen.getByTestId('sweep-waveforms');
    act(() => { fireEvent.mouseDown(canvas, { clientX: 60 }); fireEvent.mouseUp(canvas); });
    expect(screen.getByTestId('cursor-readout').textContent).toContain('t: 0.00s');
    expect(screen.queryByTestId('caliper-readout')).toBeNull();
  });

  it('second click places point B and shows time, pressure and flow deltas', () => {
    render(<SweepWaveforms samples={samples} playing={false} />);
    const canvas = screen.getByTestId('sweep-waveforms');
    act(() => { fireEvent.mouseDown(canvas, { clientX: 60 }); fireEvent.mouseUp(canvas); });
    act(() => { fireEvent.mouseDown(canvas, { clientX: 200 }); fireEvent.mouseUp(canvas); });
    const delta = screen.getByTestId('caliper-readout').textContent ?? '';
    // Point A is sample 0 (t 0.00), point B is the newest sample (t 1.90).
    expect(delta).toContain('Δt: 1.90 s');
    expect(delta).toContain('ΔPaw: 19.0 cmH2O');
    expect(delta).toContain('ΔFlow: 11.4 L/min');
  });

  it('clears both points when the trace unfreezes', () => {
    const { rerender } = render(<SweepWaveforms samples={samples} playing={false} />);
    const canvas = screen.getByTestId('sweep-waveforms');
    act(() => { fireEvent.mouseDown(canvas, { clientX: 60 }); fireEvent.mouseUp(canvas); });
    act(() => { fireEvent.mouseDown(canvas, { clientX: 200 }); fireEvent.mouseUp(canvas); });
    expect(screen.getByTestId('caliper-readout')).toBeTruthy();
    rerender(<SweepWaveforms samples={samples} playing />);
    expect(screen.queryByTestId('caliper-readout')).toBeNull();
    expect(screen.queryByTestId('cursor-readout')).toBeNull();
  });
});
