/**
 * Case runtime: runs a case file against the engine.
 * - Evaluates triggers and rubric conditions once per simulated second (semantics in docs/CONTRACTS.md).
 * - Applies orders, delayed order effects, ramps and the scheduled course.
 * - Pauses for prediction points; marks them from engine output or a fixed key.
 * - Emits learner events. No AI anywhere; every judgement is a rule from the case file.
 */
import type { AbgResult, DeviceSettings, EngineApi, EngineState, ManoeuvreResult, PatientParams, WaveformSample } from '../shared/engineTypes';
import type { CaseAction, CaseFile, Condition, DeviceKind, Metric, OrderType } from '../shared/caseSchema';
import type { Confidence, EventSink, GuidanceLevel, LearnerEvent } from '../shared/events';
import { EVENT_SCHEMA_VERSION } from '../shared/events';
import { newId } from '../shared/eventSink';
import { metricOf } from '../engine/metrics';

export const ABG_DELAY_SIM_SEC = 180;
/** Disconnecting the ventilator lets trapped gas out; the circuit is reconnected with the same settings after this long. */
export const DISCONNECT_SEC = 30;
/** An engine-marked prediction is scored on an ABG drawn at least this long after the answer... */
export const ENGINE_MARK_MIN_SEC = 15 * 60;
/** ...or, failing that, this long after the answer using the current values. */
const ENGINE_MARK_TIMEOUT_SEC = 30 * 60;
/** Changes smaller than this count as "same" when marking direction predictions. */
export const NOISE_BAND: Partial<Record<Metric, number>> = { ph: 0.02, paco2: 3, pao2: 5, spo2: 1, rrTotal: 2, rrSpont: 2, hr: 5, map: 5, sbp: 5, vte: 30, ppeak: 2, pplat: 1, autoPeep: 1, etco2: 3, fatigue: 0.05, minuteVent: 0.5, pfRatio: 15, drivingPressure: 1 };

export type Direction = 'up' | 'down' | 'same';

export interface RunMessage { simTimeSec: number; from: string; text: string }
export interface PlacedOrder { order: OrderType; simTimeSec: number; detail?: Record<string, unknown> }

interface PendingEffect { dueSec: number; actions: CaseAction[]; source: string }
interface Ramp { startSec: number; endSec: number; from: Partial<PatientParams>; to: Partial<PatientParams> }
interface PendingMark { predictionId: string; answer: Record<string, Direction>; confidence: Confidence; baseline: Record<string, number | null>; answeredAtSec: number; latencyMs: number }

export interface RunState {
  runId: string;
  sessionId: string;
  caseFile: CaseFile;
  engine: EngineState;
  guidance: Record<string, GuidanceLevel>;
  orders: PlacedOrder[];
  fired: string[];
  thresholdSince: Record<string, number>;
  effects: PendingEffect[];
  ramps: Ramp[];
  courseDone: number[];
  messages: RunMessage[];
  findings: { examine?: string; cxr?: string };
  /** Text a 'finding' action substitutes for the case's static finding from then on (a later exam shows the change). */
  findingOverrides?: { examine?: string; cxr?: string };
  abgs: AbgResult[];
  pendingAbgs: number[];          // due times
  /** Samples already drawn and on their way to the analyser, in the same order as pendingAbgs. */
  pendingAbgSamples?: AbgResult[];
  reconnect: { dueSec: number; device: DeviceSettings } | null;
  pendingPrediction: { id: string; askedAtSec: number; askedAtWall: number } | null;
  predictionsAsked: string[];
  pendingMarks: PendingMark[];
  /**
   * Engine-marked predictions that were never scored: still waiting (under 15 simulated minutes) when the run finished,
   * or superseded by a later settings/device change before they could be marked (reason says which).
   */
  unscoredPredictions?: { predictionId: string; elapsedSec: number; reason?: string }[];
  predictionResults: { predictionId: string; correct: boolean; answer: unknown; expected: unknown; confidence: Confidence }[];
  rubricMetEver: Record<string, boolean>;
  mistakes: { mistake: string; competency: string; severity: string; detail: string; simTimeSec: number }[];
  ended: { outcome: 'improved' | 'stable' | 'deteriorated' | 'died' | 'escalated' | 'abandoned' | 'completed'; reason: string; simTimeSec: number } | null;
  finished: boolean;
  /** Result of the most recent inspiratory or expiratory hold (real-time stepping only). */
  lastManoeuvre?: ManoeuvreResult | null;
  /** Periods the learner chose to watch without changing anything (see observe()). */
  observations?: Observation[];
  /** Help the learner used during this run (tutor turns, hints, reveals). Drives the evidence guidance level. */
  assistance?: RunAssistance;
}

export interface RunAssistance { tutorTurns: number; hints: number }

/** Record that the learner used a tutor turn (or a hint / answer reveal) during the given run.
 *  The counts live only on the run object, so they survive with the rest of the run state. */
export function noteAssistance(run: RunState, kind: 'tutor' | 'hint'): void {
  const a = run.assistance ?? { tutorTurns: 0, hints: 0 };
  if (kind === 'hint') a.hints++; else a.tutorTurns++;
  run.assistance = a;
}

/**
 * Guidance level recorded on a piece of evidence. 'independent' only when no tutor turns and no
 * hints/reveals were used in this run before the evidence was written; a scaffolded ('guided') run
 * stays 'guided'; anything else is 'prompted'.
 */
export function evidenceGuidance(run: RunState, competency: string): GuidanceLevel {
  if (run.guidance[competency] === 'guided') return 'guided';
  const a = run.assistance ?? { tutorTurns: 0, hints: 0 };
  return a.tutorTurns === 0 && a.hints === 0 ? 'independent' : 'prompted';
}

export interface Runtime {
  engine: EngineApi;
  sink: EventSink;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function base(run: RunState) {
  return {
    v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION, id: newId(), wallTime: new Date().toISOString(), sessionId: run.sessionId, runId: run.runId,
    activity: 'case' as const, activityId: run.caseFile.id, activityVersion: run.caseFile.version,
    simTimeSec: Math.round(run.engine.simTimeSec), contextTags: run.caseFile.contextTags,
  };
}
async function emit(rt: Runtime, e: LearnerEvent) { await rt.sink.record(e); }

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startRun(rt: Runtime, caseFile: CaseFile, opts: { sessionId: string; guidance?: Record<string, GuidanceLevel>; runId?: string }): Promise<RunState> {
  const engineState = rt.engine.createState(caseFile.patient.params as PatientParams, caseFile.initialDevice as DeviceSettings, caseFile.initialPhys);
  const guidance: Record<string, GuidanceLevel> = {};
  for (const c of caseFile.competencies) guidance[c] = opts.guidance?.[c] ?? 'prompted';
  const run: RunState = {
    runId: opts.runId ?? newId(), sessionId: opts.sessionId, caseFile, engine: engineState, guidance,
    orders: [], fired: [], thresholdSince: {}, effects: [], ramps: [], courseDone: [], messages: [], findings: {},
    abgs: [], pendingAbgs: [], reconnect: null, pendingPrediction: null, predictionsAsked: [], pendingMarks: [], predictionResults: [],
    rubricMetEver: {}, mistakes: [], ended: null, finished: false,
  };
  await emit(rt, { ...base(run), type: 'run_start', guidanceByCompetency: guidance });
  await evaluate(rt, run);
  return run;
}

// ---------------------------------------------------------------------------
// Metrics and conditions
// ---------------------------------------------------------------------------

export function metric(run: RunState, m: Metric): number | null {
  return metricOf(run.engine, m);
}

function cmp(v: number, op: '<' | '<=' | '>' | '>=', x: number) {
  return op === '<' ? v < x : op === '<=' ? v <= x : op === '>' ? v > x : v >= x;
}

/** The device family a change-device or intubate order moved the patient to (undefined when it did not say). */
function orderedDeviceKind(o: PlacedOrder): DeviceKind | undefined {
  const d = (typeof o.detail?.device === 'string' ? o.detail : o.detail?.device) as { device?: DeviceKind } | undefined;
  if (d?.device) return d.device;
  return o.order === 'intubate' ? 'invasive' : undefined;
}

/** Evaluate a condition. `key` identifies the condition for forSimSec tracking. */
export function check(run: RunState, c: Condition, key: string): boolean {
  if (c.all) return c.all.map((x, i) => check(run, x, `${key}.all${i}`)).every(Boolean);
  if (c.any) return c.any.map((x, i) => check(run, x, `${key}.any${i}`)).some(Boolean);
  if (c.not) return !check(run, c.not, `${key}.not`);
  if (c.fired) return run.fired.includes(c.fired);
  if (c.ordered) {
    const { order, withinSimMin, minCount = 1, deviceKind } = c.ordered;
    const n = run.orders.filter(o => o.order === order && (withinSimMin === undefined || o.simTimeSec <= withinSimMin * 60)
      && (!deviceKind || (orderedDeviceKind(o) !== undefined && deviceKind.includes(orderedDeviceKind(o)!)))).length;
    return n >= minCount;
  }
  if (c.threshold) {
    const v = metric(run, c.threshold.metric);
    const holds = v !== null && cmp(v, c.threshold.op, c.threshold.value);
    const need = c.threshold.forSimSec ?? 0;
    if (!holds) { delete run.thresholdSince[key]; return false; }
    if (need <= 0) return true;
    if (run.thresholdSince[key] === undefined) run.thresholdSince[key] = run.engine.simTimeSec;
    return run.engine.simTimeSec - run.thresholdSince[key] >= need;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function apply(rt: Runtime, run: RunState, a: CaseAction) {
  const t = run.engine.simTimeSec;
  switch (a.type) {
    case 'patientChange': {
      const change = a.change as Partial<PatientParams>;
      if (!a.rampSimMin) { run.engine = rt.engine.setPatient(run.engine, change); break; }
      const from: Partial<PatientParams> = {};
      for (const k of Object.keys(change) as (keyof PatientParams)[]) (from as Record<string, unknown>)[k] = run.engine.patient[k];
      run.ramps.push({ startSec: t, endSec: t + a.rampSimMin * 60, from, to: change });
      break;
    }
    case 'message': run.messages.push({ simTimeSec: t, from: a.from, text: a.text }); break;
    case 'finding': (run.findingOverrides ??= {})[a.order] = a.text; break;
    case 'prediction':
      if (!run.predictionsAsked.includes(a.predictionId) && !run.ended) {
        run.predictionsAsked.push(a.predictionId);
        run.pendingPrediction = { id: a.predictionId, askedAtSec: t, askedAtWall: Date.now() };
      }
      break;
    case 'mistake':
      run.mistakes.push({ mistake: a.mistake, competency: a.competency, severity: a.severity, detail: a.detail, simTimeSec: t });
      await emit(rt, { ...base(run), type: 'mistake', mistake: a.mistake, competency: a.competency, severity: a.severity, detail: a.detail });
      break;
    case 'endCase':
      if (!run.ended) run.ended = { outcome: a.outcome, reason: a.reason, simTimeSec: t };
      break;
  }
}

function applyRamps(rt: Runtime, run: RunState) {
  const t = run.engine.simTimeSec;
  if (!run.ramps.length) return;
  const patch: Partial<PatientParams> = {};
  for (const r of run.ramps) {
    const f = Math.min(1, (t - r.startSec) / Math.max(1, r.endSec - r.startSec));
    for (const k of Object.keys(r.to) as (keyof PatientParams)[]) {
      const a = r.from[k], b = r.to[k];
      (patch as Record<string, unknown>)[k] = typeof a === 'number' && typeof b === 'number' ? a + (b - a) * f : b;
    }
  }
  run.engine = rt.engine.setPatient(run.engine, patch);
  run.ramps = run.ramps.filter(r => t < r.endSec);
}

// ---------------------------------------------------------------------------
// Evaluation (once per simulated second)
// ---------------------------------------------------------------------------

async function evaluate(rt: Runtime, run: RunState) {
  const c = run.caseFile, t = run.engine.simTimeSec;
  applyRamps(rt, run);
  // scheduled course
  for (let i = 0; i < c.course.length; i++) {
    const step = c.course[i];
    if (!run.courseDone.includes(i) && t >= step.atSimMin * 60) { run.courseDone.push(i); for (const a of step.actions) await apply(rt, run, a); }
  }
  // delayed order effects
  const due = run.effects.filter(e => e.dueSec <= t);
  run.effects = run.effects.filter(e => e.dueSec > t);
  for (const e of due) for (const a of e.actions) await apply(rt, run, a);
  // reconnect after a disconnection, keeping any settings changed meanwhile
  if (run.reconnect && run.reconnect.dueSec <= t) {
    run.engine = rt.engine.setDevice(run.engine, run.reconnect.device);
    run.reconnect = null;
  }
  // ABG results
  const ready = run.pendingAbgs.filter(d => d <= t);
  run.pendingAbgs = run.pendingAbgs.filter(d => d > t);
  for (const _ of ready) {
    // The result describes the blood as it was when the sample was taken, not as the patient is now.
    const abg = run.pendingAbgSamples?.shift() ?? rt.engine.drawAbg(run.engine);
    run.abgs.push(abg);
    await emit(rt, { ...base(run), type: 'abg_result', abg });
    await markEnginePredictions(rt, run, 'abg', abg);
  }
  // triggers in file order
  for (const tr of c.triggers) {
    if (tr.once && run.fired.includes(tr.id)) continue;
    if (check(run, tr.when, `trigger:${tr.id}`)) {
      if (!run.fired.includes(tr.id)) run.fired.push(tr.id);
      for (const a of tr.then) await apply(rt, run, a);
    }
  }
  // rubric items with a deadline
  for (const r of c.rubric) {
    if (r.bySimMin !== undefined && t <= r.bySimMin * 60 && !run.rubricMetEver[r.id] && check(run, r.met, `rubric:${r.id}`)) run.rubricMetEver[r.id] = true;
  }
  // engine-marked predictions that timed out
  if (run.pendingMarks.some(m => t - m.answeredAtSec >= ENGINE_MARK_TIMEOUT_SEC)) await markEnginePredictions(rt, run, 'timeout');
  if (t >= c.maxSimMin * 60 && !run.ended) {
    // The outcome reflects the patient, not the clock (QA3-004).
    const m = run.engine.monitored, ph = metric(run, 'ph');
    const unstable = m.spo2Pct < 85 || m.sbpMmHg < 80 || (ph !== null && ph < 7.2);
    run.ended = unstable
      ? { outcome: 'deteriorated', reason: 'Case time limit reached with the patient still unstable.', simTimeSec: t }
      : { outcome: 'completed', reason: 'Case time limit reached.', simTimeSec: t };
  }
}

// ---------------------------------------------------------------------------
// Advancing time
// ---------------------------------------------------------------------------

export interface TickResult { samples: WaveformSample[]; paused: 'prediction' | 'ended' | null }

/**
 * Advance the simulation. With collect=true, waveform samples are returned for display (real-time use).
 * Stops early when a prediction is asked or the case ends.
 */
export async function advance(rt: Runtime, run: RunState, simSeconds: number, collect = false): Promise<TickResult> {
  const samples: WaveformSample[] = [];
  let remaining = simSeconds;
  while (remaining > 1e-9) {
    if (run.pendingPrediction) return { samples, paused: 'prediction' };
    if (run.ended) return { samples, paused: 'ended' };
    // evaluate on whole simulated seconds
    const toNextSecond = 1 - (run.engine.simTimeSec % 1);
    const chunk = Math.min(remaining, toNextSecond < 1e-6 ? 1 : toNextSecond);
    if (collect) { const r = rt.engine.step(run.engine, chunk); run.engine = r.state; samples.push(...r.samples); if (r.manoeuvre) run.lastManoeuvre = r.manoeuvre; }
    else run.engine = rt.engine.fastForward(run.engine, chunk);
    remaining -= chunk;
    if (Math.abs(run.engine.simTimeSec - Math.round(run.engine.simTimeSec)) < 0.003) await evaluate(rt, run);
  }
  return { samples, paused: run.pendingPrediction ? 'prediction' : run.ended ? 'ended' : null };
}

// ---------------------------------------------------------------------------
// Observe and reassess
// ---------------------------------------------------------------------------

/** Why a period of observation stopped. */
export type ObserveStop = 'ended' | 'prediction' | 'result' | 'message' | 'change' | 'limit';
export interface Observation { fromSec: number; toSec: number; stoppedBy: ObserveStop; /** For 'change': which vital sign moved. */ changed?: string }

/** Vital-sign shifts large enough that a bedside nurse would call the doctor back. Returns what changed, or null. */
function vitalsWorsened(run: RunState, base: Record<'spo2' | 'sbp' | 'hr' | 'rrTotal', number | null>): string | null {
  const now = { spo2: metric(run, 'spo2'), sbp: metric(run, 'sbp'), hr: metric(run, 'hr'), rrTotal: metric(run, 'rrTotal') };
  const fell = (a: number | null, b: number | null, by: number, floor: number) => a !== null && b !== null && (a - b >= by || (a >= floor && b < floor));
  const rose = (a: number | null, b: number | null, by: number) => a !== null && b !== null && b - a >= by;
  const say = (label: string, a: number | null, b: number | null, unit: string) => `${label} ${Math.round(a!)} to ${Math.round(b!)}${unit}`;
  if (fell(base.spo2, now.spo2, 3, 90)) return say('SpO2', base.spo2, now.spo2, '%');
  if (fell(base.sbp, now.sbp, 15, 90)) return say('systolic pressure', base.sbp, now.sbp, ' mmHg');
  if (rose(base.hr, now.hr, 20)) return say('heart rate', base.hr, now.hr, '/min');
  if (rose(base.rrTotal, now.rrTotal, 6)) return say('respiratory rate', base.rrTotal, now.rrTotal, '/min');
  return null;
}

/**
 * The learner decides to change nothing and watch. Simulated time runs through the same engine as
 * real-time play (no physiology is skipped) and stops at the first thing that would bring a doctor
 * back to the bedside: the case ending, a question, a result coming back, a bedside message, a
 * clear worsening of the vital signs, or maxMin minutes. Nothing is revealed early: a blood gas
 * still returns ABG_DELAY_SIM_SEC after it was sent.
 */
export async function observe(rt: Runtime, run: RunState, maxMin = 30): Promise<Observation> {
  if (run.ended) throw new Error('Case has ended');
  const fromSec = run.engine.simTimeSec;
  const start = { spo2: metric(run, 'spo2'), sbp: metric(run, 'sbp'), hr: metric(run, 'hr'), rrTotal: metric(run, 'rrTotal') };
  const nAbg = run.abgs.length, nMsg = run.messages.length;
  let stoppedBy: ObserveStop = 'limit', changed: string | undefined;
  while (run.engine.simTimeSec - fromSec < maxMin * 60 - 1e-6) {
    const r = await advance(rt, run, Math.min(5, maxMin * 60 - (run.engine.simTimeSec - fromSec)), false);
    if (r.paused === 'ended') { stoppedBy = 'ended'; break; }
    if (r.paused === 'prediction') { stoppedBy = 'prediction'; break; }
    if (run.abgs.length > nAbg) { stoppedBy = 'result'; break; }
    if (run.messages.length > nMsg) { stoppedBy = 'message'; break; }
    if ((changed = vitalsWorsened(run, start) ?? undefined)) { stoppedBy = 'change'; break; }
  }
  const obs: Observation = { fromSec, toSec: run.engine.simTimeSec, stoppedBy, ...(changed ? { changed } : {}) };
  (run.observations ??= []).push(obs);
  await emit(rt, { ...base(run), type: 'observe', fromSimSec: Math.round(fromSec), toSimSec: Math.round(obs.toSec), stoppedBy });
  return obs;
}

/** Start an inspiratory or expiratory hold. The result appears in run.lastManoeuvre after real-time stepping. */
export function startHold(rt: Runtime, run: RunState, kind: 'insp-hold' | 'exp-hold', maxSec = kind === 'insp-hold' ? 2 : 4): void {
  if (run.engine.device.device !== 'invasive') throw new Error('Holds need invasive ventilation');
  run.lastManoeuvre = null;
  run.engine = rt.engine.startManoeuvre(run.engine, { kind, maxSec });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function placeOrder(rt: Runtime, run: RunState, order: OrderType, detail?: Record<string, unknown>): Promise<void> {
  const c = run.caseFile, t = run.engine.simTimeSec;
  if (run.ended) throw new Error('Case has ended');
  if (!c.availableOrders.includes(order)) throw new Error(`Order "${order}" is not available in this case`);
  run.orders.push({ order, simTimeSec: t, detail });
  await emit(rt, { ...base(run), type: 'order', order, detail });
  switch (order) {
    case 'abg': run.pendingAbgs.push(t + ABG_DELAY_SIM_SEC); (run.pendingAbgSamples ??= []).push(rt.engine.drawAbg(run.engine)); break;
    case 'examine': run.findings.examine = run.findingOverrides?.examine ?? c.findings.examine; await emit(rt, { ...base(run), type: 'data_viewed', what: 'exam' }); break;
    case 'cxr': run.findings.cxr = run.findingOverrides?.cxr ?? c.findings.cxr; await emit(rt, { ...base(run), type: 'data_viewed', what: 'cxr' }); break;
    case 'change-device': {
      // detail is either { device: DeviceSettings } or a DeviceSettings object itself
      const next = (typeof detail?.device === 'string' ? detail : detail?.device) as DeviceSettings | undefined;
      if (!next) throw new Error('change-device needs detail.device');
      supersedePendingMarks(run);
      const before = run.engine.device;
      run.reconnect = null; // a deliberate device choice replaces the pending reconnection (QA1-001)
      run.engine = rt.engine.setDevice(run.engine, next);
      await emit(rt, { ...base(run), type: 'settings_change', before, after: next });
      break;
    }
    case 'change-settings': {
      // detail is either { settings: Partial<DeviceSettings> } or the partial settings themselves
      const patch = (detail?.settings ?? detail ?? {}) as Partial<DeviceSettings>;
      supersedePendingMarks(run);
      if (run.reconnect) { run.reconnect.device = { ...run.reconnect.device, ...patch } as DeviceSettings; break; }
      const before = run.engine.device;
      const next = { ...before, ...patch } as DeviceSettings;
      if (next.device !== before.device) throw new Error('change-settings cannot change the device type; use change-device');
      run.engine = rt.engine.setDevice(run.engine, next);
      await emit(rt, { ...base(run), type: 'settings_change', before, after: next });
      break;
    }
    case 'intubate': {
      // Intubation always puts the patient on a ventilator: detail.device if given, else a default VC setting
      // the learner must then adjust. Case orderEffects for 'intubate' (e.g. sedation lowering drive, or endCase) apply as well.
      if (run.reconnect?.device.device === 'invasive' && !detail?.device) break; // already intubated; the circuit reconnects
      if (run.engine.device.device !== 'invasive' || detail?.device) {
        supersedePendingMarks(run);
        run.reconnect = null;
        const next: DeviceSettings = (detail?.device as DeviceSettings) ?? { device: 'invasive', mode: 'VC-AC', fio2: 1, peep: 5, rrSetBpm: 16, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square' };
        const before = run.engine.device;
        run.engine = rt.engine.setDevice(run.engine, next);
        await emit(rt, { ...base(run), type: 'settings_change', before, after: next });
      }
      break;
    }
    case 'disconnect-ventilator': {
      const before = run.engine.device;
      if (before.device !== 'invasive' && before.device !== 'niv') break;
      run.reconnect = { dueSec: t + DISCONNECT_SEC, device: before };
      run.engine = rt.engine.setDevice(run.engine, { device: 'none', o2: 'room-air', o2FlowLpm: 0 });
      break;
    }
    default: break;
  }
  for (const e of c.orderEffects.filter(e => e.order === order)) {
    if (e.delaySimMin <= 0) for (const a of e.actions) await apply(rt, run, a);
    else run.effects.push({ dueSec: t + e.delaySimMin * 60, actions: e.actions, source: order });
  }
  await evaluate(rt, run);
}

// ---------------------------------------------------------------------------
// Predictions (answer committed before any feedback)
// ---------------------------------------------------------------------------

export function currentPrediction(run: RunState) {
  if (!run.pendingPrediction) return null;
  return run.caseFile.predictionPoints.find(p => p.id === run.pendingPrediction!.id) ?? null;
}

export interface PredictionFeedback { status: 'marked' | 'awaiting-physiology'; correct?: boolean; expected?: unknown; explanation?: string }

export async function answerPrediction(rt: Runtime, run: RunState, answer: string | number | Record<string, Direction>, confidence: Confidence): Promise<PredictionFeedback> {
  const p = currentPrediction(run);
  if (!p) throw new Error('No prediction is waiting for an answer');
  const latencyMs = Date.now() - run.pendingPrediction!.askedAtWall;
  run.pendingPrediction = null;
  if (p.marking === 'fixed') {
    let correct: boolean;
    if (p.format === 'numeric') correct = Math.abs(Number(answer) - Number(p.answerKey)) <= (p.tolerance ?? 0);
    else if (p.format === 'direction') correct = JSON.stringify(answer) === JSON.stringify(p.answerKey);
    else correct = answer === p.answerKey;
    await recordPrediction(rt, run, p.id, answer, p.answerKey, correct, confidence, latencyMs);
    return { status: 'marked', correct, expected: p.answerKey, explanation: p.explanation };
  }
  if (p.format !== 'direction' || typeof answer !== 'object') throw new Error('Engine-marked predictions use the direction format');
  const baseline: Record<string, number | null> = {};
  for (const v of p.variables ?? []) baseline[v] = metric(run, v);
  run.pendingMarks.push({ predictionId: p.id, answer, confidence, baseline, answeredAtSec: run.engine.simTimeSec, latencyMs });
  return { status: 'awaiting-physiology' };
}

/**
 * A later settings or device change means a pending mark would judge a different intervention than the one the
 * learner predicted for, so it is resolved as unscored (no prediction event, no calibration_error).
 */
function supersedePendingMarks(run: RunState) {
  for (const m of run.pendingMarks) {
    (run.unscoredPredictions ??= []).push({ predictionId: m.predictionId, elapsedSec: run.engine.simTimeSec - m.answeredAtSec, reason: 'superseded by a later change' });
  }
  run.pendingMarks = [];
}

/**
 * 'abg': score marks answered at least 15 min before this result's sample was drawn.
 * 'timeout': score marks 30 min old, with current values.
 * 'finish': score nothing; marks still waiting are recorded as unscored (no calibration_error).
 */
async function markEnginePredictions(rt: Runtime, run: RunState, mode: 'abg' | 'timeout' | 'finish', abg?: AbgResult) {
  const keep: PendingMark[] = [];
  for (const m of run.pendingMarks) {
    const due = mode === 'abg' ? !!abg && abg.sampledAtSimSec - m.answeredAtSec >= ENGINE_MARK_MIN_SEC
      : mode === 'timeout' ? run.engine.simTimeSec - m.answeredAtSec >= ENGINE_MARK_TIMEOUT_SEC
      : false;
    if (!due) {
      if (mode === 'finish') (run.unscoredPredictions ??= []).push({ predictionId: m.predictionId, elapsedSec: run.engine.simTimeSec - m.answeredAtSec });
      else keep.push(m);
      continue;
    }
    const actual: Record<string, Direction> = {};
    for (const [v, b] of Object.entries(m.baseline)) {
      const now = metric(run, v as Metric);
      const band = NOISE_BAND[v as Metric] ?? 0;
      actual[v] = b === null || now === null ? 'same' : now - b > band ? 'up' : b - now > band ? 'down' : 'same';
    }
    const correct = Object.keys(actual).every(k => m.answer[k] === actual[k]);
    await recordPrediction(rt, run, m.predictionId, m.answer, actual, correct, m.confidence, m.latencyMs);
  }
  run.pendingMarks = keep;
}

async function recordPrediction(rt: Runtime, run: RunState, id: string, answer: unknown, expected: unknown, correct: boolean, confidence: Confidence, latencyMs: number) {
  const p = run.caseFile.predictionPoints.find(x => x.id === id)!;
  run.predictionResults.push({ predictionId: id, correct, answer, expected, confidence });
  await emit(rt, {
    ...base(run), type: 'prediction', predictionId: id, question: p.question, answer, expected,
    competency: p.competency, evidenceType: p.evidenceType, correct, confidence,
    guidance: evidenceGuidance(run, p.competency), hidden: p.hidden || run.caseFile.hiddenCompetencies.includes(p.competency), latencyMs,
  });
  if (confidence === 'certain' && !correct) {
    run.mistakes.push({ mistake: 'calibration_error', competency: p.competency, severity: 'minor', detail: `Certain but wrong on: ${p.question}`, simTimeSec: run.engine.simTimeSec });
    await emit(rt, { ...base(run), type: 'mistake', mistake: 'calibration_error', competency: p.competency, severity: 'minor', detail: `Certain but wrong on: ${p.question}` });
  }
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

export async function finishRun(rt: Runtime, run: RunState, abandoned = false): Promise<{ score: number; maxScore: number }> {
  if (run.finished) throw new Error('Run already finished');
  if (!run.ended) run.ended = { outcome: abandoned ? 'abandoned' : 'completed', reason: abandoned ? 'Stopped by learner.' : 'Finished by learner.', simTimeSec: run.engine.simTimeSec };
  await markEnginePredictions(rt, run, 'finish');
  let score = 0, maxScore = 0;
  for (const r of run.caseFile.rubric) {
    const met = r.bySimMin !== undefined ? !!run.rubricMetEver[r.id] : check(run, r.met, `rubric:${r.id}`);
    maxScore += r.weight; if (met) score += r.weight;
    await emit(rt, {
      ...base(run), type: 'rubric_result', rubricId: r.id, met, critical: r.critical,
      competency: r.competency, evidenceType: r.evidenceType, correct: met,
      guidance: evidenceGuidance(run, r.competency), hidden: run.caseFile.hiddenCompetencies.includes(r.competency),
    });
  }
  await emit(rt, { ...base(run), type: 'run_end', outcome: run.ended.outcome, score, maxScore });
  run.finished = true;
  return { score, maxScore };
}
