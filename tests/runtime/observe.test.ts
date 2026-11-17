import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, advance, placeOrder, observe, ABG_DELAY_SIM_SEC } from '../../src/runtime/caseRuntime';
import copdRaw from '../../src/cases/library/copd-niv-01.json';
import sbtRaw from '../../src/cases/library/sbt-pass-01.json';

const copd = CaseSchema.parse(copdRaw) as CaseFile;
const sbt = CaseSchema.parse(sbtRaw) as CaseFile;
const setup = async (c: CaseFile) => { const sink = new MemoryEventSink(); const rt = { engine, sink }; const run = await startRun(rt, c, { sessionId: 's1' }); return { sink, rt, run }; };

describe('observe and reassess', () => {
  it('stops when a blood gas comes back, at the lab delay and not before', async () => {
    const { rt, run, sink } = await setup(copd);
    await placeOrder(rt, run, 'abg');
    const t0 = run.engine.simTimeSec;
    // Early vital-sign shifts may stop the first look; keep watching until the gas is back.
    let obs = await observe(rt, run, 30);
    for (let k = 0; k < 6 && obs.stoppedBy === 'change'; k++) { expect(obs.changed).toBeTruthy(); expect(run.abgs.length).toBe(0); obs = await observe(rt, run, 30); }
    expect(obs.stoppedBy).toBe('result');
    expect(run.abgs.length).toBe(1);
    expect(obs.toSec - t0).toBeGreaterThanOrEqual(ABG_DELAY_SIM_SEC);
    expect(obs.toSec - t0).toBeLessThan(ABG_DELAY_SIM_SEC + 6);
    const ev = [...sink.events].reverse().find(e => e.type === 'observe');
    expect(ev && ev.type === 'observe' && ev.stoppedBy).toBe('result');
    expect(run.observations!.length).toBeGreaterThanOrEqual(1);
  });

  it('never runs past the limit and never past the end of the case', async () => {
    const { rt, run } = await setup(copd);
    const t0 = run.engine.simTimeSec;
    const obs = await observe(rt, run, 2);
    expect(obs.toSec - t0).toBeLessThanOrEqual(120 + 1e-6);
    expect(['limit', 'change', 'message', 'ended', 'prediction']).toContain(obs.stoppedBy);
  });

  it('gives the same patient as stepping the clock by hand (no physiology is skipped)', async () => {
    const a = await setup(sbt), b = await setup(sbt);
    const obs = await observe(a.rt, a.run, 5);
    await advance(b.rt, b.run, obs.toSec - obs.fromSec, false);
    expect(a.run.engine.simTimeSec).toBeCloseTo(b.run.engine.simTimeSec, 6);
    expect(a.run.engine.monitored.spo2Pct).toBeCloseTo(b.run.engine.monitored.spo2Pct, 6);
    expect(a.run.engine.phys.paco2MmHg).toBeCloseTo(b.run.engine.phys.paco2MmHg, 6);
  });

  it('a blood gas reports the blood as it was when drawn, not when the result returns', async () => {
    const { rt, run } = await setup(copd);
    await advance(rt, run, 60, false);
    const drawnAt = run.engine.simTimeSec;
    await placeOrder(rt, run, 'abg');
    await advance(rt, run, ABG_DELAY_SIM_SEC + 2, false);
    expect(run.abgs).toHaveLength(1);
    expect(run.abgs[0]!.sampledAtSimSec).toBeCloseTo(drawnAt, 1);
  });

  it('refuses once the case has ended', async () => {
    const { rt, run } = await setup(copd);
    run.ended = { outcome: 'completed', reason: 'test', simTimeSec: 0 };
    await expect(observe(rt, run, 5)).rejects.toThrow('ended');
  });
});
