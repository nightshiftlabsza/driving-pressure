import { describe, it, expect } from 'vitest';
import { engine, truth } from '../../src/engine/index';
import { phFrom, satFromPo2, alveolarPo2, steadyPaco2, arterialPo2 } from '../../src/engine/gas';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';
import copd from '../../src/cases/library/copd-niv-01.json';
import { passive, vc } from './fixtures';

describe('gas equations', () => {
  it('Henderson-Hasselbalch: normal values give pH 7.40', () => {
    expect(phFrom(24, 40)).toBeCloseTo(7.39, 1);
  });
  it('dissociation curve anchor points (P50 about 27, SaO2 90% near PO2 60)', () => {
    expect(satFromPo2(27)).toBeGreaterThan(0.48);
    expect(satFromPo2(27)).toBeLessThan(0.53);
    expect(satFromPo2(60)).toBeGreaterThan(0.88);
    expect(satFromPo2(60)).toBeLessThan(0.92);
  });
  it('acidosis shifts the curve right (Bohr effect)', () => {
    expect(satFromPo2(60, 7.2)).toBeLessThan(satFromPo2(60, 7.4));
  });
  it('alveolar gas equation on room air at sea level', () => {
    expect(alveolarPo2(0.21, 40)).toBeCloseTo(101.8, 0);
  });
  it('halving alveolar ventilation doubles steady-state PaCO2', () => {
    expect(steadyPaco2(200, 2)).toBeCloseTo(2 * steadyPaco2(200, 4), 5);
  });
  it('shunt makes hypoxaemia refractory to oxygen', () => {
    const o = { paco2: 40, hb: 14, vo2: 250, coLpm: 5, ph: 7.4, tempC: 37 };
    const gainSmall = arterialPo2({ ...o, fio2: 1, shunt: 0.05 }) - arterialPo2({ ...o, fio2: 0.4, shunt: 0.05 });
    const gainLarge = arterialPo2({ ...o, fio2: 1, shunt: 0.4 }) - arterialPo2({ ...o, fio2: 0.4, shunt: 0.4 });
    expect(gainLarge).toBeLessThan(gainSmall / 5);
  });
});

describe('integrated gas exchange', () => {
  it('raising RR lowers PaCO2 toward the new steady state', () => {
    const s = engine.createState(passive, vc(), { paco2MmHg: 40 });
    const base = engine.fastForward(s, 3600).phys.paco2MmHg;
    const fast = engine.fastForward(engine.setDevice(engine.fastForward(s, 3600), vc({ rrSetBpm: 32 })), 3600).phys.paco2MmHg;
    expect(fast).toBeLessThan(base * 0.6);
  });
  it('ABG pH is consistent with its own PaCO2 and HCO3', () => {
    const a = engine.drawAbg(engine.fastForward(engine.createState(passive, vc(), { paco2MmHg: 55 }), 600));
    expect(Math.abs(a.ph - phFrom(a.hco3MmolL, a.paco2MmHg))).toBeLessThan(0.02);
  });
  it('the measured starting gas matches the case (initialPhys wins)', () => {
    const p = copd.patient.params as PatientParams;
    const a = engine.drawAbg(engine.createState(p, copd.initialDevice as DeviceSettings, copd.initialPhys));
    expect(a.paco2MmHg).toBe(72);
    expect(a.hco3MmolL).toBeCloseTo(30, 0);
    expect(a.ph).toBeCloseTo(7.24, 1);
  });
  it('PEEP improves oxygenation when the lung is recruitable, not when it is not', () => {
    const ards: PatientParams = { ...passive, complianceMlPerCmH2O: 30, shuntFraction: 0.35 };
    const gain = (recruitability: number) => {
      const p = { ...ards, recruitability };
      const lo = engine.fastForward(engine.createState(p, vc({ peep: 5, vtSetMl: 400, fio2: 0.6 }), { paco2MmHg: 40 }), 900).phys.pao2MmHg;
      const hi = engine.fastForward(engine.createState(p, vc({ peep: 15, vtSetMl: 400, fio2: 0.6 }), { paco2MmHg: 40 }), 900).phys.pao2MmHg;
      return hi - lo;
    };
    expect(gain(0.8)).toBeGreaterThan(30);
    expect(gain(0.05)).toBeLessThan(10);
  });
  it('HFNC: higher flow raises effective FiO2 when the patient is breathing hard', () => {
    const p: PatientParams = { ...passive, spontRateBpm: 30, pmusAmplitudeCmH2O: 14, pmusInspTimeSec: 0.8, shuntFraction: 0.2 };
    const run = (flow: number) => engine.fastForward(engine.createState(p, { device: 'hfnc', flowLpm: flow, fio2: 0.8, temperatureC: 37 }, { paco2MmHg: 35 }), 300);
    expect(run(60).monitored.fio2).toBeGreaterThan(run(20).monitored.fio2);
    expect(run(60).phys.pao2MmHg).toBeGreaterThan(run(20).phys.pao2MmHg);
  });
});

describe('COPD reference case behaves as its design intends', () => {
  const p = copd.patient.params as PatientParams;
  const start = () => engine.createState(p, copd.initialDevice as DeviceSettings, copd.initialPhys);
  const niv = (ipap: number): DeviceSettings => ({ device: 'niv', mode: 'ST', fio2: 0.28, epap: 5, ipap, backupRrBpm: 12, tiSec: 1, interface: 'oronasal', maskFit: 'good' });

  it('untreated: worsening acidosis over 90 minutes', () => {
    const s = engine.fastForward(start(), 90 * 60);
    expect(truth(s).ph).toBeLessThan(7.15);
  });
  it('NIV 15/5: pH at least 7.30 by 60 minutes, RR falls', () => {
    const s = engine.fastForward(engine.setDevice(start(), niv(15)), 60 * 60);
    expect(truth(s).ph).toBeGreaterThanOrEqual(7.30);
    expect(s.monitored.rrTotalBpm).toBeLessThan(26); // baseline 28; retainer chemoreflex gain is blunted, so RR falls less
  });
  it('more pressure support clears more CO2 (titration matters)', () => {
    const lo = engine.fastForward(engine.setDevice(start(), niv(10)), 60 * 60).phys.paco2MmHg;
    const hi = engine.fastForward(engine.setDevice(start(), niv(16)), 60 * 60).phys.paco2MmHg;
    expect(hi).toBeLessThan(lo - 3);
  });
  it('over-oxygenation is possible (SpO2 above 96% on high FiO2)', () => {
    const s = engine.fastForward(engine.setDevice(start(), { ...niv(15), fio2: 0.6 } as DeviceSettings), 20 * 60);
    expect(s.monitored.spo2Pct).toBeGreaterThan(96);
  });
});
