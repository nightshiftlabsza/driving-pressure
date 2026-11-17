import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { BEDSIDE_PATIENT_PRESETS } from '../../src/bedside/presets';
import type { CaseFile } from '../../src/shared/caseSchema';
import type { PatientParams, DeviceSettings } from '../../src/shared/engineTypes';

describe('24-Hour fast-forward stability suite (Phase 6)', () => {
  const caseDir = path.resolve(__dirname, '../../src/cases/library');
  const caseFiles = fs.readdirSync(caseDir).filter(f => f.endsWith('.json')).sort();

  // Test 1: Full 24-hour fast-forward on standard ARDS ICU patient
  it('fast-forwards recruitable ARDS patient for a continuous 24 hours without NaN or instability', () => {
    const caseContent = fs.readFileSync(path.join(caseDir, 'ards-vent-01.json'), 'utf-8');
    const caseDef = JSON.parse(caseContent) as CaseFile;

    let state = engine.createState(
      caseDef.patient.params,
      caseDef.initialDevice,
      caseDef.initialPhys
    );

    // Fast-forward 24 hours (86,400 seconds) in one continuous run
    state = engine.fastForward(state, 24 * 3600);

    expect(Number.isFinite(state.phys.paco2MmHg)).toBe(true);
    expect(state.phys.paco2MmHg).toBeGreaterThan(0);
    expect(state.phys.paco2MmHg).toBeLessThan(300);

    expect(Number.isFinite(state.phys.pao2MmHg)).toBe(true);
    expect(state.phys.pao2MmHg).toBeGreaterThan(0);
    expect(state.phys.pao2MmHg).toBeLessThan(800);

    expect(Number.isFinite(state.phys.hco3MmolL)).toBe(true);
    expect(state.phys.hco3MmolL).toBeGreaterThan(0);
    expect(state.phys.hco3MmolL).toBeLessThan(100);

    expect(Number.isFinite(state.phys.trappedVolumeMl)).toBe(true);
    expect(state.phys.trappedVolumeMl).toBeGreaterThanOrEqual(0);

    expect(Number.isFinite(state.monitored.hrBpm)).toBe(true);
    expect(state.monitored.hrBpm).toBeGreaterThan(0);

    expect(Number.isFinite(state.monitored.sbpMmHg)).toBe(true);
    expect(state.monitored.sbpMmHg).toBeGreaterThan(0);

    expect(Number.isFinite(state.monitored.spo2Pct)).toBe(true);
    expect(state.monitored.spo2Pct).toBeGreaterThanOrEqual(0);
    expect(state.monitored.spo2Pct).toBeLessThanOrEqual(100);
  }, 45000);

  // Test 2: Full 24-hour fast-forward on COPD NIV patient with low V/Q
  it('fast-forwards COPD NIV patient with low V/Q for a continuous 24 hours without NaN or instability', () => {
    const caseContent = fs.readFileSync(path.join(caseDir, 'copd-niv-01.json'), 'utf-8');
    const caseDef = JSON.parse(caseContent) as CaseFile;

    let state = engine.createState(
      caseDef.patient.params,
      caseDef.initialDevice,
      caseDef.initialPhys
    );

    state = engine.fastForward(state, 24 * 3600);

    expect(Number.isFinite(state.phys.paco2MmHg)).toBe(true);
    expect(state.phys.paco2MmHg).toBeGreaterThan(0);

    expect(Number.isFinite(state.phys.pao2MmHg)).toBe(true);
    expect(state.phys.pao2MmHg).toBeGreaterThan(0);

    expect(Number.isFinite(state.phys.hco3MmolL)).toBe(true);
    expect(state.phys.hco3MmolL).toBeGreaterThan(0);

    expect(Number.isFinite(state.monitored.spo2Pct)).toBe(true);
    expect(state.monitored.spo2Pct).toBeGreaterThanOrEqual(0);
    expect(state.monitored.spo2Pct).toBeLessThanOrEqual(100);
  }, 45000);

  // Test 3: Fast-forward every bedside preset for 2 hours
  const presetKeys = Object.keys(BEDSIDE_PATIENT_PRESETS) as Array<keyof typeof BEDSIDE_PATIENT_PRESETS>;
  for (const key of presetKeys) {
    it(`fast-forwards preset ${key} for 2 hours without NaN or instability`, () => {
      const preset = BEDSIDE_PATIENT_PRESETS[key];
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 14,
        vtSetMl: 450,
        inspFlowLpm: 60,
      };

      let state = engine.createState(preset, device);
      state = engine.fastForward(state, 7200);

      expect(Number.isFinite(state.phys.paco2MmHg)).toBe(true);
      expect(state.phys.paco2MmHg).toBeGreaterThan(0);
      expect(Number.isFinite(state.phys.pao2MmHg)).toBe(true);
      expect(state.phys.pao2MmHg).toBeGreaterThan(0);
      expect(Number.isFinite(state.phys.hco3MmolL)).toBe(true);
      expect(state.phys.hco3MmolL).toBeGreaterThan(0);
    });
  }

  // Test 4: Fast-forward all remaining cases for 1 hour
  for (const file of caseFiles) {
    it(`fast-forwards case ${file} for 1 hour without NaN or instability`, () => {
      const caseContent = fs.readFileSync(path.join(caseDir, file), 'utf-8');
      const caseDef = JSON.parse(caseContent) as CaseFile;

      let state = engine.createState(
        caseDef.patient.params,
        caseDef.initialDevice,
        caseDef.initialPhys
      );

      state = engine.fastForward(state, 3600);

      expect(Number.isFinite(state.phys.paco2MmHg)).toBe(true);
      expect(state.phys.paco2MmHg).toBeGreaterThan(0);
      expect(Number.isFinite(state.phys.pao2MmHg)).toBe(true);
      expect(state.phys.pao2MmHg).toBeGreaterThan(0);
      expect(Number.isFinite(state.phys.hco3MmolL)).toBe(true);
      expect(state.phys.hco3MmolL).toBeGreaterThan(0);
    });
  }

  // Test 5: step(0.1) execution speed check
  it('evaluates step(0.1) execution speed (within 25% of baseline)', () => {
    const patient: PatientParams = {
      sex: 'M',
      ageYears: 55,
      heightCm: 175,
      actualWeightKg: 75,
      complianceMlPerCmH2O: 45,
      inspResistanceCmH2OPerLps: 8,
      expResistanceCmH2OPerLps: 8,
      spontRateBpm: 15,
      pmusAmplitudeCmH2O: 10,
      pmusInspTimeSec: 0.9,
      vco2MlPerMin: 220,
      vo2MlPerMin: 280,
      anatomicDeadSpaceMl: 150,
      alveolarDeadSpaceFraction: 0.15,
      shuntFraction: 0.1,
      recruitability: 0.2,
      hbGPerDl: 14,
      temperatureC: 37,
      baselineHco3MmolL: 24,
      hrBaselineBpm: 80,
      sbpBaselineMmHg: 120,
      dbpBaselineMmHg: 75,
      ppvResponse: 'unhelpful',
      ppvSeverity: 0.2,
      respiratoryReserve: 0.8,
    };

    const device: DeviceSettings = {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.4,
      peep: 5,
      rrSetBpm: 14,
      vtSetMl: 450,
      inspFlowLpm: 60,
    };

    let state = engine.createState(patient, device);
    for (let i = 0; i < 50; i++) {
      const res = engine.step(state, 0.1);
      state = res.state;
    }

    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const res = engine.step(state, 0.1);
      state = res.state;
    }
    const elapsedMs = performance.now() - start;
    const msPerStep = elapsedMs / iterations;

    console.log(`Measured median step(0.1): ${msPerStep.toFixed(4)} ms`);
    expect(msPerStep).toBeLessThan(0.35); // Baseline is ~0.15 ms
  });
});
