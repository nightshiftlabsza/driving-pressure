import { describe, it, expect } from 'vitest';
import { phFrom, ALPHA_CO2, acuteBuffer, acuteBufferDelta, metabolicFromMeasured, initialMetabolicHco3 } from '../../src/engine/gas';
import { effectiveFio2 } from '../../src/engine/devices';
import { engine } from '../../src/engine/index';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';

describe('Fix 6: Henderson-Hasselbalch and CO2 solubility', () => {
  it('uses CO2 solubility alpha = 0.0301 mmol/L/mmHg (Severinghaus et al. 1956)', () => {
    expect(ALPHA_CO2).toBe(0.0301);
  });

  it('yields standard textbook pH 7.400 for normal HCO3 24 and PaCO2 40 (within +-0.005)', () => {
    const ph = phFrom(24, 40);
    expect(ph).toBeCloseTo(7.400, 2);
    expect(Math.abs(ph - 7.400)).toBeLessThan(0.005);
  });

  it('verifies Henderson-Hasselbalch equation across normal and abnormal clinical ranges', () => {
    // Normal baseline: 24 / (0.0301 * 40) = 19.9336 -> pH = 6.1 + log10(19.9336) = 7.3996
    expect(phFrom(24, 40)).toBeCloseTo(7.400, 3);
    // Severe metabolic acidosis: HCO3 10, PaCO2 25 -> 10 / (0.0301 * 25) = 13.289 -> pH = 7.223
    expect(phFrom(10, 25)).toBeCloseTo(7.223, 2);
    // Severe acute respiratory acidosis: HCO3 27, PaCO2 70 -> 27 / (0.0301 * 70) = 12.814 -> pH = 7.208
    expect(phFrom(27, 70)).toBeCloseTo(7.208, 2);
  });

  it('calculates textbook acute respiratory acidosis pH accurately', () => {
    // PaCO2 70, acute HCO3 27: pH should be ~ 7.21
    const ph = phFrom(27, 70);
    expect(ph).toBeGreaterThan(7.20);
    expect(ph).toBeLessThan(7.23);
  });
});

describe('Fix 7: Chronic hypercapnia metabolic compensation and case start', () => {
  it('computes chronic baseline metabolic compensation: 24 + 0.35 * (chronicPaco2 - 40)', () => {
    // Brackett et al. (1965), Schwartz et al. (1965)
    // For chronic PaCO2 55: expected baseline metabolic HCO3 = 24 + 0.35 * 15 = 29.25 mmol/L
    const baselineHco3 = initialMetabolicHco3(undefined, 55, 55);
    expect(baselineHco3).toBeCloseTo(29.25, 2);
  });

  it('defaults to 24 mmol/L when chronicPaco2 is 40 or absent', () => {
    expect(initialMetabolicHco3(undefined, 40, 40)).toBe(24);
    expect(initialMetabolicHco3(undefined, 40)).toBe(24);
  });

  it('acuteBuffer handles both PaCO2 with baseline and delta directly', () => {
    // PaCO2 72 relative to baseline 55 -> delta +17 -> acute buffer +1.7 mmol/L
    expect(acuteBuffer(72, 24, 55)).toBeCloseTo(1.7, 2);
    // Passing delta 17 directly with baseline 0
    expect(acuteBuffer(17, 24, 0)).toBeCloseTo(1.7, 2);
    expect(acuteBufferDelta(17, 24)).toBeCloseTo(1.7, 2);

    // Negative delta: PaCO2 30 relative to baseline 40 -> delta -10 -> 0.2 * -10 = -2.0
    expect(acuteBuffer(30, 24, 40)).toBeCloseTo(-2.0, 2);
    expect(acuteBuffer(-10, 24)).toBeCloseTo(-2.0, 2);
    expect(acuteBufferDelta(-10, 24)).toBeCloseTo(-2.0, 2);
  });

  it('metabolicFromMeasured inverts acute buffering relative to chronicPaco2', () => {
    // Chronic retainer with chronic PaCO2 55 presenting with acute exacerbation to PaCO2 72 and measured HCO3 30:
    // Acute buffer = +1.7 mmol/L. Metabolic HCO3 = 30 - 1.7 = 28.3 mmol/L.
    const m = metabolicFromMeasured(30, 72, 55);
    expect(m).toBeCloseTo(28.3, 1);

    // Normal patient at PaCO2 40 with HCO3 24:
    expect(metabolicFromMeasured(24, 40, 40)).toBeCloseTo(24, 1);

    // Normal patient with acute respiratory acidosis to PaCO2 72, measured HCO3 27.2:
    // Acute buffer = +3.2 mmol/L. Metabolic HCO3 = 24.0.
    expect(metabolicFromMeasured(27.2, 72, 40)).toBeCloseTo(24.0, 1);
  });

  it('initialMetabolicHco3 returns metabolic component matching measured HCO3 or chronic baseline', () => {
    // With measured HCO3 provided:
    expect(initialMetabolicHco3(30, 72, 55)).toBeCloseTo(28.3, 1);
    // Without measured HCO3 provided:
    expect(initialMetabolicHco3(undefined, 72, 55)).toBeCloseTo(29.25, 2);
  });

  it('case-check expected starting HCO3 matches chronic retainer within 2.0 mmol/L', () => {
    const chronicPaco2 = 55;
    const initialPaco2 = 72;
    const initialHco3 = 30;
    const expected = (24 + 0.35 * Math.max(0, chronicPaco2 - 40)) + acuteBuffer(initialPaco2 - chronicPaco2, 24, 0);
    expect(expected).toBeCloseTo(30.95, 2);
    expect(Math.abs(initialHco3 - expected)).toBeLessThanOrEqual(2.0);
  });
});

describe('Fix 9: Non-rebreather dilution and reservoir mechanics', () => {
  const nrb15: DeviceSettings = { device: 'none', o2: 'non-rebreather', o2FlowLpm: 15 };

  it('at resting ventilation (PIF <= 60 L/min), non-rebreather does not dilute (nominal ~0.825)', () => {
    // PIF 30 L/min, VE 7 L/min
    const fio2 = effectiveFio2(nrb15, 30, 7);
    expect(fio2).toBeCloseTo(0.825, 2);
  });

  it('at elevated minute ventilation (VE 20 L/min, PIF 80 L/min), FiO2 is between 0.60 and 0.75 (0.55 to 0.80)', () => {
    // Wagstaff & Soni (2007) Br J Anaesth 99(5):426-434; BTS Guideline (2017)
    const fio2 = effectiveFio2(nrb15, 80, 20);
    expect(fio2).toBeGreaterThanOrEqual(0.60);
    expect(fio2).toBeLessThanOrEqual(0.75);
    expect(fio2).toBeGreaterThanOrEqual(0.55);
    expect(fio2).toBeLessThanOrEqual(0.80);
  });

  it('preserves nasal cannula and simple mask dilution rules (dilutes when VE > 10 L/min)', () => {
    const nc: DeviceSettings = { device: 'none', o2: 'nasal-cannula', o2FlowLpm: 4 };
    const sm: DeviceSettings = { device: 'none', o2: 'simple-mask', o2FlowLpm: 8 };

    // At VE 8 (<= 10): nominal
    expect(effectiveFio2(nc, 25, 8)).toBeCloseTo(0.37, 2);
    expect(effectiveFio2(sm, 25, 8)).toBeCloseTo(0.49, 2);

    // At VE 20 (> 10): diluted by factor 10/20 = 0.5
    const ncDiluted = effectiveFio2(nc, 60, 20);
    const smDiluted = effectiveFio2(sm, 60, 20);
    expect(ncDiluted).toBeCloseTo(0.21 + (0.37 - 0.21) * 0.5, 2);
    expect(smDiluted).toBeCloseTo(0.21 + (0.49 - 0.21) * 0.5, 2);
  });

  it('simulates non-rebreather in a tachypnoeic patient maintaining FiO2 between 0.55 and 0.80', () => {
    const patient: PatientParams = {
      sex: 'M', ageYears: 45, heightCm: 175, actualWeightKg: 75,
      complianceMlPerCmH2O: 50, inspResistanceCmH2OPerLps: 6, expResistanceCmH2OPerLps: 6,
      spontRateBpm: 34, pmusAmplitudeCmH2O: 24.0, pmusInspTimeSec: 0.8,
      vco2MlPerMin: 250, vo2MlPerMin: 300, anatomicDeadSpaceMl: 150, alveolarDeadSpaceFraction: 0.1,
      shuntFraction: 0.05, recruitability: 0.1, hbGPerDl: 14, temperatureC: 37,
      baselineHco3MmolL: 24, hrBaselineBpm: 95, sbpBaselineMmHg: 125, dbpBaselineMmHg: 80,
      ppvResponse: 'unhelpful', ppvSeverity: 0.1, respiratoryReserve: 1.0,
    };
    const s0 = engine.createState(patient, nrb15, { paco2MmHg: 40, hco3MmolL: 24 });
    const s = engine.fastForward(s0, 60);

    expect(s.monitored.fio2).toBeGreaterThanOrEqual(0.55);
    expect(s.monitored.fio2).toBeLessThanOrEqual(0.80);
  });
});
