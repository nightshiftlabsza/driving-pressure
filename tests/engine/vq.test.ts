import { describe, it, expect } from 'vitest';
import { arterialPo2, alveolarPo2, o2Content } from '../../src/engine/gas';
import { calculateVqArterialPo2 } from '../../src/engine/vq';
import { engine } from '../../src/engine/index';
import type { PatientParams, DeviceSettings } from '../../src/shared/engineTypes';

describe('V/Q mismatch (Riley three-compartment model)', () => {
  const normalPatientOpts = {
    fio2: 0.21,
    paco2: 40,
    shunt: 0.0,
    hb: 14,
    vo2: 250,
    coLpm: 5,
    ph: 7.4,
    tempC: 37,
  };

  it('matches single-compartment shunt equation 100% when lowVqFraction is undefined or 0', () => {
    const withUndefined = arterialPo2({ ...normalPatientOpts, shunt: 0.15 });
    const withZero = arterialPo2({ ...normalPatientOpts, shunt: 0.15, lowVqFraction: 0 });
    const baseline = arterialPo2({ ...normalPatientOpts, shunt: 0.15 });

    expect(withUndefined).toBe(baseline);
    expect(withZero).toBe(baseline);
  });

  it('produces room-air hypoxemia (PaO2 <= 65 mmHg) with 55% low V/Q and 0 shunt (Benchmark 1)', () => {
    // Benchmark vq-01-low-vq-fio2-response spec
    const po2Normal = arterialPo2({
      ...normalPatientOpts,
      fio2: 0.21,
      shunt: 0.0,
      lowVqFraction: 0.0,
    });
    const po2LowVq = arterialPo2({
      ...normalPatientOpts,
      fio2: 0.21,
      shunt: 0.0,
      lowVqFraction: 0.55,
      lowVqRatio: 0.1,
    });

    expect(po2Normal).toBeGreaterThan(95); // ~99.7 mmHg
    expect(po2LowVq).toBeLessThanOrEqual(65.0); // ~40.3 mmHg
    expect(po2LowVq).toBeGreaterThan(30.0);
  });

  it('restrains arterial PaO2 below 100 mmHg at moderate FiO2 0.35 (Benchmark 2)', () => {
    // Benchmark vq-02-low-vq-vs-shunt spec
    const po2Normal = arterialPo2({
      ...normalPatientOpts,
      fio2: 0.35,
      shunt: 0.0,
      lowVqFraction: 0.0,
    });
    const po2LowVq = arterialPo2({
      ...normalPatientOpts,
      fio2: 0.35,
      shunt: 0.0,
      lowVqFraction: 0.55,
      lowVqRatio: 0.1,
    });

    expect(po2Normal).toBeGreaterThan(180); // ~199 mmHg
    expect(po2LowVq).toBeLessThanOrEqual(100.0); // ~50.8 mmHg
  });

  it('washes out nitrogen at FiO2 1.0 causing steep rise (> 400 mmHg), contrasting sharply with refractory shunt', () => {
    // In low V/Q (0.55 lowVq, 0 shunt), FiO2 1.0 eliminates nitrogen and abolishes hypoxemia
    const po2LowVqFiO2_1 = arterialPo2({
      ...normalPatientOpts,
      fio2: 1.0,
      shunt: 0.0,
      lowVqFraction: 0.55,
      lowVqRatio: 0.1,
    });

    // In true shunt (0 lowVq, 0.55 shunt), FiO2 1.0 cannot reach unventilated blood
    const po2ShuntFiO2_1 = arterialPo2({
      ...normalPatientOpts,
      fio2: 1.0,
      shunt: 0.55,
      lowVqFraction: 0.0,
    });

    expect(po2LowVqFiO2_1).toBeGreaterThan(400); // ~669 mmHg
    expect(po2ShuntFiO2_1).toBeLessThan(50); // ~42 mmHg
  });

  it('exhibits strictly monotonic FiO2 responsiveness', () => {
    const fio2s = [0.21, 0.30, 0.40, 0.50, 0.60, 0.80, 1.0];
    const po2s = fio2s.map(fio2 =>
      arterialPo2({
        ...normalPatientOpts,
        fio2,
        lowVqFraction: 0.55,
        lowVqRatio: 0.1,
      })
    );

    for (let i = 1; i < po2s.length; i++) {
      expect(po2s[i]).toBeGreaterThan(po2s[i - 1]);
    }
  });

  it('exhibits monotonic worsening with increasing lowVqFraction', () => {
    const fractions = [0.0, 0.2, 0.4, 0.6, 0.8];
    const po2s = fractions.map(lowVqFraction =>
      arterialPo2({
        ...normalPatientOpts,
        fio2: 0.21,
        lowVqFraction,
        lowVqRatio: 0.1,
      })
    );

    for (let i = 1; i < po2s.length; i++) {
      expect(po2s[i]).toBeLessThan(po2s[i - 1]);
    }
  });

  it('exhibits improved oxygenation as lowVqRatio improves toward ideal', () => {
    const ratios = [0.02, 0.05, 0.1, 0.2, 0.5];
    const po2s = ratios.map(lowVqRatio =>
      arterialPo2({
        ...normalPatientOpts,
        fio2: 0.21,
        lowVqFraction: 0.5,
        lowVqRatio,
      })
    );

    for (let i = 1; i < po2s.length; i++) {
      expect(po2s[i]).toBeGreaterThan(po2s[i - 1]);
    }
  });

  it('handles combined shunt and low V/Q realistically', () => {
    // 20% true shunt + 40% low V/Q
    const mixed = arterialPo2({
      ...normalPatientOpts,
      fio2: 1.0,
      shunt: 0.20,
      lowVqFraction: 0.40,
      lowVqRatio: 0.1,
    });

    // At FiO2 1.0, low V/Q is oxygenated, but 20% shunt caps PaO2 well below 400
    expect(mixed).toBeGreaterThan(100);
    expect(mixed).toBeLessThan(350);
  });

  it('integrates cleanly with engine fastForward for benchmark 1 patient', () => {
    const patient: PatientParams = {
      sex: 'M',
      ageYears: 62,
      heightCm: 172,
      actualWeightKg: 70,
      complianceMlPerCmH2O: 45,
      inspResistanceCmH2OPerLps: 10,
      expResistanceCmH2OPerLps: 12,
      spontRateBpm: 0,
      pmusAmplitudeCmH2O: 0,
      pmusInspTimeSec: 1.0,
      vco2MlPerMin: 200,
      vo2MlPerMin: 250,
      anatomicDeadSpaceMl: 150,
      alveolarDeadSpaceFraction: 0.15,
      shuntFraction: 0.0,
      recruitability: 0.0,
      hbGPerDl: 14,
      temperatureC: 37,
      baselineHco3MmolL: 24,
      hrBaselineBpm: 85,
      sbpBaselineMmHg: 125,
      dbpBaselineMmHg: 78,
      ppvResponse: 'unhelpful',
      ppvSeverity: 0.2,
      respiratoryReserve: 0.8,
      lowVqFraction: 0.55,
      lowVqRatio: 0.1,
    };

    const device: DeviceSettings = {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.21,
      peep: 5,
      rrSetBpm: 15,
      vtSetMl: 480,
      inspFlowLpm: 60,
      flowPattern: 'square',
    };

    const state = engine.createState(patient, device, { paco2MmHg: 40, pao2MmHg: 60 });
    const finalState = engine.fastForward(state, 60);

    expect(finalState.phys.pao2MmHg).toBeLessThanOrEqual(65.0);
  });

  it('integrates cleanly with engine fastForward for benchmark 2 patient', () => {
    const patient: PatientParams = {
      sex: 'M',
      ageYears: 62,
      heightCm: 172,
      actualWeightKg: 70,
      complianceMlPerCmH2O: 45,
      inspResistanceCmH2OPerLps: 10,
      expResistanceCmH2OPerLps: 12,
      spontRateBpm: 0,
      pmusAmplitudeCmH2O: 0,
      pmusInspTimeSec: 1.0,
      vco2MlPerMin: 200,
      vo2MlPerMin: 250,
      anatomicDeadSpaceMl: 150,
      alveolarDeadSpaceFraction: 0.15,
      shuntFraction: 0.0,
      recruitability: 0.0,
      hbGPerDl: 14,
      temperatureC: 37,
      baselineHco3MmolL: 24,
      hrBaselineBpm: 85,
      sbpBaselineMmHg: 125,
      dbpBaselineMmHg: 78,
      ppvResponse: 'unhelpful',
      ppvSeverity: 0.2,
      respiratoryReserve: 0.8,
      lowVqFraction: 0.55,
      lowVqRatio: 0.1,
    };

    const device: DeviceSettings = {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.35,
      peep: 5,
      rrSetBpm: 15,
      vtSetMl: 480,
      inspFlowLpm: 60,
      flowPattern: 'square',
    };

    const state = engine.createState(patient, device, { paco2MmHg: 40, pao2MmHg: 80 });
    const finalState = engine.fastForward(state, 60);

    expect(finalState.phys.pao2MmHg).toBeLessThanOrEqual(100.0);
  });

  it('is robust to extreme boundaries (no NaN or infinity)', () => {
    const extremeCases = [
      { lowVqFraction: 0.95, lowVqRatio: 0.01, shunt: 0.0, coLpm: 1.0 },
      { lowVqFraction: 0.5, lowVqRatio: 0.01, shunt: 0.45, coLpm: 12.0 },
      { lowVqFraction: 0.99, lowVqRatio: 0.1, shunt: 0.9, coLpm: 5.0 },
      { lowVqFraction: 0.1, lowVqRatio: 1.0, shunt: 0.0, coLpm: 0.5 },
    ];

    for (const ec of extremeCases) {
      const res = calculateVqArterialPo2({
        ...normalPatientOpts,
        ...ec,
      });
      expect(Number.isFinite(res)).toBe(true);
      expect(res).toBeGreaterThan(0);
      expect(res).toBeLessThanOrEqual(700);
    }
  });
});
