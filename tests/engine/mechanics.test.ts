import { describe, it, expect } from 'vitest';
import { engine, truth } from '../../src/engine/index';
import { flowStep } from '../../src/engine/mechanics';
import type { DeviceSettings, EngineState, PatientParams } from '../../src/shared/engineTypes';
import { passive, vc } from './fixtures';

function hold(s: EngineState, kind: 'insp-hold' | 'exp-hold') {
  const r = engine.step(engine.startManoeuvre(s, { kind, maxSec: 1 }), 10);
  expect(r.manoeuvre, `${kind} produced a result`).toBeDefined();
  return r.manoeuvre!;
}

describe('volume control, passive patient', () => {
  const s = engine.step(engine.createState(passive, vc(), { paco2MmHg: 40 }), 10).state;

  it('delivers the set tidal volume', () => {
    expect(s.lastBreath!.vtiMl).toBeGreaterThan(490);
    expect(s.lastBreath!.vtiMl).toBeLessThan(510);
  });
  it('Pplat - PEEP = VT / C (equation of motion)', () => {
    const m = hold(s, 'insp-hold');
    expect(m.valid).toBe(true);
    expect(m.pplatCmH2O!).toBeCloseTo(5 + 500 / 50, 0);
  });
  it('Ppeak - Pplat = R x flow (square flow 1 L/s, R 10)', () => {
    const pplat = hold(s, 'insp-hold').pplatCmH2O!;
    expect(s.monitored.ppeakCmH2O! - pplat).toBeCloseTo(10, 0);
  });
  it('doubling resistance raises Ppeak but not Pplat', () => {
    const hi = engine.step(engine.createState({ ...passive, inspResistanceCmH2OPerLps: 20 }, vc(), { paco2MmHg: 40 }), 10).state;
    expect(hi.monitored.ppeakCmH2O! - s.monitored.ppeakCmH2O!).toBeCloseTo(10, 0);
    expect(hold(hi, 'insp-hold').pplatCmH2O!).toBeCloseTo(hold(s, 'insp-hold').pplatCmH2O!, 0);
  });
  it('halving compliance raises Pplat and driving pressure', () => {
    const stiff = engine.step(engine.createState({ ...passive, complianceMlPerCmH2O: 25 }, vc(), { paco2MmHg: 40 }), 10).state;
    expect(hold(stiff, 'insp-hold').pplatCmH2O!).toBeCloseTo(5 + 500 / 25, 0);
    expect(truth(stiff).drivingPressure!).toBeCloseTo(20, 0);
  });
  it('no auto-PEEP when expiratory time is long', () => {
    const m = hold(s, 'exp-hold');
    expect(m.autoPeepCmH2O!).toBeLessThan(0.5);
    expect(Math.abs(s.lastBreath!.endExpFlowLps)).toBeLessThan(0.02);
  });
  it('intubated patient has no leak and VTi equals VTe', () => {
    expect(s.monitored.leakLpm).toBeNull();
    expect(Math.abs(s.lastBreath!.vtiMl - s.lastBreath!.vteMl)).toBeLessThan(10);
  });
});

describe('auto-PEEP emerges from incomplete exhalation', () => {
  const obstructed: PatientParams = { ...passive, inspResistanceCmH2OPerLps: 25, expResistanceCmH2OPerLps: 40, ppvResponse: 'clean-kill', ppvSeverity: 0.8 };
  const run = (rr: number, flow = 60) => engine.fastForward(engine.createState(obstructed, vc({ rrSetBpm: rr, vtSetMl: 450, inspFlowLpm: flow, fio2: 0.5 }), { paco2MmHg: 50 }), 120);

  it('high RR traps gas; lower RR releases it', () => {
    const fast = hold(run(24), 'exp-hold').autoPeepCmH2O!;
    const slow = hold(run(10), 'exp-hold').autoPeepCmH2O!;
    expect(fast).toBeGreaterThan(3);
    expect(slow).toBeLessThan(1.5);
  });
  it('expiratory flow does not return to zero before the next breath at high RR', () => {
    expect(run(24).lastBreath!.endExpFlowLps).toBeLessThan(-0.05);
  });
  it('higher inspiratory flow (shorter Ti) reduces auto-PEEP', () => {
    expect(hold(run(20, 90), 'exp-hold').autoPeepCmH2O!).toBeLessThan(hold(run(20, 40), 'exp-hold').autoPeepCmH2O!);
  });
  it('auto-PEEP lowers blood pressure in a preload-dependent patient', () => {
    expect(run(24).monitored.sbpMmHg).toBeLessThan(run(10).monitored.sbpMmHg - 10);
  });
});

describe('pressure control', () => {
  const pc: DeviceSettings = { device: 'invasive', mode: 'PC-AC', fio2: 0.4, peep: 5, rrSetBpm: 15, pinspAbovePeep: 15, tiSec: 1.0, riseTimeSec: 0 };
  it('VT follows C x dP x (1 - exp(-Ti/tau))', () => {
    const s = engine.step(engine.createState(passive, pc, { paco2MmHg: 40 }), 10).state;
    const tau = 10 * 0.05; // R (cmH2O/L/s) x C (L/cmH2O)
    const expected = 50 * 15 * (1 - Math.exp(-1 / tau));
    expect(s.lastBreath!.vtiMl).toBeGreaterThan(expected * 0.95);
    expect(s.lastBreath!.vtiMl).toBeLessThan(expected * 1.05);
  });
  it('a stiffer lung gets less volume at the same pressure', () => {
    const a = engine.step(engine.createState(passive, pc, { paco2MmHg: 40 }), 10).state.lastBreath!.vtiMl;
    const b = engine.step(engine.createState({ ...passive, complianceMlPerCmH2O: 25 }, pc, { paco2MmHg: 40 }), 10).state.lastBreath!.vtiMl;
    expect(b).toBeLessThan(a * 0.6);
  });
});

describe('pressure support and patient effort', () => {
  const breathing: PatientParams = { ...passive, spontRateBpm: 18, pmusAmplitudeCmH2O: 8, pmusInspTimeSec: 1 };
  const psv = (ps: number, cyc = 25, peep = 5): DeviceSettings => ({ device: 'invasive', mode: 'PSV', fio2: 0.4, peep, rrSetBpm: 0, psAbovePeep: ps, cyclePctPeakFlow: cyc });

  it('breathes at the patient rate, all breaths assisted', () => {
    const s = engine.fastForward(engine.createState(breathing, psv(10), { paco2MmHg: 40 }), 60);
    expect(s.monitored.rrTotalBpm).toBeGreaterThanOrEqual(12); // was > 14: PS 10 over-ventilates, drive falls, rate eases from 18 to about 14
    expect(s.monitored.rrTotalBpm).toBeLessThan(24);
    expect(s.lastBreath!.breathType).toBe('assisted');
  });
  it('more support gives more volume', () => {
    const lo = engine.fastForward(engine.createState(breathing, psv(5), { paco2MmHg: 40 }), 60).monitored.vteMl!;
    const hi = engine.fastForward(engine.createState(breathing, psv(15), { paco2MmHg: 40 }), 60).monitored.vteMl!;
    expect(hi).toBeGreaterThan(lo + 100);
  });
  it('a higher cycle threshold shortens inspiration', () => {
    const early = engine.fastForward(engine.createState(breathing, psv(10, 60), { paco2MmHg: 40 }), 30).lastBreath!.tiSec;
    const late = engine.fastForward(engine.createState(breathing, psv(10, 10), { paco2MmHg: 40 }), 30).lastBreath!.tiSec;
    expect(early).toBeLessThan(late);
  });
  it('apnoea on PSV (backup switched off): no breaths and rising PaCO2', () => {
    let s = engine.createState(passive, { ...psv(10), apnoeaBackup: false } as DeviceSettings, { paco2MmHg: 40 });
    s = engine.fastForward(s, 300);
    expect(s.monitored.rrTotalBpm).toBe(0);
    expect(s.phys.paco2MmHg).toBeGreaterThan(50);
  });
  it('auto-PEEP causes ineffective triggering; external PEEP reduces it', () => {
    const copdLike: PatientParams = { ...passive, inspResistanceCmH2OPerLps: 15, expResistanceCmH2OPerLps: 30, expFlowLimitationCmH2O: 9, complianceMlPerCmH2O: 60, spontRateBpm: 26, pmusAmplitudeCmH2O: 6, pmusInspTimeSec: 0.9 };
    const count = (peep: number) => {
      let s = engine.createState(copdLike, psv(16, 25, peep), { paco2MmHg: 45 });
      const r = engine.step(s, 60);
      s = r.state;
      return r.breaths.reduce((a, b) => a + b.ineffectiveEfforts, 0);
    };
    const atZero = count(0);
    expect(atZero).toBeGreaterThan(3);
    expect(count(8)).toBeLessThan(atZero);
  });
});

describe('noninvasive and HFNC', () => {
  const breathing: PatientParams = { ...passive, spontRateBpm: 22, pmusAmplitudeCmH2O: 8, pmusInspTimeSec: 0.9 };
  it('poor mask fit leaks more than good fit and delivers less volume', () => {
    const niv = (fit: 'good' | 'poor'): DeviceSettings => ({ device: 'niv', mode: 'ST', fio2: 0.4, epap: 6, ipap: 14, backupRrBpm: 10, tiSec: 1, interface: 'oronasal', maskFit: fit });
    const good = engine.fastForward(engine.createState(breathing, niv('good'), { paco2MmHg: 45 }), 60).monitored;
    const poor = engine.fastForward(engine.createState(breathing, niv('poor'), { paco2MmHg: 45 }), 60).monitored;
    expect(poor.leakLpm!).toBeGreaterThan(good.leakLpm! + 20);
    expect(poor.vteMl!).toBeLessThan(good.vteMl!);
  });
  it('HFNC: no ventilator readings, no capnography', () => {
    const s = engine.fastForward(engine.createState(breathing, { device: 'hfnc', flowLpm: 50, fio2: 0.5, temperatureC: 37 }, { paco2MmHg: 40 }), 60);
    expect(s.monitored.ppeakCmH2O).toBeNull();
    expect(s.monitored.etco2MmHg).toBeNull();
    expect(s.monitored.rrTotalBpm).toBeGreaterThan(15);
  });
});

describe('determinism', () => {
  it('same inputs give identical outputs', () => {
    const a = engine.step(engine.createState(passive, vc(), { paco2MmHg: 40 }), 7);
    const b = engine.step(engine.createState(passive, vc(), { paco2MmHg: 40 }), 7);
    expect(JSON.stringify(a.samples)).toBe(JSON.stringify(b.samples));
    expect(a.state.monitored).toEqual(b.state.monitored);
  });
  it('step does not mutate its input state', () => {
    const s = engine.createState(passive, vc(), { paco2MmHg: 40 });
    const before = JSON.stringify(s);
    engine.step(s, 2);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('simulateBreaths returns the requested number of breaths with 50 Hz samples', () => {
    const r = engine.simulateBreaths(passive, vc(), 3);
    expect(r.breaths.length).toBeGreaterThanOrEqual(3);
    const dt = r.samples[1].tSec - r.samples[0].tSec;
    expect(dt).toBeCloseTo(0.02, 3);
  });
});

describe('expiratory flow limitation (waterfall), fixed-rate passive patient', () => {
  // Same 1.5 s expiration from the same end-inspiratory volume; only the applied PEEP differs.
  const endExpPressure = (p: PatientParams, peep: number) => {
    let V = 18 * p.complianceMlPerCmH2O;
    for (let i = 0; i < 300; i++) V = flowStep(p, V, peep, 0, p.complianceMlPerCmH2O, 0.005);
    return V / p.complianceMlPerCmH2O;
  };
  const limited: PatientParams = { ...passive, expResistanceCmH2OPerLps: 30, complianceMlPerCmH2O: 55, expFlowLimitationCmH2O: 9.5 };

  it('applied PEEP below the critical pressure barely changes end-expiratory alveolar pressure; above it, it adds', () => {
    const e0 = endExpPressure(limited, 0), e6 = endExpPressure(limited, 6), e14 = endExpPressure(limited, 14);
    expect(e6 - e0).toBeLessThanOrEqual(1);
    expect(e14 - e0).toBeGreaterThanOrEqual(4);
  });
  it('without the parameter, end-expiratory pressure follows applied PEEP (unchanged behaviour)', () => {
    const plain: PatientParams = { ...limited, expFlowLimitationCmH2O: undefined };
    expect(endExpPressure(plain, 6) - endExpPressure(plain, 0)).toBeGreaterThanOrEqual(3);
  });
});
