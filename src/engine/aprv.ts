/**
 * Airway pressure release ventilation (APRV).
 *
 * The ventilator is a time-cycled pressure target: Phigh for Thigh, then Plow for Tlow, repeating. Nothing is
 * synchronised to the patient and there is no assist. Volumes are never prescribed. They come from the same
 * single-step lung solution every other mode uses (flowStep: equation of motion with R and C), so a release that
 * is too short for the expiratory time constant leaves gas behind (intrinsic PEEP) without any rule saying so.
 * Patient effort (Pmus) acts at both levels. Spontaneous breaths are measured as the extra lung volume the effort
 * adds compared with a shadow lung driven by the same airway pressure with no effort.
 *
 * Mode description follows The Ventilator Book, 3rd ed. (Owens), APRV chapter, and the Hamilton C1 operator's
 * manual (APRV settings P high, P low, T high, T low). Wording here is original.
 */
import type { AprvReadouts, EngineState } from '../shared/engineTypes';
import { effectiveCompliance } from './lung2';
import { flowStep, pmaxLimit } from './mechanics';
import { startHold } from './phaseMachine';
import { DT, I, type BreathLogEntry, type Internal } from './types';

const SPONT_OPEN_ML = 10;       // extra volume above the no-effort shadow lung that counts as a spontaneous breath
const DEFAULT_RISE_SEC = 0.1;

export interface AprvState {
  level: 'high' | 'low';
  levelStart: number;
  cycleSumPaw: number;
  cycleSumPalv: number;
  cycleN: number;
  cyclePeakPaw: number;
  cyclePeakInsp: number;          // L/s
  palvEndHigh: number;
  releaseVolMl: number;           // gas exhaled so far in the current release
  peakExp: number;                // L/s, positive
  lastFlow: number;
  vPass: number;                  // shadow lung volume (no patient effort)
  prevDv: number;
  valley: number;
  spOpen: boolean;
  spStartDv: number;
  spPeak: number;
  spStart: number;
  spLevel: 'high' | 'low';
  spPawSum: number;
  spPalvSum: number;
  spN: number;
  spPeakPaw: number;
  spPif: number;
  meanPaw: number | null;
  lastReleaseVolMl: number | null;
  lastEndFlowPct: number | null;
}

export interface AprvDrive { kind: 'aprv'; phigh: number; plow: number; thigh: number; tlow: number }

export function aprvSettings(d: { phighCmH2O?: number; plowCmH2O?: number; thighSec?: number; tlowSec?: number }) {
  return { phigh: d.phighCmH2O ?? 25, plow: d.plowCmH2O ?? 5, thigh: d.thighSec ?? 5, tlow: d.tlowSec ?? 0.6 };
}

/** Breaths that define the ventilator cycle. In APRV the small spontaneous breaths are excluded; other modes use every breath. */
export function mainBreaths(s: EngineState): BreathLogEntry[] {
  const x = I(s);
  return s.device.device === 'invasive' && s.device.mode === 'APRV' ? x.breathLog.filter(b => b.kind !== 'spontaneous') : x.breathLog;
}

function fresh(x: Internal, t: number): AprvState {
  return {
    level: 'high', levelStart: t, cycleSumPaw: 0, cycleSumPalv: 0, cycleN: 0, cyclePeakPaw: 0, cyclePeakInsp: 0,
    palvEndHigh: 0, releaseVolMl: 0, peakExp: 0, lastFlow: 0, vPass: x.V, prevDv: 0, valley: 0, spOpen: false,
    spStartDv: 0, spPeak: 0, spStart: t, spLevel: 'high', spPawSum: 0, spPalvSum: 0, spN: 0, spPeakPaw: 0, spPif: 0,
    meanPaw: null, lastReleaseVolMl: null, lastEndFlowPct: null,
  };
}

/** Start (or restart) the Phigh period at time t. */
export function aprvBeginHigh(s: EngineState, t: number) {
  const x = I(s);
  const prev = x.aprv as AprvState | undefined;
  const a = fresh(x, t);
  if (prev) { a.meanPaw = prev.meanPaw; a.lastReleaseVolMl = prev.lastReleaseVolMl; a.lastEndFlowPct = prev.lastEndFlowPct; }
  x.aprv = a;
  x.phase = 'insp';
  x.kind = 'mandatory';
  x.control = 'pc';
  x.accVnet = 0;
}

export function aprvInit(s: EngineState, t: number) {
  const x = I(s);
  x.aprv = undefined;
  aprvBeginHigh(s, t);
  x.lastVentBreathStart = t;
}

/** Shift stored timestamps (used when the engine restarts its clock after warm-up). */
export function aprvShift(x: Internal, shift: number) {
  const a = x.aprv as AprvState | undefined;
  if (a) { a.levelStart -= shift; a.spStart -= shift; }
}

function logSpont(s: EngineState, a: AprvState, t: number, C: number) {
  const x = I(s);
  const vt = a.spPeak - a.spStartDv;
  a.spOpen = false;
  a.valley = a.prevDv;
  if (vt < SPONT_OPEN_ML) return;
  const n = Math.max(1, a.spN);
  x.breathLog.push({
    tEnd: t, tStart: a.spStart, vtMl: vt, kind: 'spontaneous', pifLps: a.spPif, palvMean: a.spPalvSum / n,
    pmean: a.spPawSum / n, ppeak: a.spPeakPaw, vteMl: vt, palvEndInsp: a.spPeakPaw, palvEndExp: x.V / C, level: a.spLevel,
  });
}

function logRelease(s: EngineState, a: AprvState, t: number, C: number, drive: AprvDrive) {
  const x = I(s);
  const n = Math.max(1, a.cycleN);
  const pmean = a.cycleSumPaw / n;
  const endPct = a.peakExp > 1e-6 ? (100 * Math.max(0, -a.lastFlow)) / a.peakExp : null;
  a.meanPaw = pmean;
  a.lastReleaseVolMl = a.releaseVolMl;
  a.lastEndFlowPct = endPct;
  s.lastBreath = {
    endTimeSec: t, breathType: 'mandatory', vtiMl: a.releaseVolMl, vteMl: a.releaseVolMl, ppeakCmH2O: a.cyclePeakPaw,
    pmeanCmH2O: pmean, tiSec: drive.thigh, teSec: drive.tlow, endExpFlowLps: a.lastFlow, leakLpm: 0, ineffectiveEfforts: 0,
  };
  x.breathLog.push({
    tEnd: t, tStart: a.levelStart, vtMl: a.releaseVolMl, kind: 'mandatory', pifLps: a.cyclePeakInsp,
    palvMean: a.cycleSumPalv / n, pmean, ppeak: a.cyclePeakPaw, vteMl: a.releaseVolMl, palvEndInsp: a.palvEndHigh,
    palvEndExp: x.V / C, level: 'low',
  });
  while (x.breathLog.length && x.breathLog[0]!.tEnd < t - 120) x.breathLog.shift();
}

/** One integration step. Returns airway pressure and patient flow; sets x.V. */
export function aprvStep(
  s: EngineState, t: number, drive: AprvDrive, pmus: number, onRelease: (st: EngineState) => void,
): { paw: number; flow: number } {
  const x = I(s), p = s.patient;
  if (!x.aprv) aprvInit(s, s.simTimeSec);
  let a = x.aprv as AprvState;
  const V0 = x.V;
  let C = effectiveCompliance(p, V0, drive.plow);

  // Time-cycled schedule
  const elapsed = t - a.levelStart;
  if (a.level === 'high' && elapsed >= drive.thigh) {
    a.palvEndHigh = V0 / C;
    a.level = 'low';
    a.levelStart = t;
    a.releaseVolMl = 0;
    a.peakExp = 0;
    x.phase = 'exp';
    x.inspEnd = t;
  } else if (a.level === 'low' && elapsed >= drive.tlow) {
    if (a.spOpen) logSpont(s, a, t, C);
    logRelease(s, a, t, C, drive);
    onRelease(s);
    const m = x.pending;
    if (m && (m.kind === 'exp-hold' || m.kind === 'occlusion')) {
      // Hold at the end of the release (existing expiratory-hold logic); Phigh restarts when it ends.
      startHold(s, t, m.kind, m.maxSec, true);
      return { paw: V0 / C - pmus, flow: 0 };
    }
    aprvBeginHigh(s, t);
    a = x.aprv as AprvState;
  }

  const lvlElapsed = t - a.levelStart;
  let paw: number;
  if (a.level === 'high') {
    const rise = s.device.device === 'invasive' ? s.device.riseTimeSec ?? DEFAULT_RISE_SEC : DEFAULT_RISE_SEC;
    const frac = rise > 0 ? Math.min(1, lvlElapsed / rise) : 1;
    paw = Math.min(pmaxLimit(s.device), drive.plow + (drive.phigh - drive.plow) * frac);
  } else {
    paw = drive.plow;
  }

  x.V = flowStep(p, V0, paw, pmus, C, DT);
  const flow = (x.V - V0) / 1000 / DT;
  C = effectiveCompliance(p, x.V, drive.plow);
  a.vPass = flowStep(p, a.vPass, paw, 0, effectiveCompliance(p, a.vPass, drive.plow), DT);

  // Cycle accumulators (time-weighted: every step has the same duration)
  a.cycleSumPaw += paw;
  a.cycleSumPalv += x.V / C - pmus;
  a.cycleN++;
  a.cyclePeakPaw = Math.max(a.cyclePeakPaw, paw);
  if (flow > 0) a.cyclePeakInsp = Math.max(a.cyclePeakInsp, flow);
  if (a.level === 'low') {
    if (flow < 0) a.releaseVolMl += -flow * 1000 * DT;
    a.peakExp = Math.max(a.peakExp, -flow);
  }
  a.lastFlow = flow;

  // Spontaneous breath = extra volume the patient adds on top of the no-effort lung
  const dv = x.V - a.vPass;
  if (!a.spOpen) {
    a.valley = Math.min(a.valley, dv);
    if (dv - a.valley > SPONT_OPEN_ML) {
      a.spOpen = true; a.spStartDv = a.valley; a.spPeak = dv; a.spStart = t; a.spLevel = a.level;
      a.spPawSum = 0; a.spPalvSum = 0; a.spN = 0; a.spPeakPaw = 0; a.spPif = 0;
    }
  } else {
    a.spPeak = Math.max(a.spPeak, dv);
    a.spPawSum += paw; a.spPalvSum += x.V / C - pmus; a.spN++;
    a.spPeakPaw = Math.max(a.spPeakPaw, paw);
    a.spPif = Math.max(a.spPif, (dv - a.prevDv) / 1000 / DT);
    if (dv < a.spPeak - Math.max(SPONT_OPEN_ML, 0.5 * (a.spPeak - a.spStartDv))) logSpont(s, a, t, C);
  }
  a.prevDv = dv;
  x.kind = a.spOpen ? 'spontaneous' : 'mandatory';
  return { paw, flow };
}

/** Neutral APRV measurements for the monitor; undefined outside APRV. */
export function aprvReadouts(s: EngineState): AprvReadouts | undefined {
  if (s.device.device !== 'invasive' || s.device.mode !== 'APRV') return undefined;
  const x = I(s), a = x.aprv as AprvState | undefined;
  const t = s.simTimeSec;
  const last60 = x.breathLog.filter(b => b.tEnd > t - 60);
  const span = Math.min(60, Math.max(10, t - (last60[0]?.tStart ?? t)));
  const rel = last60.filter(b => b.kind === 'mandatory').length;
  const sp = last60.filter(b => b.kind === 'spontaneous').length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const lm = s.lastManoeuvre;
  const hold = lm && lm.kind === 'exp-hold' && lm.valid ? lm.autoPeepCmH2O ?? null : null;
  return {
    releaseVolumeMl: a?.lastReleaseVolMl == null ? null : Math.round(a.lastReleaseVolMl),
    releaseRatePerMin: r1((rel * 60) / span),
    spontRatePerMin: r1((sp * 60) / span),
    meanAirwayPressureCmH2O: a?.meanPaw == null ? null : r1(a.meanPaw),
    endReleaseFlowPctOfPeak: a?.lastEndFlowPct == null ? null : Math.round(a.lastEndFlowPct),
    autoPeepCmH2O: hold,
  };
}
