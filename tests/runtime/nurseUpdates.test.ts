import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance } from '../../src/runtime/caseRuntime';

const dir = 'src/cases/library';
const cases = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => CaseSchema.parse(JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))) as CaseFile);
const nurseIds = (c: CaseFile) => c.triggers.filter(t => t.id.startsWith('t-nurse-'));

describe('bedside nurse updates', () => {
  for (const c of cases) {
    it(`${c.id}: nothing fires in the first 3 minutes of an untouched case`, async () => {
      const rt = { engine, sink: new MemoryEventSink() };
      const run = await startRun(rt, c, { sessionId: 's' });
      await advance(rt, run, 180);
      expect(run.fired.filter(id => id.startsWith('t-nurse-'))).toEqual([]);
    }, 60000);

    it(`${c.id}: every t-nurse trigger is a single once-only nurse message without digits`, () => {
      for (const t of nurseIds(c)) {
        expect(t.once).toBe(true);
        expect(t.then.length).toBe(1);
        const a = t.then[0];
        expect(a.type).toBe('message');
        if (a.type === 'message') {
          expect(a.from).toBe('nurse');
          expect(a.text).not.toMatch(/\d/);
        }
      }
    });
  }
});
