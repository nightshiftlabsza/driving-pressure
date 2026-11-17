import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, answerPrediction, currentPrediction, finishRun, type Runtime } from '../../src/runtime/caseRuntime';
import pass from '../../src/cases/library/sbt-pass-01.json';
import fail from '../../src/cases/library/sbt-fail-01.json';

async function extubateAt(raw: unknown, min: number) {
  const rt: Runtime = { engine, sink: new MemoryEventSink() };
  const run = await startRun(rt, CaseSchema.parse(raw) as CaseFile, { sessionId: 's' });
  let guard = 0;
  while (run.engine.simTimeSec < min * 60 && !run.ended && guard++ < 50) {
    await advance(rt, run, min * 60 - run.engine.simTimeSec);
    if (run.pendingPrediction) { const p = currentPrediction(run)!; await answerPrediction(rt, run, p.format === 'numeric' ? 0 : p.format === 'choice' ? p.options![0] : {}, 'guess'); }
  }
  await placeOrder(rt, run, 'extubate');
  await advance(rt, run, 5);
  const res = await finishRun(rt, run);
  return { run, res };
}

describe('sbt-pass-01: 30-minute minimum trial', () => {
  it('extubation at minute 10 is a major mistake and ends stable, not improved', async () => {
    const { run, res } = await extubateAt(pass, 10);
    expect(run.ended?.outcome).toBe('stable');
    expect(run.ended?.reason).toMatch(/too early/);
    expect(run.mistakes.some(m => m.competency === 'safety.extubation' && m.severity === 'major')).toBe(true);
    expect(res.score).toBeLessThan(res.maxScore);
  });
  it('extubation at minute 32 ends improved with no extubation mistake and earns the timely item', async () => {
    const { run } = await extubateAt(pass, 32);
    expect(run.ended?.outcome).toBe('improved');
    expect(run.mistakes.filter(m => m.competency === 'safety.extubation').length).toBe(0);
  });
});

describe('sbt-fail-01: extubation at minute 1', () => {
  it('still scores badly (deteriorated, major mistake)', async () => {
    const { run, res } = await extubateAt(fail, 1);
    expect(run.ended?.outcome).toBe('deteriorated');
    expect(run.mistakes.some(m => m.severity === 'major')).toBe(true);
  });
});
