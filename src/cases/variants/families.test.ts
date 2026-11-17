/**
 * Direction tests for the four variant families (ARDS, obstructive, weaning, high-pressure crisis).
 * Each variant is merged onto its base case and run headlessly with the real engine and case runtime.
 * Harm and benefit come only from engine physiology driven by the patient parameters and the learner's orders.
 * Assertions compare arms with each other (and with the untouched arm) using margins, so they keep their
 * direction if the engine is recalibrated; a few absolute checks only pin the starting state.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../../engine/index';
import { MemoryEventSink } from '../../shared/eventSink';
import { CaseSchema, type CaseFile, type OrderType, type Metric } from '../../shared/caseSchema';
import { startRun, advance, metric, placeOrder, answerPrediction, type Runtime, type RunState } from '../../runtime/caseRuntime';
import { mergeVariant, type CaseVariantMetadata } from './loader';

const variantFiles = import.meta.glob<CaseVariantMetadata>('./*.json', { eager: true, import: 'default' });
const baseFiles = import.meta.glob<unknown>('../library/*.json', { eager: true, import: 'default' });

function loadVariant(variantId: string): CaseFile {
  const meta = variantFiles[`./${variantId}.json`];
  if (!meta) throw new Error(`variant not found: ${variantId}`);
  const base = CaseSchema.parse(baseFiles[`../library/${meta.baseCaseId}.json`]);
  return mergeVariant(base, meta);
}

interface Step { min: number; order: OrderType; detail?: Record<string, unknown> }
const set = (min: number, detail: Record<string, unknown>): Step => ({ min, order: 'change-settings', detail });
const ord = (min: number, order: OrderType, detail?: Record<string, unknown>): Step => ({ min, order, detail });

interface Snap { run: RunState; m: (k: Metric) => number }

/** Runs a variant, placing each step at its minute, and returns the state at atMin (or when the case ended). */
async function play(variantId: string, steps: Step[], atMin: number): Promise<Snap> {
  const rt: Runtime = { engine, sink: new MemoryEventSink() };
  const run = await startRun(rt, loadVariant(variantId), { sessionId: 'families-test' });
  const toTime = async (min: number) => {
    let guard = 0;
    while (!run.ended && run.engine.simTimeSec < min * 60 && guard++ < 30) {
      const r = await advance(rt, run, min * 60 - run.engine.simTimeSec, false);
      if (r.paused === 'prediction') {
        const p = run.pendingPrediction as { format?: string; options?: string[]; variables?: string[] } | null;
        await answerPrediction(rt, run, p?.format === 'choice' ? p.options![0] : p?.format === 'numeric' ? 0 : Object.fromEntries((p?.variables ?? []).map(v => [v, 'same'])) as never, 'unsure' as never);
      } else if (r.paused === 'ended') break;
    }
  };
  for (const s of [...steps].sort((a, b) => a.min - b.min)) {
    await toTime(s.min);
    if (!run.ended) await placeOrder(rt, run, s.order, s.detail);
  }
  await toTime(atMin);
  return { run, m: k => metric(run, k) ?? NaN };
}

const T = 120_000;

describe('ARDS family', () => {
  it('obese stiff chest wall: protective Vt with PEEP and rate helps; a large Vt breaches Pplat', async () => {
    const id = 'ards-vent-01--obese-stiff-chest-wall';
    const start = await play(id, [], 30);
    const good = await play(id, [set(1, { vtSetMl: 340, rrSetBpm: 30, peep: 12 })], 30);
    const bad = await play(id, [set(1, { vtSetMl: 780, rrSetBpm: 14 })], 30);
    expect(start.m('pplat')).toBeGreaterThanOrEqual(28);
    expect(good.m('pplat')).toBeLessThanOrEqual(start.m('pplat') - 5);
    expect(good.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 5);
    expect(good.m('ph')).toBeGreaterThanOrEqual(7.3);
    expect(good.m('plEndInsp')).toBeLessThan(good.m('pplat'));
    expect(bad.m('pplat')).toBeGreaterThanOrEqual(start.m('pplat') + 7);
  }, T);

  it('moderate, low recruitability: protective Vt lowers Pplat; high PEEP raises it for little oxygen gain', async () => {
    const id = 'ards-vent-01--moderate-low-recruit';
    const start = await play(id, [], 30);
    const good = await play(id, [set(1, { vtSetMl: 430, rrSetBpm: 24, peep: 8 })], 30);
    const bad = await play(id, [set(1, { vtSetMl: 430, rrSetBpm: 24, peep: 13 })], 30);
    expect(good.m('pplat')).toBeLessThan(start.m('pplat') - 3);
    expect(bad.m('pplat') - good.m('pplat')).toBeGreaterThanOrEqual(8);
    expect(bad.m('spo2') - good.m('spo2')).toBeLessThanOrEqual(3);
  }, T);

  it('moderate, low recruitability: proning does not make the patient worse', async () => {
    const id = 'ards-vent-01--moderate-low-recruit';
    const start = await play(id, [], 60);
    const prone = await play(id, [ord(1, 'prone')], 60);
    expect(prone.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2'));
  }, T);

  it('severe, high recruitability: PEEP titration rescues oxygenation; FiO2 alone does not', async () => {
    const id = 'ards-vent-01--severe-high-recruit';
    const start = await play(id, [], 30);
    const good = await play(id, [set(1, { peep: 12 }), set(10, { peep: 14, fio2: 0.7 })], 30);
    const bad = await play(id, [set(1, { fio2: 1.0 })], 30);
    expect(good.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 10);
    expect(good.m('pplat')).toBeLessThanOrEqual(30);
    expect(bad.m('spo2')).toBeLessThanOrEqual(start.m('spo2') + 4);
  }, T);

  it('severe, low recruitability: proning helps; very high PEEP only raises Pplat', async () => {
    const id = 'ards-vent-01--severe-low-recruit';
    const start = await play(id, [], 60);
    const prone = await play(id, [ord(1, 'prone')], 60);
    const bad = await play(id, [set(1, { peep: 16 })], 60);
    expect(prone.m('spo2') - start.m('spo2')).toBeGreaterThanOrEqual(8);
    expect(bad.m('pplat') - start.m('pplat')).toBeGreaterThanOrEqual(8);
    expect(bad.m('spo2') - start.m('spo2')).toBeLessThanOrEqual(4);
  }, T);

  it('high dead space: raising the rate clears CO2 within limits; a bigger Vt breaches Pplat', async () => {
    const id = 'ards-vent-01--high-dead-space';
    const start = await play(id, [], 30);
    const good = await play(id, [set(1, { rrSetBpm: 32 })], 30);
    const bad = await play(id, [set(1, { vtSetMl: 700 })], 30);
    expect(start.m('paco2')).toBeGreaterThanOrEqual(55);
    expect(good.m('paco2')).toBeLessThanOrEqual(start.m('paco2') - 8);
    expect(good.m('pplat')).toBeLessThanOrEqual(30);
    expect(bad.m('pplat')).toBeGreaterThanOrEqual(30);
    expect(bad.m('pplat')).toBeGreaterThanOrEqual(good.m('pplat') + 5);
  }, T);
});

describe('Obstructive family', () => {
  it('severe asthma with hyperinflation: lower rate plus bronchodilator reverses hypotension; a faster rate worsens it', async () => {
    const id = 'asthma-vent-01--severe-hyperinflation-hypotension';
    const start = await play(id, [], 30);
    const good = await play(id, [set(1, { rrSetBpm: 14, vtSetMl: 450, inspFlowLpm: 80 }), ord(1, 'bronchodilator'), ord(2, 'fluid-bolus')], 30);
    const bad = await play(id, [set(1, { rrSetBpm: 30, vtSetMl: 560 })], 10);
    expect(start.m('autoPeep')).toBeGreaterThan(8);
    expect(start.m('sbp')).toBeLessThan(90);
    expect(good.m('autoPeep')).toBeLessThanOrEqual(start.m('autoPeep') - 6);
    expect(good.m('sbp')).toBeGreaterThanOrEqual(start.m('sbp') + 20);
    expect(good.m('ph')).toBeGreaterThanOrEqual(7.15);
    expect(bad.m('autoPeep')).toBeGreaterThanOrEqual(start.m('autoPeep') + 8);
    expect(bad.m('sbp')).toBeLessThanOrEqual(start.m('sbp') - 20);
  }, T);

  it('asthma with permissive hypercapnia: normalising CO2 with a high rate causes auto-PEEP and hypotension', async () => {
    const id = 'asthma-vent-01--permissive-hypercapnia';
    const start = await play(id, [], 30);
    const bad = await play(id, [set(1, { rrSetBpm: 26 })], 30);
    const fluid = await play(id, [ord(1, 'fluid-bolus')], 30);
    expect(start.m('paco2')).toBeGreaterThanOrEqual(60);
    expect(bad.m('paco2')).toBeLessThanOrEqual(start.m('paco2') - 20);
    expect(bad.m('autoPeep')).toBeGreaterThanOrEqual(start.m('autoPeep') + 6);
    expect(bad.m('sbp')).toBeLessThanOrEqual(start.m('sbp') - 15);
    expect(fluid.m('sbp')).toBeGreaterThanOrEqual(start.m('sbp'));
  }, T);

  it('COPD on pressure support: bronchodilator plus PEEP at ~80% of measured auto-PEEP is best; PEEP above auto-PEEP worsens hyperinflation', async () => {
    const id = 'copd-psv-trigger-01--ineffective-efforts-autopeep';
    const total = (x: Snap) => x.m('autoPeep') + x.m('peep');
    const start = await play(id, [], 2);
    const bd = await play(id, [ord(1, 'bronchodilator')], 18);
    const peepOnly = await play(id, [set(1, { peep: 7 })], 18); // measured auto-PEEP at the start is about 8.8, so 7 is about 80%
    const good = await play(id, [ord(1, 'bronchodilator'), set(1, { peep: 7 })], 18);
    const tooMuch = await play(id, [set(1, { peep: 14 })], 18); // above the auto-PEEP
    const sedated = await play(id, [ord(1, 'sedation')], 18);
    expect(start.m('autoPeep')).toBeGreaterThanOrEqual(5);
    expect(start.m('peep') / start.m('autoPeep')).toBeLessThan(1);
    expect(bd.m('ph')).toBeGreaterThan(start.m('ph') + 0.05);
    expect(bd.m('autoPeep')).toBeLessThanOrEqual(start.m('autoPeep') - 2);
    expect(good.m('ph')).toBeGreaterThan(bd.m('ph'));
    expect(good.m('ph')).toBeGreaterThanOrEqual(7.35);
    expect(good.m('paco2')).toBeLessThan(start.m('paco2'));
    expect(peepOnly.m('ph')).toBeLessThan(good.m('ph') - 0.15);
    // mistake arm: PEEP above the auto-PEEP adds to total PEEP and plateau pressure
    expect(total(tooMuch)).toBeGreaterThanOrEqual(total(good) + 6);
    expect(tooMuch.m('pplat')).toBeGreaterThanOrEqual(good.m('pplat') + 4);
    // waterfall: PEEP at ~80% of auto-PEEP does not raise total PEEP much over the starting level
    expect(total(peepOnly) - total(start)).toBeLessThanOrEqual(3);
    expect(sedated.m('rrSpont')).toBeLessThanOrEqual(5);
    expect(sedated.m('ph')).toBeLessThan(good.m('ph') - 0.15);
  }, T);

  it('COPD on NIV with a tiny IPAP-EPAP gap fails to ventilate; IPAP 18 over EPAP 5 corrects CO2', async () => {
    const id = 'copd-niv-01--niv-pressure-support-too-low';
    const mk = (epap: number, ipap: number) => ord(1, 'change-device', { device: { device: 'niv', mode: 'ST', fio2: 0.4, epap, ipap, backupRrBpm: 12, interface: 'oronasal', maskFit: 'good' } });
    const none = await play(id, [], 60);
    const good = await play(id, [mk(5, 18)], 60);
    const bad = await play(id, [mk(10, 12)], 60);
    expect(good.m('paco2')).toBeLessThanOrEqual(none.m('paco2') - 25);
    expect(good.m('ph')).toBeGreaterThanOrEqual(7.35);
    expect(bad.m('paco2') - good.m('paco2')).toBeGreaterThanOrEqual(30);
    expect(bad.m('vte')).toBeLessThan(good.m('vte'));
  }, T);
});

describe('Weaning family', () => {
  it('older patient who passes: stable on PS 5; sedation hands ventilation to the apnoea backup', async () => {
    const id = 'sbt-pass-01--pass-older-patient';
    const start = await play(id, [], 40);
    const bad = await play(id, [ord(1, 'sedation')], 20);
    expect(start.m('rsbi')).toBeLessThan(80);
    expect(start.m('paco2')).toBeLessThanOrEqual(45);
    // apnoea backup: sedation ends his own breathing, the alarm is on and the ventilator breathes for him (gases hold)
    expect(bad.m('rrSpont')).toBeLessThanOrEqual(3);
    expect(bad.m('alarmActive:apnoea')).toBe(1);
    expect(bad.m('minuteVent')).toBeGreaterThanOrEqual(4);
    expect(bad.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') - 3);
  }, T);

  it('weak diaphragm: fails the trial with a high RSBI; PS 12 / PEEP 8 reverses it', async () => {
    const id = 'sbt-fail-01--weak-diaphragm-hypercapnic';
    const start = await play(id, [], 20);
    const good = await play(id, [set(1, { psAbovePeep: 12, peep: 8 })], 20);
    expect(start.m('rsbi')).toBeGreaterThan(105);
    expect(good.m('rsbi')).toBeLessThanOrEqual(start.m('rsbi') - 60);
    expect(good.m('paco2')).toBeLessThanOrEqual(start.m('paco2') - 20);
    expect(good.m('fatigue')).toBeLessThan(start.m('fatigue'));
  }, T);

  it('cardiac failure on the trial: PEEP/PS plus diuretic clears the hypoxaemia; extubation is unsafe', async () => {
    const id = 'sbt-fail-01--cardiac-failure-sbt';
    const start = await play(id, [], 60);
    const good = await play(id, [set(1, { psAbovePeep: 10, peep: 10 }), ord(2, 'diuretic')], 60);
    const diuOnly = await play(id, [ord(1, 'diuretic')], 60);
    const ext = await play(id, [ord(1, 'extubate')], 10);
    expect(start.m('sbp')).toBeGreaterThanOrEqual(150);
    expect(good.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 5);
    expect(diuOnly.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 5);
    expect(diuOnly.m('sbp')).toBeLessThanOrEqual(start.m('sbp') - 12);
    expect(ext.run.ended?.outcome).toBe('deteriorated');
  }, T);

  it('borderline trial: a reassessed return to PS 10 settles the patient; running on PS 3 drives fatigue; extubating flags a mistake', async () => {
    const id = 'sbt-pass-01--borderline-reassess';
    const start = await play(id, [], 40);
    const good = await play(id, [ord(10, 'abg'), set(12, { psAbovePeep: 10 }), ord(20, 'abg')], 40);
    const bad = await play(id, [set(1, { psAbovePeep: 3 })], 40);
    const ext = await play(id, [ord(5, 'extubate')], 10);
    expect(start.m('rsbi')).toBeGreaterThan(100);
    expect(good.m('rsbi')).toBeLessThanOrEqual(start.m('rsbi') - 30);
    expect(good.m('fatigue')).toBeLessThan(start.m('fatigue'));
    expect(good.run.ended?.outcome).toBe('improved');
    expect(bad.m('rsbi')).toBeGreaterThanOrEqual(start.m('rsbi') + 40);
    expect(bad.m('paco2')).toBeGreaterThanOrEqual(start.m('paco2') + 12);
    expect(ext.run.fired).toContain('t-mistake-extubate');
  }, T);
});

describe('High-pressure crisis family', () => {
  it('has no scripted course events and no dead-end orders', () => {
    for (const k of Object.keys(variantFiles)) {
      const meta = variantFiles[k];
      if (meta.baseCaseId !== 'vent-high-pressure-01') continue;
      const c = loadVariant(meta.variantId);
      expect(c.course, meta.variantId).toEqual([]);
      const effects = new Set(c.orderEffects.map(e => e.order));
      for (const o of ['suction', 'bronchodilator', 'call-senior', 'diuretic'] as const) {
        if (c.availableOrders.includes(o)) expect(effects.has(o), `${meta.variantId} ${o}`).toBe(true);
      }
    }
  });

  it('mucus plug: high peak with normal plateau; suction restores it; a faster rate adds trapping', async () => {
    const id = 'vent-high-pressure-01--mucus-plug';
    const start = await play(id, [], 10);
    const good = await play(id, [ord(1, 'examine'), ord(2, 'suction')], 10);
    const bad = await play(id, [set(1, { rrSetBpm: 26 })], 10);
    expect(start.m('ppeak') - start.m('pplat')).toBeGreaterThanOrEqual(15);
    expect(good.m('ppeak')).toBeLessThanOrEqual(start.m('ppeak') - 12);
    expect(bad.m('ppeak')).toBeGreaterThanOrEqual(start.m('ppeak') - 3);
    expect(bad.m('autoPeep')).toBeGreaterThan(start.m('autoPeep') + 1);
  }, T);

  it('mainstem intubation: low compliance and shunt; withdrawing the tube fixes it; more Vt makes Pplat worse', async () => {
    const id = 'vent-high-pressure-01--mainstem-intubation';
    const start = await play(id, [], 10);
    const good = await play(id, [ord(1, 'cxr'), ord(2, 'call-senior')], 10);
    const bad = await play(id, [set(1, { vtSetMl: 600, fio2: 1.0 })], 10);
    expect(good.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 8);
    expect(good.m('pplat')).toBeLessThanOrEqual(start.m('pplat') - 5);
    expect(bad.m('pplat')).toBeGreaterThanOrEqual(start.m('pplat') + 5);
    expect(bad.m('spo2')).toBeLessThan(good.m('spo2') - 5);
  }, T);

  it('bronchospasm: high peak, normal plateau; bronchodilator helps; a faster rate drops blood pressure', async () => {
    const id = 'vent-high-pressure-01--drug-bronchospasm';
    const start = await play(id, [], 10);
    const good = await play(id, [ord(1, 'bronchodilator')], 10);
    const bad = await play(id, [set(1, { rrSetBpm: 28 })], 10);
    expect(start.m('ppeak') - start.m('pplat')).toBeGreaterThanOrEqual(15);
    expect(good.m('ppeak')).toBeLessThanOrEqual(start.m('ppeak') - 8);
    expect(good.m('sbp')).toBeGreaterThanOrEqual(start.m('sbp') + 6);
    expect(bad.m('autoPeep')).toBeGreaterThanOrEqual(start.m('autoPeep') + 3);
    expect(bad.m('sbp')).toBeLessThanOrEqual(start.m('sbp') - 5);
  }, T);

  it('auto-PEEP stacking: a slower rate with faster flow clears trapping; slower flow worsens it', async () => {
    const id = 'vent-high-pressure-01--auto-peep-stacking';
    const start = await play(id, [], 10);
    const good = await play(id, [set(1, { rrSetBpm: 12, inspFlowLpm: 70 })], 10);
    const bad = await play(id, [set(1, { inspFlowLpm: 25 })], 10);
    expect(start.m('autoPeep')).toBeGreaterThanOrEqual(4);
    expect(good.m('autoPeep')).toBeLessThanOrEqual(start.m('autoPeep') - 3);
    expect(good.m('sbp')).toBeGreaterThanOrEqual(start.m('sbp') + 10);
    expect(bad.m('autoPeep')).toBeGreaterThanOrEqual(start.m('autoPeep') + 1.5);
    expect(bad.m('sbp')).toBeLessThan(start.m('sbp'));
  }, T);

  it('pulmonary oedema: low compliance and shunt; diuretic with PEEP improves; removing PEEP worsens oxygenation', async () => {
    const id = 'vent-high-pressure-01--pulmonary-oedema';
    const start = await play(id, [], 30);
    const good = await play(id, [ord(1, 'diuretic'), set(1, { peep: 10 })], 30);
    const bad = await play(id, [set(1, { peep: 0 })], 30);
    expect(start.m('sbp')).toBeGreaterThanOrEqual(150);
    expect(good.m('spo2')).toBeGreaterThanOrEqual(start.m('spo2') + 5);
    expect(good.m('pplat')).toBeLessThanOrEqual(start.m('pplat') - 2);
    expect(good.m('sbp')).toBeLessThanOrEqual(start.m('sbp') - 10);
    expect(bad.m('spo2')).toBeLessThanOrEqual(start.m('spo2') - 5);
  }, T);
});

describe('Variant text hygiene', () => {
  it('inherited text carries no wrong-sex pronouns in the new variants', () => {
    const skip = ['ards-vent-01--pbw-short-female', 'ards-vent-01--severe-prone-elderly', 'copd-niv-01--exhaustion-failure', 'copd-niv-01--retention-alkalosis'];
    for (const k of Object.keys(variantFiles)) {
      const meta = variantFiles[k];
      if (!meta.variantId || skip.includes(meta.variantId)) continue;
      if (!/^(ards|asthma|copd-psv|copd-niv-01--niv-pressure|sbt|vent-high)/.test(meta.variantId)) continue;
      const c = loadVariant(meta.variantId);
      const txt = JSON.stringify([c.triggers, c.orderEffects, c.predictionPoints, c.rubric, c.debrief]);
      const wrong = c.patient.params.sex === 'F' ? /\b(he|his|him)\b/i : /\b(she|her|hers)\b/i;
      expect(wrong.test(txt), meta.variantId).toBe(false);
    }
  });

  it('each variant retests a competency its merged case assesses', () => {
    for (const k of Object.keys(variantFiles)) {
      const meta = variantFiles[k];
      if (!meta.variantId) continue;
      expect(loadVariant(meta.variantId).competencies, meta.variantId).toContain(meta.retestsMistake.competencyId);
    }
  });
});
