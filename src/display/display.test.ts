import { describe, it, expect } from 'vitest';
import { chooseScale } from './SweepWaveforms';
import { defaultLimits } from '../alarms';
import type { WaveformSample, MonitoredValues, DeviceSettings } from '../shared/engineTypes';

describe('Shared Display Unit Tests (Deliverable 3)', () => {
  it('chooses correct scale on clipping and steps down on full sweep', () => {
    const scales: readonly (readonly [number, number])[] = [
      [0, 30],
      [0, 40],
      [0, 60],
      [0, 80],
    ];
    // Initially at idx 0 ([0, 30]). If peak value reaches 45, it steps up immediately to [0, 60] (idx 2)
    let idx = chooseScale(scales, 0, 0, 45, false);
    expect(idx).toBe(2);

    // If signal stays below 60% of next smaller scale ([0, 40] * 0.6 = 24) on full sweep, it steps down
    idx = chooseScale(scales, 2, 0, 20, true);
    expect(idx).toBeLessThan(2);
  });

  it('default scale respects boundaries', () => {
    const scales: readonly (readonly [number, number])[] = [
      [0, 30],
      [0, 40],
    ];
    const idx = chooseScale(scales, 0, 0, 25, false);
    expect(idx).toBe(0);
  });
});
