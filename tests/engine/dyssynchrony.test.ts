import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { metricOf } from '../../src/engine/metrics';
import {
  checkAutoTrigger,
  checkDelayedCycling,
  checkDoubleTrigger,
  checkFlowStarvation,
  checkPrematureCycling,
  checkReverseTrigger,
  reverseTriggerPmus,
} from '../../src/engine/dyssynchrony';
import { I } from '../../src/engine/types';
import type { DeviceSettings, PatientParams, PhysState } from '../../src/shared/engineTypes';

function makeBasePatient(patch: Partial<PatientParams> = {}): PatientParams {
  return {
    sex: 'M',
    ageYears: 50,
    heightCm: 175,
    actualWeightKg: 75,
    complianceMlPerCmH2O: 50,
    inspResistanceCmH2OPerLps: 8,
    expResistanceCmH2OPerLps: 8,
    spontRateBpm: 16,
    pmusAmplitudeCmH2O: 8,
    pmusInspTimeSec: 1.0,
    vco2MlPerMin: 200,
    vo2MlPerMin: 250,
    anatomicDeadSpaceMl: 150,
    alveolarDeadSpaceFraction: 0.1,
    shuntFraction: 0.1,
    recruitability: 0.1,
    hbGPerDl: 14,
    temperatureC: 37,
    baselineHco3MmolL: 24,
    hrBaselineBpm: 80,
    sbpBaselineMmHg: 120,
    dbpBaselineMmHg: 75,
    ppvResponse: 'unhelpful',
    ppvSeverity: 0.1,
    respiratoryReserve: 0.7,
    ...patch,
  };
}

describe('Dyssynchrony Mechanisms and State Tracking', () => {
  describe('Double triggering (Thille 2006, de Wit 2009)', () => {
    it('detects double triggering when neural Ti exceeds ventilator Ti and effort is high', () => {
      const patient = makeBasePatient({
        spontRateBpm: 18,
        pmusAmplitudeCmH2O: 16.0,
        pmusInspTimeSec: 1.4,
        complianceMlPerCmH2O: 40,
        inspResistanceCmH2OPerLps: 8,
        expResistanceCmH2OPerLps: 8,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 14,
        vtSetMl: 350,
        inspFlowLpm: 60,
        flowPattern: 'square',
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const doubleTriggerCount = metricOf(sEnd, 'doubleTriggerCount');
      expect(doubleTriggerCount).not.toBeNull();
      expect(doubleTriggerCount).toBeGreaterThanOrEqual(3);
    });

    it('flags doubleTriggered on the breath summary during double-triggered breaths', () => {
      const patient = makeBasePatient({
        spontRateBpm: 18,
        pmusAmplitudeCmH2O: 16.0,
        pmusInspTimeSec: 1.4,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 14,
        vtSetMl: 350,
        inspFlowLpm: 60,
      };

      const s0 = engine.createState(patient, device);
      const res = engine.step(s0, 10);
      const hasDoubleTriggeredBreath = res.breaths.some(b => b.doubleTriggered === true);
      expect(hasDoubleTriggeredBreath).toBe(true);
    });

    it('does not trigger double breaths when patient effort is weak or absent', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 14,
        vtSetMl: 350,
        inspFlowLpm: 60,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 30);
      expect(metricOf(sEnd, 'doubleTriggerCount')).toBe(0);
    });
  });

  describe('Premature cycling in PSV (Tassaux 2005)', () => {
    it('detects premature cycling when cycleOffPct is excessively high (50%)', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 55,
        inspResistanceCmH2OPerLps: 16,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
        pmusInspTimeSec: 1.1,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 50,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const count = metricOf(sEnd, 'prematureCycleCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('flags prematureCycled on breath summaries with premature termination', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 55,
        inspResistanceCmH2OPerLps: 16,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
        pmusInspTimeSec: 1.1,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 50,
      };

      const s0 = engine.createState(patient, device);
      const res = engine.step(s0, 10);
      const prematureBreaths = res.breaths.filter(b => b.prematureCycled === true);
      expect(prematureBreaths.length).toBeGreaterThan(0);
    });
  });

  describe('Delayed cycling in PSV (Yamada & Du 2000, Tassaux 2005)', () => {
    it('detects delayed cycling when cycleOffPct is excessively low (5%) in obstructive lung', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 55,
        inspResistanceCmH2OPerLps: 16,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
        pmusInspTimeSec: 0.8,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 5,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const count = metricOf(sEnd, 'delayedCycleCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('flags delayedCycled on breath summaries when inspiration outlasts neural Ti', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 55,
        inspResistanceCmH2OPerLps: 16,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
        pmusInspTimeSec: 0.8,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 5,
      };

      const s0 = engine.createState(patient, device);
      const res = engine.step(s0, 15);
      const delayedBreaths = res.breaths.filter(b => b.delayedCycled === true);
      expect(delayedBreaths.length).toBeGreaterThan(0);
    });

    it('does not flag delayed cycling when cycleOffPct is appropriately set (25%)', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 55,
        inspResistanceCmH2OPerLps: 16,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 20,
        pmusAmplitudeCmH2O: 12.0,
        pmusInspTimeSec: 0.8,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 25,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 30);
      expect(metricOf(sEnd, 'delayedCycleCount')).toBe(0);
    });
  });

  describe('Flow starvation in VC-AC (Marini 1986, MacIntyre 2011)', () => {
    it('detects flow starvation when set flow is far below demand flow with high effort', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 50,
        inspResistanceCmH2OPerLps: 8,
        expResistanceCmH2OPerLps: 8,
        spontRateBpm: 24,
        pmusAmplitudeCmH2O: 18.0,
        pmusInspTimeSec: 0.9,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        vtSetMl: 450,
        inspFlowLpm: 25,
        flowPattern: 'square',
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const count = metricOf(sEnd, 'flowStarvationCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('does not detect flow starvation when set flow is adequate for demand', () => {
      const patient = makeBasePatient({
        complianceMlPerCmH2O: 50,
        spontRateBpm: 24,
        pmusAmplitudeCmH2O: 18.0,
        pmusInspTimeSec: 0.9,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        vtSetMl: 450,
        inspFlowLpm: 75,
        flowPattern: 'square',
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 30);
      expect(metricOf(sEnd, 'flowStarvationCount')).toBe(0);
    });
  });

  describe('Auto-triggering from circuit leak (Imanaka 2000)', () => {
    it('produces runaway auto-triggering when invasive leak exceeds trigger threshold in apnoea', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        pmusInspTimeSec: 1.0,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 10,
        vtSetMl: 450,
        inspFlowLpm: 55,
        flowPattern: 'square',
        triggerFlowLpm: 2.0,
        circuitLeakLpm: 8.0,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const count = metricOf(sEnd, 'autoTriggerCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(10);
    });

    it('does not auto-trigger when circuit leak is below trigger threshold', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.35,
        peep: 5,
        rrSetBpm: 10,
        vtSetMl: 450,
        inspFlowLpm: 55,
        triggerFlowLpm: 2.0,
        circuitLeakLpm: 1.0,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 30);
      expect(metricOf(sEnd, 'autoTriggerCount')).toBe(0);
    });
  });

  describe('Reverse triggering rule-based model (Akoumianaki 2013)', () => {
    it('entrains diaphragmatic contractions in passive patient with reverseTriggerProbability > 0', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        pmusInspTimeSec: 1.0,
        reverseTriggerProbability: 0.4,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 16,
        vtSetMl: 450,
        inspFlowLpm: 55,
        flowPattern: 'square',
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 60);

      const count = metricOf(sEnd, 'reverseTriggerCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('does not reverse trigger when reverseTriggerProbability is zero or omitted', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        reverseTriggerProbability: 0,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 16,
        vtSetMl: 450,
        inspFlowLpm: 55,
      };

      const s0 = engine.createState(patient, device);
      const sEnd = engine.fastForward(s0, 30);
      expect(metricOf(sEnd, 'reverseTriggerCount')).toBe(0);
    });
  });

  describe('Pure helper unit tests (dyssynchrony.ts)', () => {
    it('checkAutoTrigger: true only when invasive and circuitLeak > triggerFlow with canPatientTrigger', () => {
      const patient = makeBasePatient();
      const device1: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        circuitLeakLpm: 5,
        triggerFlowLpm: 2,
      };
      const s1 = engine.createState(patient, device1);
      expect(checkAutoTrigger(s1, true)).toBe(true);
      expect(checkAutoTrigger(s1, false)).toBe(false);

      const device2: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        circuitLeakLpm: 1.5,
        triggerFlowLpm: 2,
      };
      const s2 = engine.createState(patient, device2);
      expect(checkAutoTrigger(s2, true)).toBe(false);
    });

    it('checkPrematureCycling: true only in PSV when tIn < pmusInspTimeSec and active Pmus', () => {
      const patient = makeBasePatient({ pmusInspTimeSec: 1.2, spontRateBpm: 15, pmusAmplitudeCmH2O: 10 });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
      };
      const s = engine.createState(patient, device);
      I(s).control = 'ps';

      // Premature: tIn = 0.5s < 1.2s, active effort
      expect(checkPrematureCycling(s, 0.5, 5.0)).toBe(true);
      // Not premature: tIn = 1.3s >= 1.2s
      expect(checkPrematureCycling(s, 1.3, 0.5)).toBe(false);
    });

    it('checkDelayedCycling: true only in PSV when low cycleOffPct and tIn > pmusInspTimeSec + 0.05s', () => {
      const patient = makeBasePatient({ pmusInspTimeSec: 0.8, spontRateBpm: 15, pmusAmplitudeCmH2O: 10 });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 0,
        psAbovePeep: 10,
        cycleOffPct: 5,
      };
      const s = engine.createState(patient, device);
      I(s).control = 'ps';

      // Delayed: tIn = 0.9s > 0.8 + 0.05 = 0.85s with cycleOffPct 5
      expect(checkDelayedCycling(s, 0.9)).toBe(true);
      // Synchronous: tIn = 0.82s <= 0.85s
      expect(checkDelayedCycling(s, 0.82)).toBe(false);
    });

    it('checkFlowStarvation: evaluates demand vs set flow in VC-AC', () => {
      const patient = makeBasePatient({
        pmusAmplitudeCmH2O: 18,
        complianceMlPerCmH2O: 50,
        pmusInspTimeSec: 0.9,
      });
      const starvedDevice: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        inspFlowLpm: 25,
      };
      const sStarved = engine.createState(patient, starvedDevice);
      I(sStarved).control = 'vc';
      I(sStarved).minInspPaw = 3; // below PEEP 5
      expect(checkFlowStarvation(sStarved)).toBe(true);

      const adequateDevice: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
        inspFlowLpm: 75,
      };
      const sAdequate = engine.createState(patient, adequateDevice);
      I(sAdequate).control = 'vc';
      I(sAdequate).minInspPaw = 12;
      expect(checkFlowStarvation(sAdequate)).toBe(false);
    });

    it('reverseTriggerPmus: returns zero when no effort scheduled and bell-shaped positive curve during effort', () => {
      const patient = makeBasePatient();
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
      };
      const s = engine.createState(patient, device);
      expect(reverseTriggerPmus(s, 5.0)).toBe(0);

      // Schedule reverse triggered effort at t = 2.0 with duration 0.6s and amp 8 cmH2O
      I(s).reverseTriggerEffortStart = 2.0;
      I(s).reverseTriggerEffortTi = 0.6;
      I(s).reverseTriggerEffortAmp = 8.0;

      expect(reverseTriggerPmus(s, 1.9)).toBe(0);
      const midEffortPmus = reverseTriggerPmus(s, 2.3);
      expect(midEffortPmus).toBeGreaterThan(3.0);
      expect(midEffortPmus).toBeLessThanOrEqual(8.0);
      // Well after effort and relaxation
      expect(reverseTriggerPmus(s, 4.0)).toBe(0);
    });

    it('checkDoubleTrigger: checks neural Ti, Pmus threshold and prevents repeated triggers on same effort', () => {
      const patient = makeBasePatient({
        spontRateBpm: 18,
        pmusAmplitudeCmH2O: 16,
        pmusInspTimeSec: 1.4,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 14,
      };
      const s = engine.createState(patient, device);
      const x = I(s);
      x.phase = 'exp';
      x.effortStart = 0.05;
      x.breathStart = 0.05;
      x.inspEnd = 0.4;

      // When refractory period elapsed, current effort high, within neural Ti window
      expect(checkDoubleTrigger(s, 0.65, true, 8.0)).toBe(true);

      // If already triggered for this effort
      x.lastDoubleTriggerEffort = 0.05;
      expect(checkDoubleTrigger(s, 0.65, true, 8.0)).toBe(false);
    });

    it('checkReverseTrigger: triggers deterministically according to probability in passive patients', () => {
      const patient = makeBasePatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        reverseTriggerProbability: 0.5,
      });
      const device: DeviceSettings = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 12,
      };
      const s = engine.createState(patient, device);

      let triggeredCount = 0;
      for (let i = 0; i < 20; i++) {
        if (checkReverseTrigger(s, i * 4, 'mandatory')) {
          triggeredCount++;
        }
      }
      // With prob 0.5 across 20 mandatory breaths, expecting around 10 triggers
      expect(triggeredCount).toBeGreaterThanOrEqual(8);
      expect(triggeredCount).toBeLessThanOrEqual(12);
    });
  });

  describe('Verification of Benchmark Specs (dys-01 to dys-06)', () => {
    it('satisfies dys-01-double-triggering (doubleTriggerCount >= 3)', async () => {
      const spec = await import('../benchmarks/dys-01-double-triggering.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'doubleTriggerCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('satisfies dys-02-premature-cycling (prematureCycleCount >= 3)', async () => {
      const spec = await import('../benchmarks/dys-02-premature-cycling.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'prematureCycleCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('satisfies dys-03-delayed-cycling (delayedCycleCount >= 3)', async () => {
      const spec = await import('../benchmarks/dys-03-delayed-cycling.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'delayedCycleCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('satisfies dys-04-flow-starvation (flowStarvationCount >= 3)', async () => {
      const spec = await import('../benchmarks/dys-04-flow-starvation.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'flowStarvationCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('satisfies dys-05-auto-triggering-leak (autoTriggerCount >= 10)', async () => {
      const spec = await import('../benchmarks/dys-05-auto-triggering-leak.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'autoTriggerCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(10);
    });

    it('satisfies dys-06-reverse-triggering-rule-based (reverseTriggerCount >= 3)', async () => {
      const spec = await import('../benchmarks/dys-06-reverse-triggering-rule-based.json');
      const s0 = engine.createState(
        spec.patient as unknown as PatientParams,
        spec.device as unknown as DeviceSettings,
        spec.phys as unknown as Partial<PhysState>
      );
      const sEnd = engine.fastForward(s0, spec.runSec);
      const count = metricOf(sEnd, 'reverseTriggerCount');
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });
});
