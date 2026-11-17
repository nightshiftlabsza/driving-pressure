/** Runtime/case regression tests for the QA bug hunt (docs/qa). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, finishRun, check, answerPrediction, currentPrediction, type Runtime } from '../../src/runtime/caseRuntime';

const load = (id: string) => CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8'))) as CaseFile;
const rt = (): Runtime => ({ engine, sink: new MemoryEventSink() });

describe('QA1-001 reconnection keeps the learner\'s latest device choice', () => {
  it('a device change during a disconnection is not reverted when the circuit reconnects', async () => {
    const base = load('asthma-vent-01');
    const r = rt(); const run = await startRun(r, { ...base, availableOrders: [...base.availableOrders, 'change-device'] }, { sessionId: 't' });
    await placeOrder(r, run, 'disconnect-ventilator');
    await advance(r, run, 5);
    await placeOrder(r, run, 'change-device', { device: { device: 'hfnc', flowLpm: 40, fio2: 0.6, temperatureC: 37 } });
    await advance(r, run, 60);
    expect(run.engine.device.device).toBe('hfnc');
  });
  it('without any change the same settings come back', async () => {
    const r = rt(); const run = await startRun(r, load('asthma-vent-01'), { sessionId: 't' });
    const before = run.engine.device;
    await placeOrder(r, run, 'disconnect-ventilator');
    await advance(r, run, 40);
    expect(run.engine.device).toEqual(before);
  });
});

describe('QA3-001 findings do not reveal the crisis early', () => {
  it('examination before minute 5 is normal, after minute 5 shows the pneumothorax', async () => {
    const r = rt(); const run = await startRun(r, load('vent-high-pressure-01'), { sessionId: 't' });
    await placeOrder(r, run, 'examine');
    expect(run.findings.examine).not.toMatch(/shifted|hyper-resonant/i);
    await advance(r, run, 6 * 60);
    await placeOrder(r, run, 'examine');
    expect(run.findings.examine).toMatch(/shifted/i);
  });
});

describe('QA3-002 rubric requires the right device', () => {
  it('copd-niv-01: a switch to a simple mask does not count as starting NIV, NIV does', async () => {
    const c = load('copd-niv-01'); const item = c.rubric.find(x => x.id === 'r-niv-start')!;
    const r1 = rt(); const a = await startRun(r1, c, { sessionId: 't' });
    await placeOrder(r1, a, 'change-device', { device: { device: 'none', o2: 'simple-mask', o2FlowLpm: 8 } });
    expect(check(a, item.met, 'x')).toBe(false);
    const r2 = rt(); const b = await startRun(r2, c, { sessionId: 't' });
    await placeOrder(r2, b, 'change-device', { device: { device: 'niv', mode: 'ST', fio2: 0.28, epap: 5, ipap: 12, backupRrBpm: 14, tiSec: 1, interface: 'oronasal', maskFit: 'good' } });
    expect(check(b, item.met, 'x')).toBe(true);
  });
});

describe('QA3-004 outcome reflects the patient at the time limit', () => {
  it('an untreated unstable patient ends as deteriorated, not completed', async () => {
    const r = rt(); const run = await startRun(r, load('ards-vent-01'), { sessionId: 't' });
    while (!run.ended) {
      const t = await advance(r, run, 600);
      if (t.paused === 'prediction') {
        const p = currentPrediction(run)!;
        const ans = p.format === 'direction' ? Object.fromEntries((p.variables ?? []).map(v => [v, 'same'])) : p.format === 'choice' ? p.options![0] : 0;
        await answerPrediction(r, run, ans as never, 'guess');
      }
    }
    expect(run.ended?.outcome).toBe('deteriorated');
    await finishRun(r, run);
  }, 15000);
});
