import { describe, it, expect } from 'vitest';
import { engine } from '../src/engine/index';
import { metricOf } from '../src/engine/metrics';
import { metric, startRun, advance } from '../src/runtime/caseRuntime';
import { MemoryEventSink } from '../src/shared/eventSink';
import { CaseSchema, METRICS, type CaseFile } from '../src/shared/caseSchema';
import rawCopd from '../src/cases/library/copd-niv-01.json';
import rawArds from '../src/cases/library/ards-vent-01.json';
import rawApo from '../src/cases/library/apo-cpap-01.json';

const cases: { name: string; file: CaseFile }[] = [
  { name: 'copd-niv-01', file: CaseSchema.parse(rawCopd) as CaseFile },
  { name: 'ards-vent-01', file: CaseSchema.parse(rawArds) as CaseFile },
  { name: 'apo-cpap-01', file: CaseSchema.parse(rawApo) as CaseFile },
];

const timePointsSec = [0, 30, 60, 180, 300];

describe('metricOf pure function extraction', () => {
  for (const c of cases) {
    it(`yields identical results to runtime metric() for ${c.name} across 5 timepoints`, async () => {
      const sink = new MemoryEventSink();
      const rt = { engine, sink };
      const run = await startRun(rt, c.file, { sessionId: 'test-session' });

      let elapsed = 0;
      for (const t of timePointsSec) {
        if (t > elapsed) {
          await advance(rt, run, t - elapsed);
          elapsed = t;
        }

        for (const m of METRICS) {
          const runVal = metric(run, m);
          const pureVal = metricOf(run.engine, m);
          expect(pureVal, `Metric ${m} at t=${t}s in ${c.name}`).toBe(runVal);
        }
      }
    });
  }
});
