import { describe, it, expect } from 'vitest';
import { chooseScale } from '../display';

describe('SweepWaveforms chooseScale', () => {
  const volScales: readonly (readonly [number, number])[] = [
    [0, 600],
    [0, 800],
    [0, 1000],
    [0, 1500],
    [0, 2000],
  ];

  it('steps up immediately if high value clips', () => {
    // Starting at [0, 600], peak reaches 950 mL
    const next = chooseScale(volScales, 0, 0, 950, false);
    expect(next).toBe(2); // [0, 1000]
  });

  it('does not step down if a full sweep has not completed', () => {
    // Current is [0, 2000] (idx 4), peak is 450 mL, but hasFullSweep is false
    const next = chooseScale(volScales, 4, 0, 450, false);
    expect(next).toBe(4);
  });

  it('steps back down when trace stays below 60% of next smaller scale for a full sweep', () => {
    // Current is [0, 2000] (idx 4), peak is 450 mL with full sweep.
    // Next smaller [0, 1500] 60% is 900 -> fits
    // Next smaller [0, 1000] 60% is 600 -> fits
    // Next smaller [0, 800] 60% is 480 -> 450 fits!
    // Next smaller [0, 600] 60% is 360 -> 450 > 360, stops at [0, 800] (idx 1)
    const next = chooseScale(volScales, 4, 0, 450, true);
    expect(next).toBe(1); // [0, 800]
  });

  it('does not step down if peak exceeds 60% of next smaller scale', () => {
    // Current is [0, 1000] (idx 2). Next smaller is [0, 800] (60% = 480).
    // Trace peak is 500 mL (> 480 mL). Should stay at [0, 1000].
    const next = chooseScale(volScales, 2, 0, 500, true);
    expect(next).toBe(2);
  });

  it('handles bidirectional symmetric flow scales correctly', () => {
    const flowScales: readonly (readonly [number, number])[] = [
      [-60, 60],
      [-90, 90],
      [-120, 120],
      [-180, 180],
    ];
    // Current at [-180, 180] (idx 3). Range is [-30, 30].
    // 60% of [-120, 120] is [-72, 72] -> fits
    // 60% of [-90, 90] is [-54, 54] -> fits
    // 60% of [-60, 60] is [-36, 36] -> fits
    const next = chooseScale(flowScales, 3, -30, 30, true);
    expect(next).toBe(0); // [-60, 60]
  });

  it('does not step down symmetric scale if negative limit exceeds 60%', () => {
    const flowScales: readonly (readonly [number, number])[] = [
      [-60, 60],
      [-90, 90],
    ];
    // Current at [-90, 90] (idx 1). Next smaller [-60, 60], 60% min is -36.
    // Actual min is -45 (< -36). Should not step down.
    const next = chooseScale(flowScales, 1, -45, 20, true);
    expect(next).toBe(1);
  });

  it('does not step up zero-based volume scale when lo is negative', () => {
    // Slight negative volume drift (e.g. -2 mL) should NOT cause volume to jump to 2000 mL
    const next = chooseScale(volScales, 0, -5, 450, false);
    expect(next).toBe(0); // remains at [0, 600]
  });

  it('steps down zero-based volume scale even if lo has negative drift', () => {
    // Current is [0, 2000], peak is 450 mL, lo is -5 mL, hasFullSweep is true.
    // Negative drift should not trap scale at 2000 mL
    const next = chooseScale(volScales, 4, -5, 450, true);
    expect(next).toBe(1); // steps down to [0, 800]
  });
});
