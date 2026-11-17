import { describe, it, expect } from 'vitest';
import { classifyDecision } from './classify';
import type { DecisionInput, MetricPoint, ProcessClass } from './types';
import type { CaseFile } from '../shared/caseSchema';
import type { RunState } from '../runtime/caseRuntime';
import { startRun } from '../runtime/caseRuntime';
import { engine as defaultEngine } from '../engine/index';
import ardsCaseRaw from '../cases/library/ards-vent-01.json';
import hfncCaseRaw from '../cases/library/pneumonia-hfnc-01.json';

const ardsCase = ardsCaseRaw as unknown as CaseFile;
const hfncCase = hfncCaseRaw as unknown as CaseFile;

async function createMockRunState(caseFile: CaseFile, simTimeSec = 0): Promise<RunState> {
  const dummySink = { record: async () => {} };
  const run = await startRun({ engine: defaultEngine, sink: dummySink }, caseFile, {
    sessionId: 'test-session',
  });
  run.engine.simTimeSec = simTimeSec;
  return run;
}

function mockMetrics(simTimeSec: number, overrides: Partial<MetricPoint> = {}): MetricPoint[] {
  return [
    {
      simTimeSec,
      spo2: 89,
      paco2: 45,
      pao2: 60,
      ph: 7.35,
      pplat: 28,
      drivingPressure: 16,
      ppeak: 32,
      peep: 5,
      vte: 650,
      vteMlKgPbw: 9.8,
      fio2: 0.7,
      map: 85,
      hr: 102,
      rrTotal: 16,
      pfRatio: 85,
      ...overrides,
    },
    {
      simTimeSec: simTimeSec + 600,
      spo2: 92,
      paco2: 52,
      pao2: 65,
      ph: 7.24,
      pplat: 22,
      drivingPressure: 12,
      ppeak: 26,
      peep: 10,
      vte: 380,
      vteMlKgPbw: 5.8,
      fio2: 0.7,
      map: 82,
      hr: 98,
      rrTotal: 22,
      pfRatio: 92,
      ...overrides,
    },
  ];
}

interface TestCase {
  name: string;
  caseFile: CaseFile;
  simTimeSec: number;
  decision: DecisionInput;
  expectedClass: ProcessClass;
  expectedRuleId: string;
}

describe('Process Classification Engine', () => {
  const tableTestCases: TestCase[] = [
    // 1. ARDS: Sound Vt reduction with RR compensation
    {
      name: 'ARDS-01: Sound Vt reduction with RR increase to 24 bpm',
      caseFile: ardsCase,
      simTimeSec: 300,
      decision: {
        simTimeSec: 300,
        kind: 'settings_change',
        detail: { settings: { vtSetMl: 380, rrSetBpm: 24 } },
      },
      expectedClass: 'sound',
      expectedRuleId: 'ARDS-01-VT-REDUCTION-SOUND',
    },
    // 2. ARDS: Delayed RR compensation after Vt reduction
    {
      name: 'ARDS-01: Vt lowered but RR left low leading to acidosis (delayed compensation)',
      caseFile: ardsCase,
      simTimeSec: 300,
      decision: {
        simTimeSec: 300,
        kind: 'settings_change',
        detail: { settings: { vtSetMl: 380, rrSetBpm: 16 } },
      },
      expectedClass: 'delayed',
      expectedRuleId: 'ARDS-01-RR-COMPENSATION-DELAYED',
    },
    // 3. ARDS: Decision before first ABG returned (< 180s)
    {
      name: 'ARDS-01: Reasonable under uncertainty - Titrating settings before ABG has returned',
      caseFile: ardsCase,
      simTimeSec: 60,
      decision: {
        simTimeSec: 60,
        kind: 'settings_change',
        detail: { settings: { fio2: 0.8 } },
      },
      expectedClass: 'reasonable-uncertain',
      expectedRuleId: 'ARDS-01-EMPIRIC-TITRATION-BEFORE-ABG',
    },
    // 4. ARDS: Sound PEEP titration
    {
      name: 'ARDS-01: Sound PEEP increase for moderate-severe ARDS',
      caseFile: ardsCase,
      simTimeSec: 400,
      decision: {
        simTimeSec: 400,
        kind: 'settings_change',
        detail: { settings: { peep: 12 } },
      },
      expectedClass: 'sound',
      expectedRuleId: 'ARDS-01-PEEP-TITRATION-SOUND',
    },
    // 5. ARDS: Timely prone positioning
    {
      name: 'ARDS-01: Early prone positioning (< 25 sim-minutes)',
      caseFile: ardsCase,
      simTimeSec: 900,
      decision: {
        simTimeSec: 900,
        kind: 'order',
        order: 'prone',
      },
      expectedClass: 'sound',
      expectedRuleId: 'ARDS-01-PRONE-SOUND',
    },
    // 6. ARDS: Delayed prone positioning
    {
      name: 'ARDS-01: Delayed prone positioning (> 25 sim-minutes)',
      caseFile: ardsCase,
      simTimeSec: 2000,
      decision: {
        simTimeSec: 2000,
        kind: 'order',
        order: 'prone',
      },
      expectedClass: 'delayed',
      expectedRuleId: 'ARDS-01-PRONE-DELAYED',
    },
    // 7. ARDS: Injurious high Vt maintained
    {
      name: 'ARDS-01: Maintaining excessive tidal volume >= 650 mL is unsafe',
      caseFile: ardsCase,
      simTimeSec: 300,
      decision: {
        simTimeSec: 300,
        kind: 'settings_change',
        detail: { settings: { vtSetMl: 680 } },
      },
      expectedClass: 'unsafe',
      expectedRuleId: 'ARDS-01-HIGH-VT-MAINTAINED-UNSAFE',
    },
    // 8. ARDS: Wrong target bronchodilator
    {
      name: 'ARDS-01: Bronchodilator for parenchymal ARDS without bronchospasm',
      caseFile: ardsCase,
      simTimeSec: 300,
      decision: {
        simTimeSec: 300,
        kind: 'order',
        order: 'bronchodilator',
      },
      expectedClass: 'wrong-target',
      expectedRuleId: 'ARDS-01-WRONG-TARGET-BRONCHODILATOR',
    },
    // 9. ARDS: Reassessment ABG
    {
      name: 'ARDS-01: Sound reassessment blood gas',
      caseFile: ardsCase,
      simTimeSec: 600,
      decision: {
        simTimeSec: 600,
        kind: 'order',
        order: 'abg',
      },
      expectedClass: 'sound',
      expectedRuleId: 'ARDS-01-ABG-REASSESSMENT-SOUND',
    },
    // 10. HFNC: Flow escalation on HFNC
    {
      name: 'Pneumonia HFNC: Reasonable flow escalation before intubation',
      caseFile: hfncCase,
      simTimeSec: 300,
      decision: {
        simTimeSec: 300,
        kind: 'settings_change',
        detail: { settings: { flowLpm: 60, fio2: 0.8 } },
      },
      expectedClass: 'reasonable-uncertain',
      expectedRuleId: 'HFNC-01-FLOW-ESCALATION-REASONABLE-UNCERTAIN',
    },
    // 11. HFNC: Timely intubation
    {
      name: 'Pneumonia HFNC: Timely intubation within 30 sim-minutes',
      caseFile: hfncCase,
      simTimeSec: 900,
      decision: {
        simTimeSec: 900,
        kind: 'order',
        order: 'intubate',
      },
      expectedClass: 'sound',
      expectedRuleId: 'HFNC-01-INTUBATE-TIMELY-SOUND',
    },
    // 12. HFNC: Delayed intubation
    {
      name: 'Pneumonia HFNC: Delayed intubation after prolonged exhaustion (> 30 min)',
      caseFile: hfncCase,
      simTimeSec: 2400,
      decision: {
        simTimeSec: 2400,
        kind: 'order',
        order: 'intubate',
      },
      expectedClass: 'delayed',
      expectedRuleId: 'HFNC-01-INTUBATE-DELAYED',
    },
    // 13. HFNC: Post-intubation high Vt
    {
      name: 'Pneumonia HFNC: Post-intubation unsafe high Vt (450 mL for 55 kg PBW female)',
      caseFile: hfncCase,
      simTimeSec: 1000,
      decision: {
        simTimeSec: 1000,
        kind: 'settings_change',
        detail: { settings: { vtSetMl: 450 } },
      },
      expectedClass: 'unsafe',
      expectedRuleId: 'HFNC-01-POST-INTUBATION-HIGH-VT-UNSAFE',
    },
    // 14. HFNC: Wrong target diuretic
    {
      name: 'Pneumonia HFNC: Diuretic in septic hypovolaemic pneumonia',
      caseFile: hfncCase,
      simTimeSec: 500,
      decision: {
        simTimeSec: 500,
        kind: 'order',
        order: 'diuretic',
      },
      expectedClass: 'wrong-target',
      expectedRuleId: 'HFNC-01-WRONG-TARGET-DIURETIC',
    },
  ];

  it.each(tableTestCases)('$name -> $expectedClass ($expectedRuleId)', async tc => {
    const state = await createMockRunState(tc.caseFile, tc.simTimeSec);
    // If testing post-intubation on HFNC case, switch device to invasive
    if (tc.name.includes('Post-intubation')) {
      state.engine.device = {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.7,
        peep: 5,
        rrSetBpm: 16,
        vtSetMl: 450,
        inspFlowLpm: 60,
        flowPattern: 'square',
      };
    }

    const future = mockMetrics(tc.simTimeSec);
    const classification = classifyDecision(tc.decision, 0, state, tc.caseFile, future);

    expect(classification.processClass).toBe(tc.expectedClass);
    expect(classification.ruleId).toBe(tc.expectedRuleId);
    expect(classification.ruleExplanation).toBeTruthy();
    expect(classification.source).toBeTruthy();
  });

  it('proves that a good decision with a bad outcome is sound-unlucky, never unsafe', async () => {
    const state = await createMockRunState(ardsCase, 300);
    // Learner titrated PEEP up per ARDSNet table (sound protective titration)
    const dec: DecisionInput = {
      simTimeSec: 300,
      kind: 'settings_change',
      detail: { settings: { peep: 14 } },
    };

    // Physiology response exhibits unforeseen hemodynamic compromise (MAP drops to 58)
    const future = mockMetrics(300, { map: 58 });
    const classification = classifyDecision(dec, 0, state, ardsCase, future);

    expect(classification.processClass).toBe('sound-unlucky');
    expect(classification.processClass).not.toBe('unsafe');
    expect(classification.ruleExplanation).toContain('Increasing PEEP was clinically indicated');
  });

  it('marks emergency rescue actions as sound with isRescueAction true', async () => {
    const state = await createMockRunState(ardsCase, 600);
    const dec: DecisionInput = {
      simTimeSec: 600,
      kind: 'order',
      order: 'call-senior',
    };

    const classification = classifyDecision(dec, 0, state, ardsCase, mockMetrics(600));
    expect(classification.processClass).toBe('sound');
    expect(classification.isRescueAction).toBe(true);
    expect(classification.ruleId).toBe('GEN-RESCUE-ACTION');
  });

  it('classifies moderate PEEP (10-12 cmH2O) under borderline MAP as reasonable-uncertain (CHAL-5)', async () => {
    const state = await createMockRunState(ardsCase, 300);
    state.engine.monitored.mapMmHg = 70; // borderline MAP (<= 72 mmHg)
    const dec: DecisionInput = {
      simTimeSec: 300,
      kind: 'settings_change',
      detail: { settings: { peep: 10 } },
    };

    const future = mockMetrics(300, { map: 69 });
    const classification = classifyDecision(dec, 0, state, ardsCase, future);

    expect(classification.processClass).toBe('reasonable-uncertain');
    expect(classification.ruleId).toBe('ARDS-01-CONSERVATIVE-PEEP-REASONABLE');
  });

  it('classifies unrecognized actions as unclassified without failing', async () => {
    const state = await createMockRunState(ardsCase, 200);
    const dec: DecisionInput = {
      simTimeSec: 200,
      kind: 'order',
      order: 'examine',
    };

    const classification = classifyDecision(dec, 0, state, ardsCase, mockMetrics(200));
    expect(classification.processClass).toBe('unclassified');
    expect(classification.ruleId).toBe('UNCLASSIFIED');
    expect(classification.ruleExplanation).toContain('No specific authored clinical review rule');
  });

  describe('delayed rate compensation needs persistence and a real outcome', () => {
    const pt = (simTimeSec: number, ph: number): MetricPoint => ({ ...mockMetrics(0)[0]!, simTimeSec, ph });
    const vt = (t: number): DecisionInput => ({ simTimeSec: t, kind: 'settings_change', detail: { settings: { vtSetMl: 400 } } });
    const rate = (t: number, rr: number): DecisionInput => ({ simTimeSec: t, kind: 'settings_change', detail: { settings: { rrSetBpm: rr } } });

    it('does not accuse when the rate was raised 6 s later and pH stayed above 7.25', async () => {
      const state = await createMockRunState(ardsCase, 6);
      const future = [pt(6, 7.35), pt(300, 7.3), pt(900, 7.26)];
      const c = classifyDecision(vt(6), 0, state, ardsCase, future, [rate(12, 28)]);
      expect(c.ruleId).toBe('ARDS-01-VT-REDUCTION-SOUND');
    });

    it('still accuses when the rate stays at 16 for 30 min and pH falls below 7.25', async () => {
      const state = await createMockRunState(ardsCase, 6);
      const future = [pt(6, 7.35), pt(600, 7.28), pt(1800, 7.22)];
      const c = classifyDecision(vt(6), 0, state, ardsCase, future, []);
      expect(c.ruleId).toBe('ARDS-01-RR-COMPENSATION-DELAYED');
    });

    it('does not accuse when pH never falls even though the rate stays low', async () => {
      const state = await createMockRunState(ardsCase, 6);
      const future = [pt(6, 7.35), pt(1800, 7.3)];
      const c = classifyDecision(vt(6), 0, state, ardsCase, future, []);
      expect(c.ruleId).toBe('ARDS-01-VT-REDUCTION-SOUND');
    });
  });
});
