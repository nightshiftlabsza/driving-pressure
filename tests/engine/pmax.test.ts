import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { passive, vc } from './fixtures';
import type { DeviceSettings } from '../../src/shared/engineTypes';

describe('Pressure limit (Pmax) behavior in VC and SIMV-VC', () => {
  it('truncates inspiratory breath in VC-AC at Pmax with VTe below set volume', () => {
    // Normal compliance 50, inspResistance 10, flow 60 L/min (1 L/s).
    // For 600 mL VT, Paw reaches PEEP(5) + Flow*R(10) + VT/C(12) = 27 cmH2O.
    // Setting Pmax to 20 cmH2O forces truncation before reaching 600 mL.
    const dev = vc({ vtSetMl: 600, inspFlowLpm: 60, peep: 5, pmaxCmH2O: 20 });
    let s = engine.createState(passive, dev);
    s = engine.fastForward(s, 30);

    const breath = s.lastBreath;
    expect(breath).toBeDefined();
    expect(breath?.ppeakCmH2O).toBeLessThanOrEqual(20.05);
    expect(breath?.pmaxLimited).toBe(true);
    expect(breath?.vtiMl).toBeLessThan(600);
    expect(breath?.vteMl).toBeLessThan(600);
    // Paw never exceeded Pmax
    expect(s.monitored.ppeakCmH2O).toBeLessThanOrEqual(20.05);
  });

  it('truncates mandatory inspiratory breath in SIMV-VC at Pmax with VTe below set', () => {
    const simvDev: DeviceSettings = {
      device: 'invasive',
      mode: 'SIMV-VC',
      fio2: 0.4,
      peep: 5,
      rrSetBpm: 12,
      vtSetMl: 600,
      inspFlowLpm: 60,
      flowPattern: 'square',
      psAbovePeep: 10,
      pmaxCmH2O: 20,
    };
    let s = engine.createState(passive, simvDev);
    s = engine.fastForward(s, 30);

    const breath = s.lastBreath;
    expect(breath).toBeDefined();
    expect(breath?.ppeakCmH2O).toBeLessThanOrEqual(20.05);
    expect(breath?.pmaxLimited).toBe(true);
    expect(breath?.vtiMl).toBeLessThan(600);
    expect(breath?.vteMl).toBeLessThan(600);
  });

  it('truncates breath when compliance drops acutely in VC-AC', () => {
    // Stiff lung: compliance 15 mL/cmH2O.
    // Delivering 500 mL would require Paw = 5 + 10 + 500/15 = 48.3 cmH2O.
    // Default Pmax is 40 cmH2O.
    const stiffPatient = { ...passive, complianceMlPerCmH2O: 15 };
    const dev = vc({ vtSetMl: 500, pmaxCmH2O: 40 });
    let s = engine.createState(stiffPatient, dev);
    s = engine.fastForward(s, 30);

    const breath = s.lastBreath;
    expect(breath).toBeDefined();
    expect(breath?.ppeakCmH2O).toBeLessThanOrEqual(40.05);
    expect(breath?.pmaxLimited).toBe(true);
    expect(breath?.vtiMl).toBeLessThan(500);
    expect(breath?.vteMl).toBeLessThan(500);
  });

  it('does not limit normal breaths when Ppeak remains below Pmax', () => {
    const dev = vc({ vtSetMl: 500, pmaxCmH2O: 45 });
    let s = engine.createState(passive, dev);
    s = engine.fastForward(s, 30);

    const breath = s.lastBreath;
    expect(breath).toBeDefined();
    expect(breath?.pmaxLimited).toBeFalsy();
    expect(breath?.ppeakCmH2O).toBeLessThan(35);
    expect(breath?.vtiMl).toBeGreaterThanOrEqual(490);
  });
});
