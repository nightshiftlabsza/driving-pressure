import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engine } from '../engine/index';
import { MemoryEventSink } from '../shared/eventSink';
import { CaseSchema, type CaseFile } from '../shared/caseSchema';
import { startRun, advance, placeOrder, answerPrediction, currentPrediction, metric, finishRun, type Runtime } from '../runtime/caseRuntime';

describe('dyssynchrony-01 in-depth scenario diagnostics and edge cases', () => {
  const caseFile = CaseSchema.parse(
    JSON.parse(readFileSync(join(__dirname, 'library/dyssynchrony-01.json'), 'utf8'))
  ) as CaseFile;

  it('Scenario 1: uncorrected dyssynchrony leads to ventilatory exhaustion and deterioration', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-s1' });

    while (run.engine.simTimeSec < 20 * 60 && !run.ended) {
      await advance(rt, run, 60);
    }
    expect(run.ended?.outcome).toBe('deteriorated');
    expect(metric(run, 'doubleTriggerCount')).toBeGreaterThanOrEqual(50);
    expect(metric(run, 'fatigue')).toBeGreaterThanOrEqual(0.52);
  });

  it('Scenario 2: correct management by decelerating flow and VT optimization achieves improvement and maxScore', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-s2' });

    for (let m = 1; m <= 60; m++) {
      if (m === 2) {
        await placeOrder(rt, run, 'change-settings', {
          flowPattern: 'decelerating',
          vtSetMl: 460,
          inspFlowLpm: 65,
          rrSetBpm: 20,
        });
      }
      if (m === 8) {
        await placeOrder(rt, run, 'abg');
      }
      const r = await advance(rt, run, 60);
      if (r.paused === 'prediction') {
        const p = currentPrediction(run)!;
        await answerPrediction(rt, run, p.format === 'direction' ? { fatigue: 'down', ppeak: 'down', rrTotal: 'down' } : 0 as never, 'certain');
      }
      if (run.ended) break;
    }
    expect(run.ended?.outcome).toBe('improved');
    expect(metric(run, 'fatigue')).toBeLessThanOrEqual(0.35);

    const { score, maxScore } = await finishRun(rt, run);
    expect(score).toBe(maxScore);
  });

  it('Scenario 3: sedation trap blunts spontaneous drive and causes severe respiratory acidosis', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-s3' });

    for (let m = 1; m <= 30; m++) {
      if (m === 3) {
        await placeOrder(rt, run, 'sedation');
      }
      await advance(rt, run, 60);
      if (run.ended) break;
    }
    expect(run.ended?.outcome).toBe('deteriorated');
    expect(metric(run, 'rrTotal')).toBeLessThanOrEqual(18);
    expect(metric(run, 'ph')).toBeLessThanOrEqual(7.28);
  });

  it('Edge case 1: alternative correct management by switching to PSV resolves dyssynchrony', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-psv' });

    await advance(rt, run, 120);
    const dtBefore = metric(run, 'doubleTriggerCount') ?? 0;
    await placeOrder(rt, run, 'change-settings', { mode: 'PSV', psAbovePeep: 14, peep: 8, fio2: 0.45, cycleOffPct: 30 });
    for (let m = 3; m <= 60; m++) {
      const r = await advance(rt, run, 60);
      if (r.paused === 'prediction') {
        const p = currentPrediction(run)!;
        await answerPrediction(rt, run, p.format === 'direction' ? { fatigue: 'down', ppeak: 'down', rrTotal: 'down' } : 0 as never, 'certain');
      }
      if (run.ended) break;
    }
    expect(run.ended?.outcome).toBe('improved');
    // Double triggers ceased accumulating after PSV switch
    expect(metric(run, 'doubleTriggerCount')).toBe(dtBefore);
  });

  it('Edge case 2: ineffective change-settings (e.g. altering FiO2/backup rate without fixing flow/pattern) still deteriorates', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-bad-settings' });

    await advance(rt, run, 120);
    // User orders change-settings but does NOT fix the dyssynchrony (keeps square flow 34 L/min, small VT)
    await placeOrder(rt, run, 'change-settings', { fio2: 0.50, rrSetBpm: 16 });
    for (let m = 3; m <= 30; m++) {
      const r = await advance(rt, run, 60);
      if (r.paused === 'prediction') {
        const p = currentPrediction(run)!;
        await answerPrediction(rt, run, p.format === 'direction' ? { fatigue: 'same', ppeak: 'same', rrTotal: 'same' } : 0 as never, 'guess');
      }
      if (run.ended) break;
    }
    expect(run.ended?.outcome).toBe('deteriorated');
  });

  it('Edge case 3: prediction point evaluates all 3 variables correctly against engine', async () => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-pred-rr' });

    await advance(rt, run, 120);
    await placeOrder(rt, run, 'change-settings', {
      flowPattern: 'decelerating',
      vtSetMl: 460,
      inspFlowLpm: 65,
      rrSetBpm: 20,
    });
    // Prediction fires
    await answerPrediction(rt, run, { fatigue: 'down', ppeak: 'down', rrTotal: 'down' }, 'certain');

    // Engine-marked answers are scored 30 simulated minutes after the answer when no later gas settles them
    await advance(rt, run, 30 * 60 + 5);
    await finishRun(rt, run);

    const result = run.predictionResults[0];
    expect(result).toBeDefined();
    expect(result.correct).toBe(true);
    expect(result.expected).toEqual({ fatigue: 'down', ppeak: 'down', rrTotal: 'down' });
  });
});
