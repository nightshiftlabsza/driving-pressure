import { describe, it, expect } from 'vitest';
import { engine } from '../engine/index';
import {
  ALL_LAB_EXPERIMENTS,
  LabExperimentSchema,
  runExperimentHeadless,
  captureWhySnapshot,
  buildCausalChain,
  type Direction,
} from './index';

const EXPECTED_KEYS: Record<string, Record<string, Direction>> = {
  '01-rc-time-constant-exhalation': { autoPeep: 'up', endExpFlow: 'up', ppeak: 'up' },
  '02-vc-vs-pc-compliance': { ppeak: 'up', pplat: 'up', vte: 'same' },
  '03-peep-vs-pplat': { pplat: 'up', ppeak: 'up', drivingPressure: 'same' },
  '04-rr-vs-auto-peep': { autoPeep: 'up', pplat: 'up', endExpFlow: 'up' },
  '05-insp-flow-vs-auto-peep': { autoPeep: 'down', ppeak: 'up', pplat: 'down' },
  '06-dead-space-vs-paco2': { paco2: 'up', etco2: 'down', ph: 'down' },
  '07-vt-vs-rr-minute-ventilation': { minuteVent: 'same', paco2: 'up', ph: 'down' },
  '08-fio2-vs-pao2-high-shunt': { pao2: 'up', spo2: 'up', paco2: 'same' },
  '09-peep-vs-shunt-recruitment': { pao2: 'up', pfRatio: 'up', pplat: 'up' },
  '10-ps-level-vs-vt-rr': { vte: 'up', ppeak: 'up', paco2: 'down' },
  '11-trigger-sensitivity-missed-triggers': { ineffectiveEfforts: 'up', rrTotal: 'down', minuteVent: 'down' },
  '12-hfnc-flow-vs-fio2-high-demand': { fio2: 'up', pao2: 'up', hfncPressure: 'up' },
  '13-ppv-vs-bp-preload-dependent': { pmean: 'up', sbp: 'down', hr: 'up' },
};

describe('Physiology Lab Experiments (01 to 13)', () => {
  it('loads all 13 experiments and validates every one against LabExperimentSchema', () => {
    expect(ALL_LAB_EXPERIMENTS.length).toBe(13);
    for (let i = 0; i < ALL_LAB_EXPERIMENTS.length; i++) {
      const exp = ALL_LAB_EXPERIMENTS[i];
      expect(exp.number).toBe(i + 1);
      expect(() => LabExperimentSchema.parse(exp)).not.toThrow();
    }
  });

  for (const exp of ALL_LAB_EXPERIMENTS) {
    it(`Experiment #${exp.number} (${exp.id}) is deterministic across 3 headless runs and matches expected physiology`, () => {
      const run1 = runExperimentHeadless(engine, exp, 0);
      const run2 = runExperimentHeadless(engine, exp, 0);
      const run3 = runExperimentHeadless(engine, exp, 0);

      // Answer key stability across 3 runs
      expect(run2.answerKey).toEqual(run1.answerKey);
      expect(run3.answerKey).toEqual(run1.answerKey);

      // Metric snapshot stability across 3 runs
      for (const m of exp.prediction.metrics) {
        expect(run2.baselineMetrics[m]).toBe(run1.baselineMetrics[m]);
        expect(run3.baselineMetrics[m]).toBe(run1.baselineMetrics[m]);
        expect(run2.afterMetrics[m]).toBe(run1.afterMetrics[m]);
        expect(run3.afterMetrics[m]).toBe(run1.afterMetrics[m]);
      }

      // Check against published physiology expected direction key
      expect(run1.answerKey).toEqual(EXPECTED_KEYS[exp.id]);

      // Check causal chain generation
      const baseSnap = captureWhySnapshot(run1.baselineState);
      const afterSnap = captureWhySnapshot(run1.afterState);
      const chain = buildCausalChain(exp.causalChainFields, baseSnap, afterSnap);
      expect(chain.length).toBe(exp.causalChainFields.length);
      for (const node of chain) {
        expect(node.templateText.length).toBeGreaterThan(10);
      }
    });
  }
});
