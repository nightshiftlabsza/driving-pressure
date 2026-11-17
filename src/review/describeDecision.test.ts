import { describe, it, expect } from 'vitest';
import { describeDecision } from './describeDecision';
import type { DeviceSettings } from '../shared/engineTypes';
import type { DecisionInput } from './types';

const base: DeviceSettings = { device: 'invasive', mode: 'PSV', fio2: 0.35, peep: 5, rrSetBpm: 0, psAbovePeep: 5 };
const dec = (settings: DeviceSettings): DecisionInput => ({ simTimeSec: 0, kind: 'settings_change', settings });

describe('describeDecision', () => {
  it('PS change', () => {
    expect(describeDecision(dec({ ...base, psAbovePeep: 15 } as DeviceSettings), base))
      .toBe('Changed: Pressure support 5 to 15 cmH2O');
  });
  it('mode change', () => {
    const next = { ...base, mode: 'PC-AC', rrSetBpm: 14, pinspAbovePeep: 15 } as DeviceSettings;
    const out = describeDecision(dec(next), base);
    expect(out).toContain('Mode PSV to PC-AC');
    expect(out).toContain('Inspiratory pressure off to 15 cmH2O');
  });
  it('FiO2 change as percentage', () => {
    expect(describeDecision(dec({ ...base, fio2: 0.5 }), base)).toBe('Changed: FiO2 35% to 50%');
  });
  it('multiple changes', () => {
    const out = describeDecision(dec({ ...base, peep: 8, fio2: 0.4 }), base);
    expect(out).toBe('Changed: FiO2 35% to 40%, PEEP 5 to 8 cmH2O');
  });
  it('no previous state never prints rate for spontaneous mode', () => {
    const out = describeDecision(dec(base));
    expect(out).toContain('Mode PSV');
    expect(out).toContain('Pressure support 5 cmH2O');
    expect(out).toContain('FiO2 35%');
    expect(out).not.toMatch(/Rate/);
  });
});
