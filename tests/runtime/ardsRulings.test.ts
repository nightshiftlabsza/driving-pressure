/** ards-vent-01 clinical rulings: prone only after protective ventilation (R1), wean oxygen (R2). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, check, answerPrediction, currentPrediction, type Runtime, type RunState } from '../../src/runtime/caseRuntime';
import type { DeviceSettings } from '../../src/shared/engineTypes';

const ards = CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library/ards-vent-01.json'), 'utf8'))) as CaseFile;
const item = (id: string) => ards.rubric.find(r => r.id === id)!;
const vent = (vtSetMl: number, fio2: number, peep = 5): DeviceSettings => ({ device: 'invasive', mode: 'VC-AC', fio2, peep, rrSetBpm: 16, vtSetMl, inspFlowLpm: 60, flowPattern: 'square' });

async function run(): Promise<{ r: Runtime; s: RunState }> {
  const r: Runtime = { engine, sink: new MemoryEventSink() };
  return { r, s: await startRun(r, ards, { sessionId: 't' }) };
}

async function go(r: Runtime, s: RunState, sec: number): Promise<void> {
  let left = sec;
  while (left > 0 && !s.ended) {
    const step = Math.min(left, 60);
    const t = await advance(r, s, step);
    if (t.paused === 'prediction') {
      const p = currentPrediction(s)!;
      const ans = p.format === 'direction' ? Object.fromEntries((p.variables ?? []).map(v => [v, 'same'])) : p.format === 'choice' ? p.options![0] : 0;
      await answerPrediction(r, s, ans as never, 'guess');
      continue;
    }
    left -= step;
  }
}

const mistake = (s: RunState, text: string) => s.mistakes.some(m => m.detail.startsWith(text));

describe('R1 r-prone requires protective ventilation first', () => {
  it('prone at minute 1 on 650 mL does not earn the item and records a major mistake', async () => {
    const { r, s } = await run();
    await go(r, s, 60);
    await placeOrder(r, s, 'prone');
    await go(r, s, 60);
    await placeOrder(r, s, 'change-settings', { settings: vent(400, 0.7) });
    await go(r, s, 1200);
    expect(mistake(s, 'Proned before tidal volume was reduced.')).toBe(true);
    expect(s.mistakes.find(m => m.detail.startsWith('Proned before'))?.severity).toBe('major');
    expect(check(s, item('r-prone').met, 'x')).toBe(false);
  }, 30000);

  it('prone after Vt 400 earns the item', async () => {
    const { r, s } = await run();
    await go(r, s, 60);
    await placeOrder(r, s, 'change-settings', { settings: vent(400, 0.7) });
    await go(r, s, 120);
    await placeOrder(r, s, 'prone');
    await go(r, s, 1200);
    expect(mistake(s, 'Proned before tidal volume was reduced.')).toBe(false);
    expect(check(s, item('r-prone').met, 'x')).toBe(true);
  }, 30000);
});

describe('R2 wean FiO2 once SpO2 is above 95%', () => {
  it('staying on FiO2 1.0 with SpO2 above 95% records the minor mistake and fails the item', async () => {
    const { r, s } = await run();
    await go(r, s, 60);
    await placeOrder(r, s, 'change-settings', { settings: vent(400, 1.0, 12) });
    await placeOrder(r, s, 'prone');
    await go(r, s, 3 * 3600);
    expect(mistake(s, 'SpO2 stayed above 95% on an FiO2 over 0.5 for 30 minutes.')).toBe(true);
    expect(check(s, item('r-fio2-weaned').met, 'x')).toBe(false);
  }, 60000);

  it('weaning FiO2 to 0.4 passes the item without the mistake', async () => {
    const { r, s } = await run();
    await go(r, s, 60);
    await placeOrder(r, s, 'change-settings', { settings: vent(400, 0.4, 12) });
    await placeOrder(r, s, 'prone');
    await go(r, s, 3 * 3600);
    expect(mistake(s, 'SpO2 stayed above 95%')).toBe(false);
    expect(check(s, item('r-fio2-weaned').met, 'x')).toBe(true);
  }, 60000);
});
