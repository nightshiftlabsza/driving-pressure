import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { passive, vc } from './fixtures';

describe('Apnoea desaturation (alveolar O2 store)', () => {
  it('paralysed apnoeic patient on FiO2 1.0 desaturates over minutes, not hours', () => {
    let s = engine.createState(passive, vc({ fio2: 1.0, rrSetBpm: 12 }));
    s = engine.fastForward(s, 120);
    const base = engine.drawAbg(s);
    s = engine.setDevice(s, vc({ fio2: 1.0, rrSetBpm: 0 }));
    const pao2: Record<number, number> = {};
    let t = 0;
    for (const mark of [60, 180, 300, 480, 720, 1200]) {
      s = engine.fastForward(s, mark - t); t = mark;
      pao2[mark] = engine.drawAbg(s).pao2MmHg;
    }
    // Still well oxygenated at 1 min (O2 store), clearly falling by 5 min, severe hypoxaemia by about 20 min.
    expect(pao2[60]).toBeGreaterThan(300);
    expect(pao2[300]).toBeLessThan(pao2[60]);
    expect(pao2[720]).toBeLessThan(pao2[300]);
    expect(pao2[1200]).toBeLessThan(base.pao2MmHg);
    expect(pao2[1200]).toBeLessThan(40);
    expect(s.monitored.spo2Pct).toBeLessThan(75);
  });

  it('adequately ventilated patient is unchanged (PaO2 stays near steady state)', () => {
    let s = engine.createState(passive, vc({ fio2: 0.4 }));
    s = engine.fastForward(s, 120);
    const a = engine.drawAbg(s).pao2MmHg;
    s = engine.fastForward(s, 600);
    expect(Math.abs(engine.drawAbg(s).pao2MmHg - a)).toBeLessThan(5);
  });
});

describe('Apnoea calibration (Benumof-style desaturation curves)', () => {
  const curve = (fio2: number, device: any = vc({ fio2, rrSetBpm: 0 })) => {
    let s = engine.createState({ ...passive, shuntFraction: 0.03 }, vc({ fio2, rrSetBpm: 12 }));
    s = engine.fastForward(s, 120);
    s = engine.setDevice(s, device);
    const spo2: number[] = [];
    for (let sec = 0; sec <= 1200; sec += 15) { spo2.push(s.monitored.spo2Pct); s = engine.fastForward(s, 15); }
    const cross = spo2.findIndex(v => v < 90);
    return { minutesTo90: cross < 0 ? Infinity : cross * 15 / 60, at: (min: number) => spo2[Math.round(min * 4)] };
  };
  it('preoxygenated (FiO2 1.0) healthy adult crosses 90% at about 8-9 min, then falls steeply', () => {
    const c = curve(1.0);
    expect(c.minutesTo90).toBeGreaterThanOrEqual(7.5);
    expect(c.minutesTo90).toBeLessThanOrEqual(9.5);
    expect(c.at(5)).toBeGreaterThanOrEqual(95);
    expect(c.at(12)).toBeLessThan(40);
  });
  it('FiO2 0.6 desaturates sooner than FiO2 1.0; room air sooner still (under 90% within about 2 min)', () => {
    const c6 = curve(0.6), c21 = curve(0.21), c10 = curve(1.0);
    expect(c6.minutesTo90).toBeLessThan(c10.minutesTo90);
    expect(c6.at(3)).toBeGreaterThanOrEqual(95);
    expect(c21.minutesTo90).toBeLessThan(c6.minutesTo90);
    expect(c21.minutesTo90).toBeLessThanOrEqual(2);
  });
  it('HFNC (patent airway, continuous flow) gives apnoeic oxygenation: slower than a closed circuit', () => {
    const hfnc = curve(1.0, { device: 'hfnc', fio2: 1.0, flowLpm: 60 });
    expect(hfnc.minutesTo90).toBeGreaterThan(curve(1.0).minutesTo90);
  });
});

describe('High-pressure limit (Pmax)', () => {
  it('VC with huge VT never exceeds Pmax and the breath is flagged as limited', () => {
    let s = engine.createState(passive, vc({ vtSetMl: 2000, inspFlowLpm: 60, pmaxCmH2O: 40 }));
    s = engine.fastForward(s, 60);
    expect(s.lastBreath?.ppeakCmH2O).toBeLessThanOrEqual(40.01);
    expect(s.lastBreath?.pmaxLimited).toBe(true);
    expect(s.lastBreath!.vtiMl).toBeLessThan(2000);
  });

  it('low flow cannot push pressure above Pmax; custom Pmax is honoured', () => {
    let s = engine.createState(passive, vc({ vtSetMl: 500, inspFlowLpm: 10, rrSetBpm: 10, pmaxCmH2O: 15 }));
    s = engine.fastForward(s, 60);
    expect(s.lastBreath?.ppeakCmH2O).toBeLessThanOrEqual(15.01);
  });

  it('normal breaths are not limited', () => {
    let s = engine.createState(passive, vc());
    s = engine.fastForward(s, 30);
    expect(s.lastBreath?.pmaxLimited).toBeUndefined();
  });
});

describe('Default Pmax', () => {
  it('default limit stops the absurd (VT 2000) case below 61 cmH2O', () => {
    let s = engine.createState(passive, vc({ vtSetMl: 2000 }));
    s = engine.fastForward(s, 60);
    expect(s.lastBreath?.ppeakCmH2O).toBeLessThanOrEqual(60.01);
  });
});
