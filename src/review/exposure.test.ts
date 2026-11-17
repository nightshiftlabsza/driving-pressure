import { describe, it, expect } from 'vitest';
import { computeExposureLedger, DEFAULT_EXPOSURE_RULES } from './exposure';
import type { MetricPoint } from './types';

function createPoint(simTimeSec: number, overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    simTimeSec,
    spo2: 95,
    paco2: 40,
    pao2: 85,
    ph: 7.4,
    pplat: 22,
    drivingPressure: 12,
    ppeak: 25,
    peep: 10,
    vte: 420,
    vteMlKgPbw: 6.2,
    fio2: 0.5,
    map: 80,
    hr: 82,
    rrTotal: 16,
    pfRatio: 170,
    ...overrides,
  };
}

describe('Exposure Ledger', () => {
  it('every default exposure rule provides a verifiable clinical source citation', () => {
    expect(DEFAULT_EXPOSURE_RULES.length).toBeGreaterThanOrEqual(5);
    for (const rule of DEFAULT_EXPOSURE_RULES) {
      expect(rule.source).toBeTruthy();
      expect(rule.source.length).toBeGreaterThan(15);
      expect(rule.name).toBeTruthy();
      expect(rule.metric).toBeTruthy();
    }
  });

  it('correctly integrates time above Pplat > 30 cmH2O', () => {
    // 0 to 600s (10 min) with Pplat 34, then 600 to 1200s (10 min) with Pplat 26
    const series: MetricPoint[] = [
      createPoint(0, { pplat: 34 }),
      createPoint(300, { pplat: 34 }),
      createPoint(600, { pplat: 34 }),
      createPoint(900, { pplat: 26 }),
      createPoint(1200, { pplat: 26 }),
    ];

    const ledger = computeExposureLedger(series);
    const pplatEntry = ledger.find(e => e.ruleId === 'pplat_over_30');

    expect(pplatEntry).toBeDefined();
    // 0 to 600s is 10 min. At 600s (34) to 900s (26), one boundary is active -> 2.5 min trapezoidal
    expect(pplatEntry!.durationSimMinutes).toBeGreaterThanOrEqual(10.0);
    expect(pplatEntry!.maxObservedValue).toBe(34);
  });

  it('correctly tracks driving pressure > 15 cmH2O exposure', () => {
    const series: MetricPoint[] = [
      createPoint(0, { drivingPressure: 18 }),
      createPoint(600, { drivingPressure: 18 }),
      createPoint(1200, { drivingPressure: 12 }),
    ];

    const ledger = computeExposureLedger(series);
    const dpEntry = ledger.find(e => e.ruleId === 'driving_pressure_over_15');

    expect(dpEntry).toBeDefined();
    expect(dpEntry!.durationSimMinutes).toBeGreaterThanOrEqual(10.0);
    expect(dpEntry!.maxObservedValue).toBe(18);
  });

  it('evaluates secondary condition for hyperoxia (FiO2 > 0.6 while SpO2 > 96%)', () => {
    // Phase 1: High FiO2 (0.8) but SpO2 is 92% (not hyperoxic, secondary fails)
    // Phase 2: High FiO2 (0.8) and SpO2 is 99% (hyperoxic, both hold)
    const series: MetricPoint[] = [
      createPoint(0, { fio2: 0.8, spo2: 92 }),
      createPoint(300, { fio2: 0.8, spo2: 92 }),
      createPoint(300, { fio2: 0.8, spo2: 99 }),
      createPoint(600, { fio2: 0.8, spo2: 99 }),
      createPoint(900, { fio2: 0.8, spo2: 99 }),
      createPoint(1200, { fio2: 0.4, spo2: 95 }),
    ];

    const ledger = computeExposureLedger(series);
    const hyperoxia = ledger.find(e => e.ruleId === 'hyperoxia_fio2_over_60_spo2_over_96');

    expect(hyperoxia).toBeDefined();
    // Phase 2 from 300 to 900 is 10 min
    expect(hyperoxia!.durationSimMinutes).toBeGreaterThanOrEqual(10.0);
  });

  it('correctly detects severe hypoxaemia (SpO2 < 88%)', () => {
    const series: MetricPoint[] = [
      createPoint(0, { spo2: 82 }),
      createPoint(300, { spo2: 84 }),
      createPoint(600, { spo2: 91 }),
      createPoint(900, { spo2: 94 }),
    ];

    const ledger = computeExposureLedger(series);
    const hypox = ledger.find(e => e.ruleId === 'hypoxaemia_spo2_under_88');

    expect(hypox).toBeDefined();
    expect(hypox!.durationSimMinutes).toBeGreaterThan(4.0);
    expect(hypox!.minObservedValue).toBe(82);
  });

  it('returns clean zero entries for empty or single point inputs', () => {
    const emptyLedger = computeExposureLedger([]);
    expect(emptyLedger).toHaveLength(DEFAULT_EXPOSURE_RULES.length);
    for (const entry of emptyLedger) {
      expect(entry.durationSimMinutes).toBe(0);
      expect(entry.maxObservedValue).toBeNull();
    }

    const singleLedger = computeExposureLedger([createPoint(0, { pplat: 38 })]);
    expect(singleLedger[0].durationSimMinutes).toBe(0);
  });
});
