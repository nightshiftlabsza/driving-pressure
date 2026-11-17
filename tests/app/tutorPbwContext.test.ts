import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema } from '../../src/shared/caseSchema';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { startRun, answerPrediction } from '../../src/runtime/caseRuntime';
import { buildActiveCaseContext, buildTutorContext } from '../../src/tutor/context';

const loadCase = (id: string) =>
  CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8')));

describe('Tutor Context PBW leak guard', () => {
  it('default behaviour includes PBW and mL/kg PBW in active case context', async () => {
    const caseFile = loadCase('ards-vent-01');
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-session-pbw' });

    const built = buildActiveCaseContext(run);
    expect(built.contextText).toContain('PBW');
    expect(built.contextText).toContain('mL/kg');
    expect(built.verifiedEngineNumbers?.PBW).toBeDefined();
    expect(built.verifiedEngineNumbers?.Vt_per_kg_PBW).toBeDefined();
  });

  it('omits PBW and mL/kg PBW when hidePbw is true in options', async () => {
    const caseFile = loadCase('ards-vent-01');
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-session-pbw' });

    const builtWithOptions = buildActiveCaseContext(run, undefined, { hidePbw: true });
    expect(builtWithOptions.contextText).not.toContain('PBW');
    expect(builtWithOptions.contextText).not.toContain('mL/kg');
    expect(builtWithOptions.verifiedEngineNumbers?.PBW).toBeUndefined();
    expect(builtWithOptions.verifiedEngineNumbers?.Vt_per_kg_PBW).toBeUndefined();

    // Verify demographic line still has age, sex, height, weight
    expect(builtWithOptions.contextText).toMatch(/Demographics: \d+yo [MF], Height: \d+ cm, Weight: \d+ kg/);
    expect(builtWithOptions.contextText).not.toMatch(/PBW: \d+(\.\d+)? kg/);
  });

  it('supports hidePbw as second argument options object', async () => {
    const caseFile = loadCase('ards-vent-01');
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-session-pbw' });

    const built = buildActiveCaseContext(run, { hidePbw: true });
    expect(built.contextText).not.toContain('PBW');
    expect(built.contextText).not.toContain('mL/kg');
  });

  it('supports hidePbw on input snapshot and in buildTutorContext', async () => {
    const caseFile = loadCase('ards-vent-01');
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-session-pbw' });

    const builtSnapshot = buildActiveCaseContext({ ...run, hidePbw: true });
    expect(builtSnapshot.contextText).not.toContain('PBW');
    expect(builtSnapshot.contextText).not.toContain('mL/kg');

    const builtViaTutorContext = buildTutorContext(run, 'active_case', { hidePbw: true });
    expect(builtViaTutorContext.contextText).not.toContain('PBW');
    expect(builtViaTutorContext.contextText).not.toContain('mL/kg');
  });

  it('demonstrates pbwHidden transition: hidden while p-pbw unanswered, revealed once answered', async () => {
    const caseFile = loadCase('ards-vent-01');
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'test-session-pbw' });

    // Initial state: p-pbw unanswered
    const pbwHiddenInitial =
      caseFile.predictionPoints.some(p => p.id === 'p-pbw') &&
      !run.predictionResults.some(r => r.predictionId === 'p-pbw');
    expect(pbwHiddenInitial).toBe(true);

    const builtInitial = buildActiveCaseContext(run, undefined, { hidePbw: pbwHiddenInitial });
    expect(builtInitial.contextText).not.toContain('PBW');
    expect(builtInitial.contextText).not.toContain('mL/kg');

    // Answer p-pbw
    await answerPrediction(rt, run, '66', 'certain');
    const pbwHiddenAfter =
      caseFile.predictionPoints.some(p => p.id === 'p-pbw') &&
      !run.predictionResults.some(r => r.predictionId === 'p-pbw');
    expect(pbwHiddenAfter).toBe(false);

    const builtAfter = buildActiveCaseContext(run, undefined, { hidePbw: pbwHiddenAfter });
    expect(builtAfter.contextText).toContain('PBW');
    expect(builtAfter.contextText).toContain('mL/kg');
  });
});
