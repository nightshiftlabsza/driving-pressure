import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, startHold, type RunState } from '../../src/runtime/caseRuntime';
import asthmaRaw from '../../src/cases/library/asthma-vent-01.json';

export async function createRealAsthmaRun(): Promise<RunState> {
  const caseFile = CaseSchema.parse(asthmaRaw) as CaseFile;
  const sink = new MemoryEventSink();
  const rt = { engine, sink };
  const run = await startRun(rt, caseFile, { sessionId: 'test-session-asthma' });

  // Advance 20s for baseline breaths
  await advance(rt, run, 20);

  // Learner orders examination
  await placeOrder(rt, run, 'examine');

  // Learner orders ABG and waits 185s
  await placeOrder(rt, run, 'abg');
  await advance(rt, run, 185);

  // Expiratory hold manoeuvre (needs collect: true to step and capture manoeuvre result)
  startHold(rt, run, 'exp-hold', 2);
  await advance(rt, run, 10, true);

  return run;
}
