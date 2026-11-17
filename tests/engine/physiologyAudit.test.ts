import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { engine } from '../../src/engine/index';
import { CaseSchema } from '../../src/shared/caseSchema';
import { mergeVariant, type CaseVariantMetadata } from '../../src/cases/variants/loader';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';
import { passive, vc } from './fixtures';

type St = ReturnType<typeof engine.createState>;
const paco2 = (s: St) => engine.drawAbg(s).paco2MmHg;

/** Steady state on VT 500 / RR rrBefore, then switch to rrAfter; returns PaCO2 at each minute. */
function stepCurve(rrAfter: number, minutes: number, rrBefore: number) {
  let s = engine.createState(passive, vc({ rrSetBpm: rrBefore }));
  s = engine.fastForward(s, 1800);
  const out: number[] = [paco2(s)];
  s = engine.setDevice(s, vc({ rrSetBpm: rrAfter }));
  for (let m = 1; m <= minutes; m++) { s = engine.fastForward(s, 60); out.push(paco2(s)); }
  return out;
}
/** Minutes until the curve has covered half the distance between its start and its value at the end. */
function halfTimeMin(curve: number[]) {
  const start = curve[0], end = curve[curve.length - 1], half = start + (end - start) / 2;
  return curve.findIndex(v => (end > start ? v >= half : v <= half));
}

describe('E1: PaCO2 rise is slower than fall (Nunn & Lumb 9e ch 9/27)', () => {
  const rise = stepCurve(7.5, 150, 15);
  const fall = stepCurve(15, 150, 7.5);

  it('halving ventilation: at most half-way to the new target at 8 min', () => {
    const target = rise[rise.length - 1];
    expect((rise[8] - rise[0]) / (target - rise[0])).toBeLessThanOrEqual(0.5);
  });
  it('total apnoea raises PaCO2 3-6 mmHg/min', () => {
    const ap = stepCurve(0, 4, 15);
    const rate = (ap[4] - ap[0]) / 4;
    expect(rate).toBeGreaterThanOrEqual(3);
    expect(rate).toBeLessThanOrEqual(6);
  });
  it('fall half-time is shorter than rise half-time; rise half-time is 14-18 min (Nunn ch 9: about 16)', () => {
    expect(halfTimeMin(fall)).toBeLessThan(halfTimeMin(rise));
    expect(halfTimeMin(rise)).toBeGreaterThanOrEqual(14);
    expect(halfTimeMin(rise)).toBeLessThanOrEqual(18);
  });
});

describe('E3: PEEP is not counted twice in the circulatory load', () => {
  it('apnoeic CPAP 10 and PC with PEEP 10 + Pinsp 0.01 give the same arterial MAP (within 2 mmHg)', () => {
    const p: PatientParams = { ...passive, ppvResponse: 'clean-kill', ppvSeverity: 1 };
    const run = (d: DeviceSettings) => {
      let s = engine.createState(p, d);
      s = engine.fastForward(s, 600);
      return s.monitored.mapMmHg;
    };
    const cpap = run({ device: 'invasive', mode: 'CPAP', fio2: 0.4, peep: 10, rrSetBpm: 0, apnoeaBackup: false });
    const pc = run({ device: 'invasive', mode: 'PC-AC', fio2: 0.4, peep: 10, rrSetBpm: 12, pinspAbovePeep: 0.01, tiSec: 1 });
    expect(Math.abs(cpap - pc)).toBeLessThanOrEqual(2);
  });
});

describe('E5: EtCO2 tracks alveolar CO2 while Vt exceeds dead space', () => {
  const run = (vt: number, rr: number, pco2: number) => {
    let s = engine.createState(passive, vc({ vtSetMl: vt, rrSetBpm: rr }), { paco2MmHg: pco2 });
    s = engine.fastForward(s, 60);
    return s.monitored.etco2MmHg as number;
  };
  it('Vt = 1.3 x VD with PaCO2 90 still shows EtCO2 >= 40', () => {
    expect(run(195, 25, 90)).toBeGreaterThanOrEqual(40);
  });
  it('a normal breath reads a few mmHg below PaCO2', () => {
    const e = run(500, 14, 40);
    expect(e).toBeLessThan(40);
    expect(e).toBeGreaterThan(30);
  });
});

describe('S1: oxygen-induced hypercapnia in chronic CO2 retainers', () => {
  const variant = JSON.parse(readFileSync(resolve(__dirname, '../../src/cases/variants/copd-niv-01--retention-alkalosis.json'), 'utf8')) as CaseVariantMetadata;
  const base = CaseSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../src/cases/library/copd-niv-01.json'), 'utf8')));
  const c = mergeVariant(base, variant);
  const at = (flow: number, mins: number) => {
    let s = engine.createState(c.patient.params as PatientParams, { ...(c.initialDevice as DeviceSettings), o2FlowLpm: flow } as DeviceSettings, c.initialPhys);
    s = engine.fastForward(s, mins * 60);
    return paco2(s);
  };
  it('4 L/min gives higher PaCO2 than 1 L/min after 30 min, by a modest amount', () => {
    const hi = at(4, 30), lo = at(1, 30);
    expect(hi - lo).toBeLessThan(8);
    expect(hi).toBeGreaterThan(lo);
  });
});
