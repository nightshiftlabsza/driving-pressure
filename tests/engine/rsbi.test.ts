import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { metricOf } from '../../src/engine/metrics';
import type { PatientParams, InvasiveSettings } from '../../src/shared/engineTypes';

describe('RSBI (Rapid Shallow Breathing Index) metric (Yang & Tobin 1991)', () => {
  const basePatient: PatientParams = {
    sex: 'M',
    ageYears: 54,
    heightCm: 178,
    actualWeightKg: 80,
    complianceMlPerCmH2O: 50,
    inspResistanceCmH2OPerLps: 8,
    expResistanceCmH2OPerLps: 8,
    spontRateBpm: 0,
    pmusAmplitudeCmH2O: 0,
    pmusInspTimeSec: 0.8,
    vco2MlPerMin: 240,
    vo2MlPerMin: 300,
    anatomicDeadSpaceMl: 160,
    alveolarDeadSpaceFraction: 0.1,
    shuntFraction: 0.08,
    recruitability: 0.1,
    hbGPerDl: 14,
    temperatureC: 37,
    baselineHco3MmolL: 24,
    hrBaselineBpm: 80,
    sbpBaselineMmHg: 120,
    dbpBaselineMmHg: 80,
    ppvResponse: 'unhelpful',
    ppvSeverity: 0.1,
    respiratoryReserve: 0.6,
  };

  const psvDevice: InvasiveSettings = {
    device: 'invasive',
    mode: 'PSV',
    fio2: 0.3,
    peep: 5,
    rrSetBpm: 0,
    psAbovePeep: 5,
    triggerFlowLpm: 2,
  };

  it('computes spontaneous RR divided by VT in litres accurately', () => {
    const s = engine.createState(basePatient, psvDevice);
    s.monitored.rrSpontBpm = 20;
    s.monitored.rrTotalBpm = 20;
    s.monitored.vteMl = 500; // 0.5 L

    // 20 bpm / 0.5 L = 40 bpm/L (favourable, < 105)
    expect(metricOf(s, 'rsbi')).toBeCloseTo(40, 2);
  });

  it('detects rapid shallow breathing (> 105 bpm/L) during SBT failure', () => {
    const s = engine.createState(basePatient, psvDevice);
    s.monitored.rrSpontBpm = 32;
    s.monitored.rrTotalBpm = 32;
    s.monitored.vteMl = 250; // 0.25 L

    // 32 bpm / 0.25 L = 128 bpm/L (> 105, SBT failure)
    const rsbi = metricOf(s, 'rsbi');
    expect(rsbi).toBeCloseTo(128, 2);
    expect(rsbi!).toBeGreaterThan(105);
  });

  it('handles edge cases: null or zero VTe returns null', () => {
    const s1 = engine.createState(basePatient, psvDevice);
    s1.monitored.rrSpontBpm = 20;
    s1.monitored.vteMl = null;
    expect(metricOf(s1, 'rsbi')).toBeNull();

    const s2 = engine.createState(basePatient, psvDevice);
    s2.monitored.rrSpontBpm = 20;
    s2.monitored.vteMl = 0;
    expect(metricOf(s2, 'rsbi')).toBeNull();
  });

  it('returns 0 when spontaneous rate is 0 in passive patient', () => {
    const s = engine.createState(basePatient, {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.4,
      peep: 5,
      rrSetBpm: 16,
      vtSetMl: 450,
      inspFlowLpm: 60,
    });
    s.patient.spontRateBpm = 0;
    s.monitored.rrSpontBpm = 0;
    s.monitored.rrTotalBpm = 16;
    s.monitored.vteMl = 450;
    expect(metricOf(s, 'rsbi')).toBe(0);
  });

  it('computes rsbi from live engine state during a spontaneous breathing run', () => {
    const spontPatient: PatientParams = {
      ...basePatient,
      spontRateBpm: 20,
      pmusAmplitudeCmH2O: 6,
      pmusInspTimeSec: 0.8,
    };

    let s = engine.createState(spontPatient, psvDevice);

    // Advance 30 seconds to let breaths log and monitor values stabilise
    for (let sec = 0; sec < 30; sec++) {
      const res = engine.step(s, 1.0);
      s = res.state;
    }

    const rsbi = metricOf(s, 'rsbi');
    expect(rsbi).not.toBeNull();
    // Normal spontaneous breathing with effort should have a reasonable RSBI (between 15 and 90)
    expect(rsbi!).toBeGreaterThan(15);
    expect(rsbi!).toBeLessThan(90);
  });
});
