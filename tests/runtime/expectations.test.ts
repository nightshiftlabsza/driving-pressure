/**
 * Golden runs: every scenario in src/cases/expectations/*.json is played through the runtime and engine.
 * Expectations are written by clinicians/case authors before the engine existed, so a failure means
 * either the case parameters or the engine need review. Prediction pauses are answered with a neutral guess.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, METRICS, ORDER_TYPES, type CaseFile, type Metric, type OrderType } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, answerPrediction, currentPrediction, metric, type RunState, type Runtime } from '../../src/runtime/caseRuntime';

interface Scenario { name: string; outcome?: string; runToSimMin?: number; fired?: string[]; notFired?: string[]; orders: { atSimMin: number; order: OrderType; detail?: Record<string, unknown> }[]; expect: { atSimMin: number; metric: Metric; op: '<' | '<=' | '>' | '>='; value: number }[] }
interface Expectations { caseId: string; scenarios: Scenario[] }

const root = join(__dirname, '../../src/cases');
const expDir = process.env.OVS_EXPECTATIONS_DIR ?? join(root, 'expectations');
const libDir = process.env.OVS_LIBRARY_DIR ?? join(root, 'library');
const files = existsSync(expDir) ? readdirSync(expDir).filter(f => f.endsWith('.json')) : [];

async function goTo(rt: Runtime, run: RunState, simMin: number) {
  while (run.engine.simTimeSec < simMin * 60 - 0.5 && !run.ended) {
    const r = await advance(rt, run, simMin * 60 - run.engine.simTimeSec);
    if (r.paused === 'prediction') {
      const p = currentPrediction(run)!;
      const ans = p.format === 'direction' ? Object.fromEntries((p.variables ?? []).map(v => [v, 'same'])) : p.format === 'choice' ? p.options![0] : 0;
      await answerPrediction(rt, run, ans as never, 'guess');
    }
  }
}

describe.each(files)('expectations %s', (file) => {
  const exp: Expectations = JSON.parse(readFileSync(join(expDir, file), 'utf8'));
  const caseFile = CaseSchema.parse(JSON.parse(readFileSync(join(libDir, `${exp.caseId}.json`), 'utf8'))) as CaseFile;
  it('references only valid metrics and orders', () => {
    for (const s of exp.scenarios) {
      for (const o of s.orders) expect(ORDER_TYPES).toContain(o.order);
      for (const e of s.expect) expect(METRICS).toContain(e.metric);
    }
  });
  it.each(exp.scenarios.map(s => [s.name, s] as const))('%s', async (_name, sc) => {
    const rt = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: 'golden' });
    const steps = [...sc.orders.map(o => ({ t: o.atSimMin, kind: 'order' as const, o })), ...sc.expect.map(e => ({ t: e.atSimMin, kind: 'expect' as const, e }))].sort((a, b) => a.t - b.t || (a.kind === 'order' ? -1 : 1));
    const failures: string[] = [];
    for (const st of steps) {
      await goTo(rt, run, st.t);
      if (st.kind === 'order') { if (!run.ended) await placeOrder(rt, run, st.o.order, st.o.detail); continue; }
      const v = metric(run, st.e.metric);
      const ok = v !== null && (st.e.op === '<' ? v < st.e.value : st.e.op === '<=' ? v <= st.e.value : st.e.op === '>' ? v > st.e.value : v >= st.e.value);
      if (!ok) failures.push(`${st.e.atSimMin} min: ${st.e.metric} = ${v === null ? 'n/a' : v.toFixed(2)}, expected ${st.e.op} ${st.e.value}${run.ended ? ` (case ended: ${run.ended.outcome})` : ''}`);
    }
    if (sc.outcome) {
      await goTo(rt, run, sc.runToSimMin ?? caseFile.maxSimMin);
      if (run.ended?.outcome !== sc.outcome) failures.push(`outcome: ${run.ended?.outcome ?? 'still running'}, expected ${sc.outcome}`);
    } else if (sc.runToSimMin) await goTo(rt, run, sc.runToSimMin);
    for (const id of sc.fired ?? []) if (!run.fired.includes(id)) failures.push(`trigger ${id} did not fire`);
    for (const id of sc.notFired ?? []) if (run.fired.includes(id)) failures.push(`trigger ${id} fired`);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 15000);
});
