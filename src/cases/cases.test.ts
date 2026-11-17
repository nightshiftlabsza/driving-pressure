import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { engine } from '../engine/index';
import { MemoryEventSink } from '../shared/eventSink';
import { CaseSchema, type CaseFile, type OrderType, type Metric } from '../shared/caseSchema';
import { startRun, advance, placeOrder, answerPrediction, currentPrediction, metric, finishRun, type RunState, type Runtime } from '../runtime/caseRuntime';

interface Scenario {
  name: string;
  outcome?: string;
  runToSimMin?: number;
  orders: { atSimMin: number; order: OrderType; detail?: Record<string, unknown> }[];
  expect: { atSimMin: number; metric: Metric; op: '<' | '<=' | '>' | '>='; value: number }[];
}

interface Expectations {
  caseId: string;
  scenarios: Scenario[];
}

const root = join(__dirname, '../../src/cases');
const expDir = join(root, 'expectations');
const libDir = join(root, 'library');

const expFiles = readdirSync(expDir).filter(f => f.endsWith('.json'));

describe.each(expFiles)('case test: %s', (file) => {
  const exp: Expectations = JSON.parse(readFileSync(join(expDir, file), 'utf8'));
  const raw = JSON.parse(readFileSync(join(libDir, `${exp.caseId}.json`), 'utf8'));
  const caseFile = CaseSchema.parse(raw) as CaseFile;

  it.each(exp.scenarios.map(s => [s.name, s] as const))('scenario: %s', async (_name, sc) => {
    const rt: Runtime = { engine, sink: new MemoryEventSink() };
    const run = await startRun(rt, caseFile, { sessionId: `test-${exp.caseId}` });
    const steps = [
      ...sc.orders.map(o => ({ t: o.atSimMin, kind: 'order' as const, o })),
      ...sc.expect.map(e => ({ t: e.atSimMin, kind: 'expect' as const, e })),
    ].sort((a, b) => a.t - b.t || (a.kind === 'order' ? -1 : 1));

    const failures: string[] = [];
    for (const st of steps) {
      while (run.engine.simTimeSec < st.t * 60 - 0.5 && !run.ended) {
        const r = await advance(rt, run, Math.min(60, st.t * 60 - run.engine.simTimeSec));
        if (r.paused === 'prediction') {
          const p = currentPrediction(run)!;
          const ans = p.format === 'direction'
            ? Object.fromEntries((p.variables ?? []).map(v => [v, 'same']))
            : p.format === 'choice'
            ? p.options![0]
            : 0;
          await answerPrediction(rt, run, ans as never, 'guess');
        }
      }
      if (st.kind === 'order') {
        if (!run.ended) await placeOrder(rt, run, st.o.order, st.o.detail);
        continue;
      }
      const v = metric(run, st.e.metric);
      const ok = v !== null && (
        st.e.op === '<' ? v < st.e.value :
        st.e.op === '<=' ? v <= st.e.value :
        st.e.op === '>' ? v > st.e.value :
        v >= st.e.value
      );
      if (!ok) {
        failures.push(`${st.e.atSimMin} min: ${st.e.metric} = ${v === null ? 'n/a' : v.toFixed(2)}, expected ${st.e.op} ${st.e.value}${run.ended ? ` (ended: ${run.ended.outcome})` : ''}`);
      }
    }

    if (sc.outcome) {
      while (run.engine.simTimeSec < (sc.runToSimMin ?? caseFile.maxSimMin) * 60 - 0.5 && !run.ended) {
        const r = await advance(rt, run, 60);
        if (r.paused === 'prediction') {
          const p = currentPrediction(run)!;
          const ans = p.format === 'direction'
            ? Object.fromEntries((p.variables ?? []).map(v => [v, 'same']))
            : p.format === 'choice'
            ? p.options![0]
            : 0;
          await answerPrediction(rt, run, ans as never, 'guess');
        }
      }
      if (run.ended?.outcome !== sc.outcome) {
        failures.push(`outcome: ${run.ended?.outcome ?? 'still running'}, expected ${sc.outcome}`);
      }
    }

    expect(failures).toEqual([]);

    if (sc.name.startsWith('correct management')) {
      const { score, maxScore } = await finishRun(rt, run);
      expect(score).toBe(maxScore);
    }
  }, 15000);
});
