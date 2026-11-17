import { describe, expect, it } from 'vitest';
import { engine, truth } from '../../src/engine';
import type { DeviceSettings, EngineState, PatientParams } from '../../src/shared/engineTypes';
import { I } from '../../src/engine/types';
import { passive } from './fixtures';

// APRV mode description: The Ventilator Book 3rd ed. (Owens), APRV chapter; Hamilton C1 manual (P high/P low/T high/T low).
const aprv = (o: Partial<Extract<DeviceSettings, { device: 'invasive' }>> = {}): DeviceSettings =>
  ({ device: 'invasive', mode: 'APRV', fio2: 0.4, peep: 5, rrSetBpm: 0, phighCmH2O: 25, plowCmH2O: 5, thighSec: 4, tlowSec: 0.8, ...o });

function run(patient: PatientParams, dev: DeviceSettings, sec = 120): EngineState {
  return engine.fastForward(engine.createState(patient, dev), sec);
}
const m = (s: EngineState) => s.monitored.aprv!;
const effortful: PatientParams = { ...passive, spontRateBpm: 14, pmusAmplitudeCmH2O: 8, pmusInspTimeSec: 1 };

describe('APRV', () => {
  it('mean airway pressure follows the time-weighted settings with no effort', () => {
    const s = run(passive, aprv());
    const expected = (25 * 4 + 5 * 0.8) / 4.8;
    expect(Math.abs(m(s).meanAirwayPressureCmH2O! - expected)).toBeLessThan(1.5);
    expect(m(s).releaseRatePerMin).toBeGreaterThan(10);
  });

  it('shorter Tlow raises auto-PEEP and end-release flow; higher expiratory resistance raises auto-PEEP', () => {
    const t10 = run(passive, aprv({ tlowSec: 1.0 })), t04 = run(passive, aprv({ tlowSec: 0.4 }));
    const hiR = run({ ...passive, expResistanceCmH2OPerLps: 25 }, aprv({ tlowSec: 0.4 }));
    const ap = (s: EngineState) => truth(s).autoPeep!;
    console.log('autoPEEP Tlow1.0', ap(t10), 'Tlow0.4', ap(t04), 'Tlow0.4 highR', ap(hiR),
      'endflow%', m(t10).endReleaseFlowPctOfPeak, m(t04).endReleaseFlowPctOfPeak);
    expect(ap(t04)).toBeGreaterThan(ap(t10));
    expect(m(t04).endReleaseFlowPctOfPeak!).toBeGreaterThan(m(t10).endReleaseFlowPctOfPeak!);
    expect(ap(hiR)).toBeGreaterThan(ap(t04));
  });

  it('expiratory hold measures auto-PEEP', () => {
    let s = run(passive, aprv({ tlowSec: 0.4 }), 30);
    s = engine.startManoeuvre(s, { kind: 'exp-hold', maxSec: 2 });
    const r = engine.step(s, 12);
    expect(r.state.lastManoeuvre?.kind).toBe('exp-hold');
    expect(r.state.lastManoeuvre?.autoPeepCmH2O).toBeGreaterThan(1);
  });

  it('spontaneous effort adds minute ventilation, with breaths at Phigh', () => {
    const none = run(passive, aprv()), eff = run(effortful, aprv());
    expect(eff.monitored.minuteVentLpm!).toBeGreaterThan(none.monitored.minuteVentLpm!);
    expect(m(eff).spontRatePerMin).toBeGreaterThan(0);
    const sp = I(eff).breathLog.filter(b => b.kind === 'spontaneous' && b.level === 'high');
    expect(sp.length).toBeGreaterThan(3);
    // a breath still open when the release starts averages in some Plow, so check most rather than all
    expect(sp.filter(b => b.pmean > 20).length).toBeGreaterThan(0.6 * sp.length);
    // spontaneous breaths must not corrupt the end-release measurements
    expect(truth(eff).autoPeep!).toBeLessThan(11);
  });

  it('lower Phigh gives a smaller release volume', () => {
    expect(m(run(passive, aprv({ phighCmH2O: 15 }))).releaseVolumeMl!).toBeLessThan(m(run(passive, aprv({ phighCmH2O: 25 }))).releaseVolumeMl!);
  });

  it('validates settings', () => {
    expect(() => engine.createState(passive, aprv({ plowCmH2O: 12, phighCmH2O: 10 }))).toThrow();
    expect(() => engine.createState(passive, aprv({ tlowSec: 3 }))).toThrow();
  });
});
