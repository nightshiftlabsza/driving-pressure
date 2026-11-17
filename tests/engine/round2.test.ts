import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { engine, truth } from '../../src/engine/index';
import { CaseSchema } from '../../src/shared/caseSchema';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';
import { passive } from './fixtures';

const psv = (ps: number, peep = 5, o: Record<string, unknown> = {}): DeviceSettings =>
  ({ device: 'invasive', mode: 'PSV', fio2: 0.35, peep, rrSetBpm: 0, psAbovePeep: ps, ...o }) as DeviceSettings;

const loadCase = (id: string) => CaseSchema.parse(JSON.parse(readFileSync(resolve(__dirname, `../../src/cases/library/${id}.json`), 'utf8')));

describe('Apnoea backup (Hamilton C1 manual 5.5.2)', () => {
  const sedated: PatientParams = { ...passive, spontRateBpm: 0, pmusAmplitudeCmH2O: 0 };

  it('sedated patient on PS 5 with no effort: backup starts within 25 s, ventilation restored, SpO2 holds', () => {
    let s = engine.createState(sedated, psv(5), { paco2MmHg: 40 });
    s = engine.fastForward(s, 15);
    expect(s.monitored.apnoeaBackupActive).toBe(false);
    s = engine.fastForward(s, 10);
    expect(s.monitored.apnoeaBackupActive).toBe(true);
    s = engine.fastForward(s, 95);
    expect(s.monitored.minuteVentLpm!).toBeGreaterThanOrEqual(4);
    expect(s.monitored.rrTotalBpm).toBeGreaterThanOrEqual(10);
    expect(s.monitored.spo2Pct).toBeGreaterThanOrEqual(95);
    expect(s.phys.paco2MmHg).toBeLessThan(46);
  });

  it('switching backup off restores the old apnoea behaviour', () => {
    let s = engine.createState(sedated, psv(5, 5, { apnoeaBackup: false }), { paco2MmHg: 40 });
    s = engine.fastForward(s, 120);
    expect(s.monitored.apnoeaBackupActive).toBe(false);
    expect(s.monitored.rrTotalBpm).toBe(0);
  });

  it('backup ends after the patient triggers several breaths again', () => {
    let s = engine.createState(sedated, psv(5), { paco2MmHg: 40 });
    s = engine.fastForward(s, 60);
    expect(s.monitored.apnoeaBackupActive).toBe(true);
    s = engine.setPatient(s, { spontRateBpm: 14, pmusAmplitudeCmH2O: 10, pmusInspTimeSec: 0.8 });
    s = engine.fastForward(s, 90);
    expect(s.monitored.apnoeaBackupActive).toBe(false);
  });
});

describe('Chemoreflex gain (Nunn & Lumb 9e ch 4)', () => {
  const healthy: PatientParams = { ...passive, spontRateBpm: 16, pmusAmplitudeCmH2O: 12, pmusInspTimeSec: 0.8, inspResistanceCmH2OPerLps: 8, expResistanceCmH2OPerLps: 8, alveolarDeadSpaceFraction: 0.05 };

  it('healthy patient on PS 14 does not fall to PaCO2 26 and keeps drive >= 0.8', () => {
    let s = engine.createState(healthy, psv(14), { paco2MmHg: 65 });
    s = engine.fastForward(s, 1200);
    expect(s.phys.paco2MmHg).toBeGreaterThanOrEqual(28);
    expect(s.internal.drive as number).toBeGreaterThanOrEqual(0.8);
  });

  it('chronic retainer on NIV 12/5 keeps a retainer-range PaCO2 (44-65, no over-correction to normal)', () => {
    const c = loadCase('copd-niv-01');
    const niv: DeviceSettings = { device: 'niv', mode: 'ST', fio2: 0.28, epap: 5, ipap: 12, backupRrBpm: 12, tiSec: 1, interface: 'oronasal', maskFit: 'good' };
    let s = engine.createState(c.patient.params as PatientParams, niv, c.initialPhys);
    s = engine.fastForward(s, 3600);
    expect(s.phys.paco2MmHg).toBeGreaterThanOrEqual(44);
    expect(s.phys.paco2MmHg).toBeLessThanOrEqual(65);
  });
});

describe('Applied PEEP offsets auto-PEEP at the trigger (The Ventilator Book ch 4)', () => {
  const c = loadCase('copd-psv-trigger-01');
  const p = c.patient.params as PatientParams;
  const run = (peep: number) => {
    const dev = { ...(c.initialDevice as DeviceSettings), peep } as DeviceSettings;
    let s = engine.createState(p, dev, c.initialPhys);
    s = engine.fastForward(s, 9 * 60);
    const r = engine.step(s, 60);
    const missed = r.breaths.reduce((a, b) => a + b.ineffectiveEfforts, 0);
    return { missed, paco2: r.state.phys.paco2MmHg, autoPeep: truth(r.state).autoPeep ?? 0 };
  };
  // Waterfall (flow limitation 9.5): total PEEP (set + measured auto-PEEP) barely rises up to ~80% of auto-PEEP,
  // rises clearly once applied PEEP is well above the critical pressure.
  it('PEEP at ~80% of auto-PEEP clears missed efforts and lowers PaCO2 without raising total PEEP; 150% does raise it', () => {
    const zero = run(0);
    const p80 = run(Math.round(0.8 * zero.autoPeep));
    const p150 = run(Math.round(1.5 * zero.autoPeep));
    const total = (r: { autoPeep: number }, peep: number) => r.autoPeep + peep;
    expect(zero.missed).toBeGreaterThanOrEqual(5);
    expect(p80.missed).toBeLessThanOrEqual(zero.missed * 0.5);
    expect(p80.paco2).toBeLessThan(zero.paco2 - 5);
    expect(total(p80, Math.round(0.8 * zero.autoPeep)) - total(zero, 0)).toBeLessThanOrEqual(2);
    expect(total(p150, Math.round(1.5 * zero.autoPeep)) - total(zero, 0)).toBeGreaterThanOrEqual(5);
  });
});
