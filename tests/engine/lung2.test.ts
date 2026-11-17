import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLOSING_PRESSURE_CMH2O,
  DEFAULT_OPENING_PRESSURE_CMH2O,
  DEFAULT_OVERDISTENSION_FALLOFF,
  DEFAULT_OVERDISTENSION_VOLUME_ML,
  DEFAULT_RECRUIT_COMPLIANCE_ML_PER_CMH2O,
  MIN_COMPLIANCE_ML_PER_CMH2O,
  analyzeTwoCompartment,
  effectiveCompliance,
  twoCompartmentDrivingPressure,
  twoCompartmentPalv,
} from '../../src/engine/lung2';
import { flowStep, relax } from '../../src/engine/mechanics';
import type { PatientParams } from '../../src/shared/engineTypes';

function basePatient(patch?: Partial<PatientParams>): PatientParams {
  return {
    sex: 'F',
    ageYears: 48,
    heightCm: 165,
    actualWeightKg: 65,
    complianceMlPerCmH2O: 28,
    inspResistanceCmH2OPerLps: 12,
    expResistanceCmH2OPerLps: 12,
    spontRateBpm: 0,
    pmusAmplitudeCmH2O: 0,
    pmusInspTimeSec: 1.0,
    vco2MlPerMin: 180,
    vo2MlPerMin: 220,
    anatomicDeadSpaceMl: 130,
    alveolarDeadSpaceFraction: 0.2,
    shuntFraction: 0.4,
    recruitability: 0.6,
    hbGPerDl: 12,
    temperatureC: 37,
    baselineHco3MmolL: 24,
    hrBaselineBpm: 95,
    sbpBaselineMmHg: 110,
    dbpBaselineMmHg: 65,
    ppvResponse: 'unhelpful',
    ppvSeverity: 0.3,
    respiratoryReserve: 0.8,
    ...patch,
  };
}

describe('Recruitable two-compartment lung model (lung2)', () => {
  describe('Backward compatibility', () => {
    it('returns patient.complianceMlPerCmH2O exactly when lungModel is undefined', () => {
      const p = basePatient();
      expect(effectiveCompliance(p)).toBe(28);
      expect(effectiveCompliance(p, 500, 14)).toBe(28);
      expect(effectiveCompliance(p, 1000, 22)).toBe(28);
    });

    it('returns patient.complianceMlPerCmH2O exactly when lungModel is single', () => {
      const p = basePatient({ lungModel: 'single' });
      expect(effectiveCompliance(p)).toBe(28);
      expect(effectiveCompliance(p, 500, 14)).toBe(28);
      expect(effectiveCompliance(p, 1000, 22)).toBe(28);
    });

    it('produces 0 recruited fraction and no overdistension in single-compartment analysis', () => {
      const p = basePatient({ lungModel: 'single' });
      const a = analyzeTwoCompartment(p, 500, 14);
      expect(a.cBase).toBe(28);
      expect(a.cRecruited).toBe(0);
      expect(a.cEff).toBe(28);
      expect(a.recruitedFraction).toBe(0);
      expect(a.isOverdistended).toBe(false);
      expect(a.overdistensionLoss).toBe(0);
    });
  });

  describe('Recruitment mechanics', () => {
    it('stays at baseline compliance when PEEP is at or below closing pressure (default 5 cmH2O)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const cPeep0 = effectiveCompliance(p, undefined, 0);
      const cPeep5 = effectiveCompliance(p, undefined, 5);

      expect(cPeep0).toBe(28);
      expect(cPeep5).toBe(28);

      const a5 = analyzeTwoCompartment(p, undefined, 5);
      expect(a5.recruitedFraction).toBe(0);
      expect(a5.cRecruited).toBe(0);
      expect(a5.cEff).toBe(28);
    });

    it('smoothly scales recruitment between closing pressure (5) and opening pressure (10)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const a7_5 = analyzeTwoCompartment(p, undefined, 7.5);

      expect(a7_5.recruitedFraction).toBe(0.5);
      expect(a7_5.cRecruited).toBe(7); // 14 * 0.5
      expect(a7_5.cEff).toBe(35); // 28 + 7
    });

    it('fully recruits at or above opening pressure (PEEP = 14 cmH2O)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const a14 = analyzeTwoCompartment(p, undefined, 14);

      expect(a14.recruitedFraction).toBe(1.0);
      expect(a14.cRecruited).toBe(14);
      expect(a14.cEff).toBe(42);
      expect(a14.isOverdistended).toBe(false);
    });

    it('lowers driving pressure at fixed VT (420 mL) from PEEP 5 to PEEP 14', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const dp5 = twoCompartmentDrivingPressure(p, 420, 5);
      const dp14 = twoCompartmentDrivingPressure(p, 420, 14);

      expect(dp5).toBe(15); // 420 / 28
      expect(dp14).toBe(10); // 420 / 42
      expect(dp14).toBeLessThan(dp5);
    });
  });

  describe('Overdistension mechanics', () => {
    it('does not overdistend at PEEP 14 (resting volume 588 mL <= 600 mL)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const a14 = analyzeTwoCompartment(p, undefined, 14);

      expect(a14.restingVolumeMl).toBe(588);
      expect(a14.isOverdistended).toBe(false);
      expect(a14.overdistensionLoss).toBe(0);
      expect(a14.cEff).toBe(42);
    });

    it('causes overdistension falloff at excessive PEEP = 22 cmH2O (volume 924 mL > 600 mL)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const a22 = analyzeTwoCompartment(p, undefined, 22);

      expect(a22.restingVolumeMl).toBe(924);
      expect(a22.isOverdistended).toBe(true);
      expect(a22.overdistensionLoss).toBeCloseTo((924 - 600) * DEFAULT_OVERDISTENSION_FALLOFF, 4);

      // Compliance drops from 42 to ~23.2 mL/cmH2O
      expect(a22.cEff).toBeCloseTo(42 - (924 - 600) * DEFAULT_OVERDISTENSION_FALLOFF, 2);
      expect(a22.cEff).toBeGreaterThanOrEqual(22);
      expect(a22.cEff).toBeLessThanOrEqual(25);
    });

    it('increases driving pressure at fixed VT (420 mL) from PEEP 14 to PEEP 22', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const dp14 = twoCompartmentDrivingPressure(p, 420, 14);
      const dp22 = twoCompartmentDrivingPressure(p, 420, 22);

      expect(dp14).toBe(10);
      expect(dp22).toBeGreaterThanOrEqual(16.5);
      expect(dp22).toBeGreaterThan(dp14);
    });

    it('respects the minimum compliance floor even under extreme pressures', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const cExtreme = effectiveCompliance(p, undefined, 60);

      expect(cExtreme).toBe(MIN_COMPLIANCE_ML_PER_CMH2O);
      expect(cExtreme).toBeGreaterThan(0);
      expect(Number.isFinite(cExtreme)).toBe(true);
    });
  });

  describe('Auditor benchmark compliance checks', () => {
    it('satisfies recruit-01: driving pressure at PEEP 14 < PEEP 5 and <= 13.0 cmH2O', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const dpPeep5 = twoCompartmentDrivingPressure(p, 420, 5);
      const dpPeep14 = twoCompartmentDrivingPressure(p, 420, 14);

      expect(dpPeep14).toBeLessThan(dpPeep5);
      expect(dpPeep14).toBeLessThanOrEqual(13.0);
      expect(dpPeep14).toBe(10.0);
    });

    it('satisfies recruit-02: driving pressure at PEEP 22 > PEEP 14 and >= 16.5 cmH2O', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const dpPeep14 = twoCompartmentDrivingPressure(p, 420, 14);
      const dpPeep22 = twoCompartmentDrivingPressure(p, 420, 22);

      expect(dpPeep22).toBeGreaterThan(dpPeep14);
      expect(dpPeep22).toBeGreaterThanOrEqual(16.5);
    });

    it('satisfies recruit-03: Pplat at PEEP 14 is <= 25.5 cmH2O (attenuation vs non-recruitable 29.0 cmH2O)', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      const analysis = analyzeTwoCompartment(p, undefined, 14);
      const pplatRecruitable = analysis.estimatedPplat(420, 14);

      // Recruitable lung: Pplat = 14 + 10.0 = 24.0 cmH2O <= 25.5 cmH2O
      expect(pplatRecruitable).toBeLessThanOrEqual(25.5);
      expect(pplatRecruitable).toBe(24.0);

      // Non-recruitable lung: Pplat = 14 + 15.0 = 29.0 cmH2O
      const pSingle = basePatient({ lungModel: 'single' });
      const pplatSingle = analyzeTwoCompartment(pSingle, undefined, 14).estimatedPplat(420, 14);
      expect(pplatSingle).toBe(29.0);
      expect(pplatRecruitable).toBeLessThan(pplatSingle);
    });
  });

  describe('Custom parameters in twoCompartmentParams', () => {
    it('respects custom openingPressureCmH2O and closingPressureCmH2O', () => {
      const p = basePatient({
        lungModel: 'two-compartment',
        twoCompartmentParams: {
          openingPressureCmH2O: 16,
          closingPressureCmH2O: 8,
        },
      });

      // At PEEP 8: derecruited
      expect(analyzeTwoCompartment(p, undefined, 8).recruitedFraction).toBe(0);
      // At PEEP 12: half recruited
      expect(analyzeTwoCompartment(p, undefined, 12).recruitedFraction).toBe(0.5);
      // At PEEP 16: fully recruited
      expect(analyzeTwoCompartment(p, undefined, 16).recruitedFraction).toBe(1.0);
    });

    it('respects custom recruitComplianceMlPerCmH2O', () => {
      const p = basePatient({
        lungModel: 'two-compartment',
        twoCompartmentParams: {
          recruitComplianceMlPerCmH2O: 22,
        },
      });

      // At PEEP 10: fully recruited (effPeep >= 10), resting vol 10 * 50 = 500 mL <= 600 mL (no overdistension)
      const a10 = analyzeTwoCompartment(p, undefined, 10);
      expect(a10.cRecruited).toBe(22);
      expect(a10.cEff).toBe(28 + 22); // 50 mL/cmH2O

      // At PEEP 14: resting vol 14 * 50 = 700 mL > 600 mL (overdistension loss = (700 - 600) * 0.058 = 5.8)
      const a14 = analyzeTwoCompartment(p, undefined, 14);
      expect(a14.cEff).toBeCloseTo(50 - 5.8, 1);
    });

    it('respects custom overdistensionVolumeMl and overdistensionFalloff', () => {
      const p = basePatient({
        lungModel: 'two-compartment',
        twoCompartmentParams: {
          overdistensionVolumeMl: 800,
          overdistensionFalloff: 0.1,
        },
      });

      // At PEEP 14, resting vol 588 <= 800: no overdistension
      expect(analyzeTwoCompartment(p, undefined, 14).isOverdistended).toBe(false);

      // At PEEP 22, resting vol 924 > 800: overdistension loss = (924 - 800) * 0.1 = 12.4
      const a22 = analyzeTwoCompartment(p, undefined, 22);
      expect(a22.isOverdistended).toBe(true);
      expect(a22.overdistensionLoss).toBeCloseTo(12.4, 4);
      expect(a22.cEff).toBeCloseTo(42 - 12.4, 4);
    });
  });

  describe('Mechanics integration helpers', () => {
    it('computes alveolar pressure via twoCompartmentPalv', () => {
      const p = basePatient({ lungModel: 'two-compartment' });
      // At PEEP 14 (C_eff = 42), volume 420 mL corresponds to Palv = 10 cmH2O
      const palv = twoCompartmentPalv(p, 420, 14);
      expect(palv).toBe(10);
    });

    it('flowStep in mechanics.ts uses dynamic effective compliance when two-compartment is enabled', () => {
      const pTwo = basePatient({ lungModel: 'two-compartment' });
      const pSingle = basePatient({ lungModel: 'single' });

      // In expiration at PEEP 14, starting from V0 = 600 mL, relaxed equilibrium should differ
      // Single: V_eq = 28 * 14 = 392 mL
      // Two-compartment: V_eq = 42 * 14 = 588 mL
      const vSingle = flowStep(pSingle, 600, 14, 0, pSingle.complianceMlPerCmH2O, 0.05);
      const vTwo = flowStep(pTwo, 600, 14, 0, pTwo.complianceMlPerCmH2O, 0.05);

      // Two-compartment lung empties towards 588 mL, so at 0.05 s it stays higher than single (which empties towards 392 mL)
      expect(vTwo).toBeGreaterThan(vSingle);
    });

    it('relax analytical solution is consistent with compliance and time constant', () => {
      const V0 = 500;
      const paw = 10;
      const pmus = 0;
      const R = 10;
      const C = 40;
      const dt = 0.005;

      const vNext = relax(V0, paw, pmus, R, C, dt);
      const veq = C * paw; // 400
      const tau = (R * C) / 1000; // 0.4 s
      const expected = veq + (V0 - veq) * Math.exp(-dt / tau);

      expect(vNext).toBeCloseTo(expected, 8);
    });
  });
});
