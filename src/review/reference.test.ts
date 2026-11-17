import { describe, it, expect } from 'vitest';
import {
  getReferenceDefinition,
  runReferenceReplay,
  compareTrajectories,
  findReferenceDivergence,
  DEFAULT_KEY_METRICS,
} from './reference';
import ardsCaseRaw from '../cases/library/ards-vent-01.json';
import hfncCaseRaw from '../cases/library/pneumonia-hfnc-01.json';
import type { CaseFile } from '../shared/caseSchema';

const ardsCase = ardsCaseRaw as unknown as CaseFile;
const hfncCase = hfncCaseRaw as unknown as CaseFile;

describe('Reference Run System', () => {
  it('provides authored reference definitions with rationale and source for both core cases', () => {
    const ardsDef = getReferenceDefinition('ards-vent-01');
    expect(ardsDef).not.toBeNull();
    expect(ardsDef!.label).toBe('One reasonable approach');
    expect(ardsDef!.decisions.length).toBeGreaterThanOrEqual(4);
    for (const dec of ardsDef!.decisions) {
      expect(dec.rationale).toBeTruthy();
      expect(dec.source).toBeTruthy();
      expect(dec.simTimeSec).toBeGreaterThanOrEqual(0);
    }

    const hfncDef = getReferenceDefinition('pneumonia-hfnc-01');
    expect(hfncDef).not.toBeNull();
    expect(hfncDef!.label).toBe('One reasonable approach');
    expect(hfncDef!.decisions.length).toBeGreaterThanOrEqual(4);
    for (const dec of hfncDef!.decisions) {
      expect(dec.rationale).toBeTruthy();
      expect(dec.source).toBeTruthy();
    }

    expect(getReferenceDefinition('unknown-case')).toBeNull();
  });

  it('runs reference replay headlessly on ards-vent-01 and yields plausible physiology', async () => {
    const refResult = await runReferenceReplay(ardsCase, {
      sampleIntervalSec: 15,
      maxSimSec: 1800, // 30 sim-minutes
    });

    expect(refResult).not.toBeNull();
    expect(refResult!.metrics.length).toBeGreaterThan(15);
    expect(refResult!.decisions.length).toBe(6);

    const initial = refResult!.metrics[0];
    const final = refResult!.metrics[refResult!.metrics.length - 1];

    // Initial on ED settings: high Vt (650 mL), Pplat high (~32), low P/F
    expect(initial.vte).toBeCloseTo(650, -1);

    // Two-compartment model recruits lung with PEEP 14 and Vt 400 -> Pplat <= 30 cmH2O.
    expect(final.pplat).not.toBeNull();
    expect(final.pplat!).toBeLessThanOrEqual(30.0);

    // Due to severe fixed shunt (0.38), oxygenation remains refractory initially until proning + recruitment improve SpO2.
    expect(final.spo2).not.toBeNull();
    expect(final.spo2!).toBeGreaterThanOrEqual(82);

    // Driving pressure should improve
    expect(final.drivingPressure).not.toBeNull();
    expect(final.drivingPressure!).toBeLessThanOrEqual(16.0);
  });

  it('runs reference replay headlessly on pneumonia-hfnc-01', async () => {
    const refResult = await runReferenceReplay(hfncCase, {
      sampleIntervalSec: 30,
      maxSimSec: 9000,
    });

    expect(refResult).not.toBeNull();
    expect(refResult!.metrics.length).toBeGreaterThan(10);
    expect(refResult!.decisions.length).toBe(5);

    const final = refResult!.metrics[refResult!.metrics.length - 1];
    expect(final.spo2).toBeGreaterThanOrEqual(90);
  }, 15000);

  it('correctly compares learner trajectory against reference trajectory across key metrics', async () => {
    const refResult = await runReferenceReplay(ardsCase, {
      sampleIntervalSec: 30,
      maxSimSec: 900,
    });

    // Synthetic learner metrics (e.g. learner who left settings alone)
    const learnerMetrics = refResult!.metrics.map(m => ({
      ...m,
      pplat: 33, // unadjusted plateau
      spo2: 88,
    }));

    const comparison = compareTrajectories(ardsCase, learnerMetrics, refResult!.metrics);
    expect(comparison).not.toBeNull();
    expect(comparison!.referenceLabel).toBe('One reasonable approach');
    expect(comparison!.metrics).toHaveLength(DEFAULT_KEY_METRICS.length);

    const pplatComp = comparison!.metrics.find(m => m.metric === 'pplat');
    expect(pplatComp).toBeDefined();
    expect(pplatComp!.learnerSeries.length).toBe(refResult!.metrics.length);
    expect(pplatComp!.referenceSeries.length).toBe(refResult!.metrics.length);
    expect(pplatComp!.minVal).toBeLessThan(33);
    expect(pplatComp!.maxVal).toBeGreaterThanOrEqual(33);
  });

  it('replays ards-vent-01 reference run to completion on current engine and reaches improved with all rubric items met', async () => {
    const { finishRun } = await import('../runtime/caseRuntime');
    const { MemoryEventSink } = await import('../shared/eventSink');
    const { engine } = await import('../engine/index');

    const refResult = await runReferenceReplay(ardsCase, {
      sampleIntervalSec: 60,
      maxSimSec: ardsCase.maxSimMin * 60,
    });
    expect(refResult).not.toBeNull();
    expect(refResult!.finalState.ended?.outcome).toBe('improved');

    const sink = new MemoryEventSink();
    const { score, maxScore } = await finishRun({ engine, sink }, refResult!.finalState, false);
    const unmet = sink.events
      .filter((e): e is Extract<typeof e, { type: 'rubric_result' }> => e.type === 'rubric_result' && !e.met)
      .map(e => e.rubricId);
    expect(unmet).toEqual([]);
    expect(score).toBe(maxScore);
  }, 15000);

  it('replays pneumonia-hfnc-01 reference run to completion on current engine and reaches improved with all rubric items met', async () => {
    const { finishRun } = await import('../runtime/caseRuntime');
    const { MemoryEventSink } = await import('../shared/eventSink');
    const { engine } = await import('../engine/index');

    const refResult = await runReferenceReplay(hfncCase, {
      sampleIntervalSec: 60,
      maxSimSec: hfncCase.maxSimMin * 60,
    });
    expect(refResult).not.toBeNull();
    expect(refResult!.finalState.ended?.outcome).toBe('improved');

    const sink = new MemoryEventSink();
    const { score, maxScore } = await finishRun({ engine, sink }, refResult!.finalState, false);
    const unmet = sink.events
      .filter((e): e is Extract<typeof e, { type: 'rubric_result' }> => e.type === 'rubric_result' && !e.met)
      .map(e => e.rubricId);
    expect(unmet).toEqual([]);
    expect(score).toBe(maxScore);
  }, 15000);

  it('identifies the earliest trajectory divergence timestamp via findReferenceDivergence and formats it into buildDebriefContext', async () => {
    const { buildDebriefContext } = await import('../tutor/context');
    const comparison = compareTrajectories(
      ardsCase,
      [
        {
          simTimeSec: 0,
          spo2: 88,
          paco2: 46,
          pao2: 58,
          ph: 7.31,
          pplat: 30,
          drivingPressure: 18,
          ppeak: 36,
          peep: 12,
          vte: 520,
          vteMlKgPbw: 7.5,
          fio2: 0.6,
          map: 75,
        } as never,
        {
          simTimeSec: 300,
          spo2: 84,
          paco2: 52,
          pao2: 51,
          ph: 7.26,
          pplat: 34,
          drivingPressure: 22,
          ppeak: 40,
          peep: 12,
          vte: 520,
          vteMlKgPbw: 7.5,
          fio2: 0.6,
          map: 72,
        } as never,
      ],
      [
        {
          simTimeSec: 0,
          spo2: 88,
          paco2: 46,
          pao2: 58,
          ph: 7.31,
          pplat: 30,
          drivingPressure: 18,
          ppeak: 36,
          peep: 12,
          vte: 520,
          vteMlKgPbw: 7.5,
          fio2: 0.6,
          map: 75,
        } as never,
        {
          simTimeSec: 300,
          spo2: 92,
          paco2: 47,
          pao2: 65,
          ph: 7.3,
          pplat: 26,
          drivingPressure: 14,
          ppeak: 31,
          peep: 12,
          vte: 400,
          vteMlKgPbw: 6.0,
          fio2: 0.6,
          map: 76,
        } as never,
      ]
    );

    expect(comparison).not.toBeNull();
    const div = findReferenceDivergence(comparison!);
    expect(div).not.toBeNull();
    expect(div!.simTimeSec).toBe(300);

    const built = buildDebriefContext(
      {
        runId: 'run-div-1',
        activity: 'case',
        activityId: 'ards-vent-01',
        startedAt: '2026-11-10T10:00:00Z',
        endedAt: '2026-11-10T10:20:00Z',
        outcome: 'deteriorated',
        score: 1,
        maxScore: 4,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      },
      ardsCase,
      { referenceDivergence: div }
    );
    expect(built.contextText).toContain('Attending Reference Divergence Timestamp');
    expect(built.contextText).toContain('+5m 0s');
  });
});
