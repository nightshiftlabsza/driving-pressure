import { describe, it, expect } from 'vitest';
import {
  partitionCompliance,
  esophagealPressure,
  transpulmonaryPressure,
  estimateP01,
  estimateDeltaPocc,
  estimatePmusFromDeltaPocc,
} from '../../src/engine/effort';
import { engine } from '../../src/engine/index';
import type { PatientParams, InvasiveSettings } from '../../src/shared/engineTypes';

describe('Effort monitoring & advanced mechanics (Deliverable 3)', () => {
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
    hrBaselineBpm: 96,
    sbpBaselineMmHg: 130,
    dbpBaselineMmHg: 80,
    ppvResponse: 'unhelpful',
    ppvSeverity: 0.1,
    respiratoryReserve: 0.6,
  };

  const baseDevice: InvasiveSettings = {
    device: 'invasive',
    mode: 'VC-AC',
    fio2: 0.4,
    peep: 5,
    rrSetBpm: 15,
    vtSetMl: 500,
    inspFlowLpm: 60,
  };

  describe('Compliance partitioning', () => {
    it('defaults chest wall compliance to twice respiratory system compliance', () => {
      const p = { ...basePatient, complianceMlPerCmH2O: 40 };
      const partition = partitionCompliance(p);
      expect(partition.C_rs).toBe(40);
      expect(partition.C_cw).toBe(80);
      // 1/C_l = 1/40 - 1/80 = 1/80 => C_l = 80
      expect(Math.round(partition.C_l)).toBe(80);
    });

    it('partitions compliance accurately with explicit chest wall compliance', () => {
      // Benchmark 03: stiff chest wall (C_rs = 18, C_cw = 35)
      const p = {
        ...basePatient,
        complianceMlPerCmH2O: 18,
        chestWallComplianceMlPerCmH2O: 35,
      };
      const partition = partitionCompliance(p);
      expect(partition.C_rs).toBe(18);
      expect(partition.C_cw).toBe(35);
      // 1/C_l = 1/18 - 1/35 = 17 / 630 => C_l ≈ 37.06
      expect(partition.C_l).toBeCloseTo(37.06, 1);
    });
  });

  describe('Esophageal and Transpulmonary Pressures', () => {
    it('computes positive Pes during passive volume expansion', () => {
      const Ccw = 100;
      const volumeMl = 500;
      const pes = esophagealPressure(volumeMl, Ccw, 0);
      expect(pes).toBe(5.0); // 500 / 100 = 5 cmH2O
    });

    it('shows muscular effort pulls Pes downward during inspiration', () => {
      const Ccw = 100;
      const volumeMl = 300;
      const pmus = 10.0;
      // Pes = 300 / 100 - 10 = 3 - 10 = -7 cmH2O
      const pes = esophagealPressure(volumeMl, Ccw, pmus);
      expect(pes).toBe(-7.0);
    });

    it('computes transpulmonary pressure as PL = Paw - Pes', () => {
      const paw = 25.0;
      const pes = 10.0;
      const pl = transpulmonaryPressure(paw, pes);
      expect(pl).toBe(15.0);
    });
  });

  describe('P0.1 Neuromuscular Drive Marker (Telias 2018)', () => {
    it('produces normal resting values (1.0 - 2.0 cmH2O) at resting drive', () => {
      const p01 = estimateP01(5.0, 12);
      expect(p01).toBeGreaterThanOrEqual(1.0);
      expect(p01).toBeLessThanOrEqual(2.0);
    });

    it('produces elevated P0.1 >= 3.5 cmH2O with excessive drive (Pmus = 16, spontRate = 26)', () => {
      // Benchmark 01 condition
      const p01 = estimateP01(16.0, 26);
      expect(p01).toBeGreaterThanOrEqual(3.5);
    });

    it('returns 0 when patient has no effort', () => {
      expect(estimateP01(0, 0)).toBe(0);
      expect(estimateP01(10, 0)).toBe(0);
      expect(estimateP01(0, 20)).toBe(0);
    });
  });

  describe('End-expiratory Occlusion Manoeuvre (Bertoni 2019)', () => {
    it('estimates Delta Pocc proportional to Pmus / 0.75 (Delta Pocc >= 18 cmH2O when Pmus = 16)', () => {
      // Benchmark 02 condition
      const deltaPocc = estimateDeltaPocc(16.0);
      expect(deltaPocc).toBeGreaterThanOrEqual(18.0);
      expect(deltaPocc).toBeCloseTo(21.3, 1);
    });

    it('inverts Delta Pocc to recover estimated Pmus and transpulmonary driving pressure', () => {
      const deltaPocc = 21.3;
      const pmusEst = estimatePmusFromDeltaPocc(deltaPocc);
      expect(pmusEst).toBeCloseTo(16.0, 1);
    });
  });

  describe('Engine Integration: Monitored Values & Benchmarks', () => {
    it('satisfies Benchmark 01: P0.1 >= 3.5 cmH2O in high drive patient', () => {
      const p: PatientParams = {
        ...basePatient,
        spontRateBpm: 26,
        pmusAmplitudeCmH2O: 16.0,
        pmusInspTimeSec: 0.8,
      };
      const d: InvasiveSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 8,
      };

      const s = engine.createState(p, d, { paco2MmHg: 38, pao2MmHg: 85 });
      const finalState = engine.fastForward(s, 60);

      expect(finalState.monitored.p01CmH2O).toBeDefined();
      expect(finalState.monitored.p01CmH2O!).toBeGreaterThanOrEqual(3.5);
    });

    it('satisfies Benchmark 02: Delta Pocc >= 18.0 cmH2O with Pmus 16 cmH2O', () => {
      const p: PatientParams = {
        ...basePatient,
        spontRateBpm: 24,
        pmusAmplitudeCmH2O: 16.0,
        pmusInspTimeSec: 0.8,
      };
      const d: InvasiveSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 8,
      };

      const s = engine.createState(p, d, { paco2MmHg: 38, pao2MmHg: 85 });
      const finalState = engine.fastForward(s, 60);

      expect(finalState.monitored.deltaPoccCmH2O).toBeDefined();
      expect(finalState.monitored.deltaPoccCmH2O!).toBeGreaterThanOrEqual(18.0);
    });

    it('satisfies Benchmark 03: PL,end-insp <= 16.0 cmH2O with stiff chest wall (C_cw = 35, C_rs = 18)', () => {
      const p: PatientParams = {
        ...basePatient,
        complianceMlPerCmH2O: 18,
        chestWallComplianceMlPerCmH2O: 35,
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
      };
      const d: InvasiveSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.5,
        peep: 8,
        rrSetBpm: 16,
        vtSetMl: 360,
        inspFlowLpm: 50,
      };

      const s = engine.createState(p, d, { paco2MmHg: 42, pao2MmHg: 80 });
      const finalState = engine.fastForward(s, 60);

      expect(finalState.monitored.plEndInspCmH2O).toBeDefined();
      expect(finalState.monitored.plEndInspCmH2O!).toBeLessThanOrEqual(16.0);
      expect(finalState.monitored.plEndInspCmH2O!).toBeGreaterThan(5.0);
    });

    it('executes occlusion manoeuvre via engine.startManoeuvre and sets lastManoeuvre', () => {
      const p: PatientParams = {
        ...basePatient,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
      };
      const d: InvasiveSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 6,
      };

      let s = engine.createState(p, d);
      s = engine.startManoeuvre(s, { kind: 'occlusion', maxSec: 4 });
      const finalState = engine.fastForward(s, 5);

      expect(finalState.lastManoeuvre).toBeDefined();
      expect(finalState.lastManoeuvre?.kind).toBe('occlusion');
      expect(finalState.lastManoeuvre?.valid).toBe(true);
      expect(finalState.lastManoeuvre?.deltaPoccCmH2O).toBeGreaterThan(0);
      expect(finalState.lastManoeuvre?.pmusEstimatedCmH2O).toBeGreaterThan(0);
      expect(finalState.lastManoeuvre?.deltaPlDynEstimatedCmH2O).toBeGreaterThan(0);
    });

    it('annotates waveform samples with Pes and PL during step', () => {
      const s = engine.createState(basePatient, baseDevice);
      const res = engine.step(s, 1.0);

      expect(res.samples.length).toBeGreaterThan(0);
      const sample = res.samples[0];
      expect(sample.pesCmH2O).toBeDefined();
      expect(sample.plCmH2O).toBeDefined();
      expect(typeof sample.pesCmH2O).toBe('number');
      expect(typeof sample.plCmH2O).toBe('number');
    });
  });
});
