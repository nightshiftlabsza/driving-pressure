/**
 * Engine v1 public API. Pure from the caller's point of view: every call clones its input.
 * See core.ts for the model and its stated simplifications.
 */
import type { DeviceSettings, EngineApi, EngineState, Manoeuvre, PatientParams, PhysState, StepResult, WaveformSample } from '../shared/engineTypes';
import { DT, I, microStep, newState, abg, initialPao2, truth, currentFio2 } from './core';
import { phFrom, acuteBuffer, initialMetabolicHco3 } from './gas';
import { driveFor } from './devices';
import { aprvShift } from './aprv';
import { validateDevice, validatePatient } from './validate';
import {
  annotateWaveformSample,
  partitionCompliance,
  processManoeuvre,
  updateEffortMonitoring,
} from './effort';

import type { EngineTrace } from './trace';

export { truth, currentFio2 };
export type { Truth } from './core';
export type { EngineTrace } from './trace';

/** Exposes the causal trace recorded in the most recent slow update. */
export function lastTrace(state: EngineState): EngineTrace | null {
  return (state.internal as { trace?: EngineTrace | null } | undefined)?.trace ?? null;
}

const WARMUP_SEC = 20;

function clone<T>(v: T): T { return structuredClone(v); }

function defaultPhys(patient: PatientParams, device: DeviceSettings, phys?: Partial<PhysState>): PhysState {
  const chronicPaco2 = patient.chronicPaco2MmHg ?? 40;
  const paco2 = phys?.paco2MmHg ?? 40;
  const baseMetabolic = patient.chronicPaco2MmHg !== undefined ? initialMetabolicHco3(undefined, paco2, chronicPaco2) : patient.baselineHco3MmolL;
  const hco3 = phys?.hco3MmolL ?? (baseMetabolic + acuteBuffer(paco2, baseMetabolic, chronicPaco2));
  const ph = phFrom(hco3, paco2);
  return {
    paco2MmHg: paco2,
    pao2MmHg: phys?.pao2MmHg ?? initialPao2(patient, device, paco2, ph),
    hco3MmolL: hco3,
    recruitedFraction: phys?.recruitedFraction ?? 0,
    fatigue: phys?.fatigue ?? 0,
    trappedVolumeMl: 0,
    vili: phys?.vili ?? { minutesPplatOver30: 0, minutesDrivingPressureOver15: 0, minutesVtOver8MlKgPbw: 0 },
  };
}

/** Run mechanics only (slow physiology frozen) so breathing reaches a steady pattern, then reset the clock. */
function warmUp(s: EngineState, seconds: number) {
  const frozenPhys = clone(s.phys);
  const x = I(s);
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { x.lastSlow = s.simTimeSec + DT; microStep(s, null); }
  // Keep the settled mechanics, restore slow state, shift times so the run starts at t = 0.
  const shift = s.simTimeSec;
  s.phys = { ...frozenPhys, trappedVolumeMl: s.phys.trappedVolumeMl };
  s.simTimeSec = 0;
  x.breathStart -= shift; x.inspEnd -= shift; x.lastVentBreathStart -= shift; x.lastMandatoryStart -= shift;
  x.simvWindowStart -= shift; x.nextEffort -= shift; if (x.effortStart >= 0) x.effortStart -= shift;
  x.firstBreathStart = x.firstBreathStart - shift; // NaN stays NaN
  x.holdStart -= shift;
  aprvShift(x, shift);
  for (const b of x.breathLog) { b.tEnd -= shift; b.tStart -= shift; }
  x.lastSlow = 0;
  // one slow update so monitored values are populated at t = 0
  x.lastSlow = -1;
  microStep(s, null);
  updateEffortMonitoring(s);
}

function runFor(s: EngineState, seconds: number, collect: boolean): { samples: WaveformSample[]; breaths: StepResult['breaths']; manoeuvre?: StepResult['manoeuvre'] } {
  const samples: WaveformSample[] = [];
  const breaths: StepResult['breaths'] = [];
  const x = I(s);
  const n = Math.max(1, Math.round(seconds / DT));
  let manoeuvre: StepResult['manoeuvre'];
  for (let i = 0; i < n; i++) {
    const before = s.lastBreath;
    microStep(s, collect ? samples : null);
    if (s.lastBreath && s.lastBreath !== before) breaths.push(s.lastBreath);
    if (x.result) {
      manoeuvre = processManoeuvre(s, x.result);
      s.lastManoeuvre = manoeuvre;
      x.result = null;
    }
  }
  if (collect && samples.length > 0) {
    const { C_cw } = partitionCompliance(s.patient);
    for (const smp of samples) {
      annotateWaveformSample(smp, C_cw);
    }
  }
  updateEffortMonitoring(s);
  return { samples, breaths, manoeuvre };
}

export const engine: EngineApi = {
  createState(patient, device, phys, _seed) {
    validateDevice(device); validatePatient(patient);
    const s = newState(clone(patient), clone(device), defaultPhys(patient, device, phys));
    warmUp(s, WARMUP_SEC);
    return s;
  },
  step(state, dtSec) {
    const s = clone(state);
    const r = runFor(s, dtSec, true);
    return { state: s, ...r };
  },
  fastForward(state, simSeconds) {
    const s = clone(state);
    runFor(s, simSeconds, false);
    return s;
  },
  setDevice(state, device) {
    validateDevice(device);
    const s = clone(state);
    const kindChanged = driveFor(s.device).kind !== driveFor(device).kind || s.device.device !== device.device;
    s.device = clone(device);
    const x = I(s);
    if (kindChanged) {
      // Start the new device from expiration; volume (and any trapped gas) carries over.
      if (x.phase !== 'exp') { x.phase = 'exp'; x.inspEnd = s.simTimeSec; }
      x.lastVentBreathStart = s.simTimeSec - 0.5;
      x.simvWindowStart = s.simTimeSec; x.simvMandatoryDone = false;
      x.pending = null; x.holdKind = null;
      x.aprv = undefined; // APRV restarts its Phigh period on the next step
    }
    return s;
  },
  setPatient(state, patch) {
    validatePatient(patch);
    const s = clone(state);
    s.patient = { ...s.patient, ...patch };
    if (patch.baselineHco3MmolL !== undefined) I(s).metabolicHco3 = patch.baselineHco3MmolL;
    return s;
  },
  startManoeuvre(state, m: Manoeuvre) {
    const s = clone(state);
    I(s).pending = clone(m);
    return s;
  },
  drawAbg(state) { return abg(state); },
  simulateBreaths(patient, device, nBreaths, phys) {
    let s = engine.createState(patient, device, phys);
    const samples: WaveformSample[] = [];
    const breaths: StepResult['breaths'] = [];
    // Align the capture to a breath boundary, then collect nBreaths complete breaths (max 60 s).
    let guard = 0;
    while (breaths.length === 0 && guard++ < 300) { const r = runFor(s, 0.1, false); if (r.breaths.length) break; }
    guard = 0;
    while (breaths.length < nBreaths && guard++ < 600) {
      const r = runFor(s, 0.1, true);
      samples.push(...r.samples); breaths.push(...r.breaths);
    }
    return { state: s, samples, breaths };
  },
};
