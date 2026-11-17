import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance as rawAdvance, placeOrder, answerPrediction, currentPrediction, finishRun, type Runtime } from '../../src/runtime/caseRuntime';
import raw from '../../src/cases/library/ards-vent-01.json';

/** Advance, answering any fixed-key question the case asks on the way (it pauses the clock). */
async function advance(rt: Runtime, run: Parameters<typeof rawAdvance>[1], sec: number) {
  const end = run.engine.simTimeSec + sec;
  while (run.engine.simTimeSec < end - 1e-6 && !run.ended) {
    await rawAdvance(rt, run, end - run.engine.simTimeSec);
    if (run.pendingPrediction) await answerPrediction(rt, run, currentPrediction(run)!.format === 'numeric' ? 66 : 'Prone positioning for 16 hours or more a day', 'guess');
  }
}

const ards = CaseSchema.parse(raw) as CaseFile;
const setup = async () => {
  const sink = new MemoryEventSink(); const rt: Runtime = { engine, sink };
  const run = await startRun(rt, ards, { sessionId: 's' });
  return { sink, rt, run };
};
const answerPbw = async (rt: Runtime, run: Awaited<ReturnType<typeof setup>>['run']) => {
  expect(currentPrediction(run)?.id).toBe('p-pbw');
  await answerPrediction(rt, run, 66, 'certain');
};
const goodSettings = { vtSetMl: 400, rrSetBpm: 30, peep: 12, fio2: 0.7 };
const calibrationErrors = (sink: MemoryEventSink) => sink.events.filter(e => e.type === 'mistake' && e.mistake === 'calibration_error');
const settingsPredictions = (sink: MemoryEventSink) => sink.events.filter(e => e.type === 'prediction' && e.predictionId === 'p-settings-effect');

/** The "well" sequence: gas ordered at 3 min, settings changed at 5 min, direction answer given as certain. */
async function wellSequence(answer: Record<string, 'up' | 'down' | 'same'> = { pplat: 'down', paco2: 'up', spo2: 'up' }) {
  const s = await setup();
  await rawAdvance(s.rt, s.run, 1); await answerPbw(s.rt, s.run);
  await advance(s.rt, s.run, 3 * 60 - 1);
  await placeOrder(s.rt, s.run, 'abg');
  await advance(s.rt, s.run, 2 * 60);
  await placeOrder(s.rt, s.run, 'change-settings', goodSettings);
  expect(currentPrediction(s.run)?.id).toBe('p-settings-effect');
  await answerPrediction(s.rt, s.run, answer, 'certain');
  return s;
}

describe('engine-marked predictions wait for settled physiology', () => {
  it('an ABG drawn before the answer does not score it (no false calibration_error)', async () => {
    const { rt, run, sink } = await wellSequence();
    await advance(rt, run, 2 * 60); // the 3-min gas comes back at 6 min: drawn before the answer
    expect(run.abgs.length).toBe(1);
    expect(settingsPredictions(sink).length).toBe(0);
    await advance(rt, run, 20 * 60);
    expect(calibrationErrors(sink).length).toBe(0);
  });

  it('an ABG drawn at least 15 min after the answer scores it', async () => {
    const { rt, run, sink } = await wellSequence();
    await advance(rt, run, 16 * 60);
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, 200);
    expect(settingsPredictions(sink).length).toBe(1);
  });

  it('with no later gas, the mark is scored at 30 min with current values (engine shows PaCO2 within the noise band here)', async () => {
    const { rt, run, sink } = await wellSequence({ pplat: 'down', paco2: 'same', spo2: 'up' });
    await advance(rt, run, 29 * 60);
    expect(settingsPredictions(sink).length).toBe(0);
    await advance(rt, run, 2 * 60);
    const p = settingsPredictions(sink);
    expect(p.length).toBe(1);
    expect(calibrationErrors(sink).length).toBe(0);
  });

  it('finishing with under 15 min elapsed does not score it and records it as unscored', async () => {
    const { rt, run, sink } = await wellSequence();
    await advance(rt, run, 5 * 60);
    await finishRun(rt, run);
    expect(settingsPredictions(sink).length).toBe(0);
    expect(calibrationErrors(sink).length).toBe(0);
    expect(run.unscoredPredictions?.map(u => u.predictionId)).toEqual(['p-settings-effect']);
  });
});

describe('a later settings change supersedes a pending engine mark', () => {
  it('records the mark as unscored, never as correct/wrong, and raises no calibration_error', async () => {
    const { rt, run, sink } = await wellSequence({ pplat: 'up', paco2: 'up', spo2: 'up' });
    await advance(rt, run, 5 * 60);
    await placeOrder(rt, run, 'change-settings', { peep: 10 });
    expect(run.pendingMarks.length).toBe(0);
    expect(run.unscoredPredictions).toEqual([{ predictionId: 'p-settings-effect', elapsedSec: expect.any(Number), reason: 'superseded by a later change' }]);
    await advance(rt, run, 16 * 60);
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, 200);
    expect(settingsPredictions(sink).length).toBe(0);
    expect(calibrationErrors(sink).length).toBe(0);
    expect(run.predictionResults.some(r => r.predictionId === 'p-settings-effect')).toBe(false);
  });
});

describe('ards-vent-01 persistent hypoxaemia', () => {
  it('untouched patient: senior asks about oxygenation, then the case ends deteriorated at about 30-35 min', async () => {
    const { rt, run } = await setup();
    await rawAdvance(rt, run, 1); await answerPbw(rt, run);
    for (let i = 0; i < 70 && !run.ended; i++) await advance(rt, run, 60);
    expect(run.messages.some(m => m.from === 'senior' && /plan for his oxygenation/.test(m.text))).toBe(true);
    expect(run.ended?.outcome).toBe('deteriorated');
    expect(run.ended?.reason).toMatch(/30 minutes/);
    expect(run.ended!.simTimeSec).toBeGreaterThanOrEqual(30 * 60);
    expect(run.ended!.simTimeSec).toBeLessThanOrEqual(35 * 60 + 60);
  });

  it('good run (settings changed at 5 min) does not trigger the hypoxaemia ending', async () => {
    const { rt, run } = await setup();
    await rawAdvance(rt, run, 1); await answerPbw(rt, run);
    await advance(rt, run, 5 * 60);
    await placeOrder(rt, run, 'change-settings', goodSettings);
    await answerPrediction(rt, run, { pplat: 'down', paco2: 'up', spo2: 'up' }, 'guess');
    for (let i = 0; i < 60 && !run.ended; i++) await advance(rt, run, 60);
    expect(run.ended?.reason ?? '').not.toMatch(/hypoxaemia persisted/);
    expect(run.fired).not.toContain('hypoxaemia-persisted');
  });
});
