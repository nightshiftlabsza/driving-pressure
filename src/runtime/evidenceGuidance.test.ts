import { describe, it, expect } from 'vitest';
import { evidenceGuidance, noteAssistance, type RunState } from './caseRuntime';
import { deriveCompetencyStates } from '../learner/derivation';
import type { LearnerEvent } from '../shared/events';

const COMP = 'gas.dead-space';
const fakeRun = (runId: string): RunState => ({ runId, guidance: { [COMP]: 'prompted' } }) as unknown as RunState;

function evidenceFor(run: RunState, day: number, ctx: string): LearnerEvent {
  return {
    v: 1, id: `e-${run.runId}`, wallTime: new Date(Date.UTC(2026, 10, 1 + day)).toISOString(), sessionId: 's', runId: run.runId,
    activity: 'case', activityId: ctx, type: 'prediction', predictionId: `p-${run.runId}`, question: 'Q', answer: 'A', expected: 'A',
    competency: COMP, evidenceType: 'decision', correct: true, confidence: 'fairly_sure',
    guidance: evidenceGuidance(run, COMP), hidden: false, contextTags: [ctx],
  };
}
const status = (events: LearnerEvent[]) => deriveCompetencyStates(events).find(s => s.competency === COMP)!.status;

describe('evidence guidance from run assistance', () => {
  it('is independent only when no tutor turns or hints were used', () => {
    expect(evidenceGuidance(fakeRun('clean'), COMP)).toBe('independent');
    const tutored = fakeRun('tutored');
    noteAssistance(tutored, 'tutor');
    expect(evidenceGuidance(tutored, COMP)).toBe('prompted');
    const hinted = fakeRun('hinted');
    noteAssistance(hinted, 'hint');
    expect(evidenceGuidance(hinted, COMP)).toBe('prompted');
  });

  it('counts live on the run object, so identical run ids stay separate', () => {
    const a = fakeRun('same-id');
    const b = fakeRun('same-id');
    noteAssistance(a, 'tutor');
    expect(evidenceGuidance(a, COMP)).toBe('prompted');
    expect(evidenceGuidance(b, COMP)).toBe('independent');
  });

  it('evidence before the first tutor turn is independent; evidence after it is prompted', () => {
    const run = fakeRun('timeline');
    const before = evidenceFor(run, 0, 'ctx-a');
    noteAssistance(run, 'tutor');
    const after = evidenceFor(run, 1, 'ctx-b');
    expect(before.type === 'prediction' && before.guidance).toBe('independent');
    expect(after.type === 'prediction' && after.guidance).toBe('prompted');
  });

  it('unaided runs across contexts reach mastered; prompted runs never do', () => {
    const ctxs = ['ctx-a', 'ctx-b', 'ctx-c', 'ctx-d'];
    const unaided = ctxs.map((c, i) => evidenceFor(fakeRun(`u${i}`), i, c));
    expect(unaided.every(e => e.type === 'prediction' && e.guidance === 'independent')).toBe(true);
    expect(status(unaided)).toBe('mastered');

    const prompted = ctxs.map((c, i) => { const r = fakeRun(`h${i}`); noteAssistance(r, 'tutor'); return evidenceFor(r, i, c); });
    expect(prompted.every(e => e.type === 'prediction' && e.guidance === 'prompted')).toBe(true);
    expect(['independent', 'mastered']).not.toContain(status(prompted));
  });
});
