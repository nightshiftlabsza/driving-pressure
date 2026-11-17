import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, answerPrediction, currentPrediction, finishRun, ABG_DELAY_SIM_SEC } from '../../src/runtime/caseRuntime';
import raw from '../../src/cases/library/copd-niv-01.json';
import type { DeviceSettings } from '../../src/shared/engineTypes';

const copd = CaseSchema.parse(raw) as CaseFile;
const niv: DeviceSettings = { device: 'niv', mode: 'ST', fio2: 0.28, epap: 5, ipap: 15, backupRrBpm: 12, tiSec: 1, interface: 'oronasal', maskFit: 'good' };
const setup = async () => { const sink = new MemoryEventSink(); const rt = { engine, sink }; const run = await startRun(rt, copd, { sessionId: 's1' }); return { sink, rt, run }; };

describe('case runtime: COPD on the ward', () => {
  it('ABG result arrives after the lab delay and is consistent with the engine', async () => {
    const { rt, run, sink } = await setup();
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, ABG_DELAY_SIM_SEC - 10);
    expect(run.abgs.length).toBe(0);
    await advance(rt, run, 20);
    expect(run.abgs.length).toBe(1);
    expect(run.abgs[0].ph).toBeLessThan(7.30);
    expect(sink.events.some(e => e.type === 'abg_result')).toBe(true);
  });

  it('exam and CXR reveal findings only when ordered', async () => {
    const { rt, run } = await setup();
    expect(run.findings.examine).toBeUndefined();
    await placeOrder(rt, run, 'examine');
    expect(run.findings.examine).toContain('wheeze');
  });

  it('rejects orders the case does not offer', async () => {
    const { rt, run } = await setup();
    await expect(placeOrder(rt, run, 'prone')).rejects.toThrow(/not available/);
  });

  it('starting NIV pauses for a prediction; the engine marks it after the next gas', async () => {
    const { rt, run, sink } = await setup();
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, 300);
    await placeOrder(rt, run, 'change-device', { device: niv });
    expect(currentPrediction(run)?.id).toBe('p-niv-effect');
    const paused = await advance(rt, run, 60);
    expect(paused.paused).toBe('prediction');
    const fb = await answerPrediction(rt, run, { paco2: 'down', rrTotal: 'down', ph: 'up' }, 'fairly_sure');
    expect(fb.status).toBe('awaiting-physiology');
    expect(sink.events.filter(e => e.type === 'prediction').length).toBe(0); // no feedback yet
    await advance(rt, run, 45 * 60);
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, ABG_DELAY_SIM_SEC + 5);
    const pred = sink.events.find(e => e.type === 'prediction');
    expect(pred && pred.type === 'prediction' && pred.correct).toBe(true);
  });

  it('a confidently wrong prediction is logged as a calibration error', async () => {
    const { rt, run, sink } = await setup();
    await placeOrder(rt, run, 'change-device', { device: niv });
    await answerPrediction(rt, run, { paco2: 'up', rrTotal: 'up', ph: 'down' }, 'certain');
    await advance(rt, run, 3600 + 5);
    expect(sink.events.some(e => e.type === 'prediction' && !e.correct)).toBe(true);
    expect(sink.events.some(e => e.type === 'mistake' && e.mistake === 'calibration_error')).toBe(true);
  });

  it('good management ends improved, with rubric met', async () => {
    const { rt, run, sink } = await setup();
    await placeOrder(rt, run, 'abg');
    await placeOrder(rt, run, 'bronchodilator');
    await advance(rt, run, 600);
    await placeOrder(rt, run, 'change-device', { device: niv });
    await answerPrediction(rt, run, { paco2: 'down', rrTotal: 'down', ph: 'up' }, 'fairly_sure');
    await advance(rt, run, 60 * 60);
    await placeOrder(rt, run, 'abg');
    const r = await advance(rt, run, 4 * 3600);
    expect(r.paused).toBe('ended');
    expect(run.ended?.outcome).toBe('improved');
    const { score, maxScore } = await finishRun(rt, run);
    expect(score).toBe(maxScore);
    expect(sink.events.at(-1)?.type).toBe('run_end');
    const hidden = sink.events.filter(e => e.type === 'rubric_result' && e.competency === 'safety.reassess');
    expect(hidden.every(e => e.type === 'rubric_result' && e.hidden)).toBe(true);
  });

  it('no treatment ends deteriorated', async () => {
    const { rt, run } = await setup();
    const r = await advance(rt, run, 4 * 3600);
    expect(r.paused).toBe('ended');
    expect(run.ended?.outcome).toBe('deteriorated');
  });

  it('over-oxygenation triggers the unsafe-action mistake', async () => {
    const { rt, run, sink } = await setup();
    await placeOrder(rt, run, 'change-device', { device: { ...niv, fio2: 0.7 } });
    await answerPrediction(rt, run, { paco2: 'down', rrTotal: 'down', ph: 'up' }, 'guess');
    await advance(rt, run, 30 * 60);
    expect(sink.events.some(e => e.type === 'mistake' && e.mistake === 'unsafe_action')).toBe(true);
  });

  it('intubation ends the case as escalated', async () => {
    const { rt, run } = await setup();
    await placeOrder(rt, run, 'intubate');
    expect(run.ended?.outcome).toBe('escalated');
  });
});
