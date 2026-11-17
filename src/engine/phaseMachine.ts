/**
 * Ventilator phase machine, triggering, cycling, breath bookkeeping, and dyssynchrony handling.
 * Owned by Sub-agent 4 (Dyssynchrony & phase machine).
 */
import type {
  BreathSummary,
  DeviceSettings,
  EngineState,
  ManoeuvreResult,
} from '../shared/engineTypes';
import { driveFor, nivFitFactor, nivLeakLpm, setPeepLevel, type Drive } from './devices';
import { effectiveCompliance } from './lung2';
import {
  checkAutoTrigger,
  checkDelayedCycling,
  checkDoubleTrigger,
  checkFlowStarvation,
  checkPrematureCycling,
  checkReverseTrigger,
  reverseTriggerPmus,
} from './dyssynchrony';
import {
  BACKUP_EXIT_BREATHS,
  BACKUP_RATE_BPM,
  BreathKind,
  Control,
  I,
  PMUS_RELAX_TAU,
  REFRACTORY_SEC,
} from './types';

// Helper rounding
function round1(v: number) { return Math.round(v * 10) / 10; }

/** Pressure assistance above baseline for patient-triggered breaths. */
export function pressureAssist(d: DeviceSettings): number {
  if (d.device === 'invasive') {
    if (d.mode === 'PC-AC') return d.pinspAbovePeep ?? 15;
    if (d.mode === 'PSV' || d.mode === 'CPAP' || d.mode === 'SIMV-VC') return d.psAbovePeep ?? 0;
    return 0;
  }
  if (d.device === 'niv' && d.mode === 'ST') {
    return Math.max(0, (d.ipap ?? d.epap) - d.epap) * nivFitFactor(d.maskFit);
  }
  return 0;
}

/**
 * Unloading factor (0.5..1.0): patients reduce effort when assisted.
 * - Pressure modes (PS, PC, NIV): up to 50% unloading at 20 cmH2O assistance.
 * - VC-AC: unloading scales with how well set peak flow meets inspiratory demand,
 *   falling to 0 (factor 1.0) when set flow is below demand (flow starvation).
 *   Source: Marini JJ, Rodriguez RM, Lamb VJ. Am Rev Respir Dis 1986; 134(5):902-909.
 */
export function effortUnloading(s: EngineState): number {
  const d = s.device;
  if (d.device === 'invasive' && d.mode === 'VC-AC') {
    const setFlow = d.inspFlowLpm ?? 60;
    const p = s.patient, x = I(s);
    const demandLpm = Math.max(
      30,
      ((p.pmusAmplitudeCmH2O * Math.min(1.4, Math.max(0.6, x.drive)) * p.complianceMlPerCmH2O * 0.001) /
        p.pmusInspTimeSec) *
        60
    );
    const starvationThreshold = demandLpm * 0.75;
    if (setFlow < starvationThreshold) {
      const starvationSeverity = Math.min(1, (starvationThreshold - setFlow) / starvationThreshold);
      return 1.0 + 0.3 * starvationSeverity;
    }
    const fraction = Math.min(1, (setFlow - starvationThreshold) / (demandLpm - starvationThreshold));
    return 1 - 0.5 * fraction;
  }
  const pa = pressureAssist(d);
  return 1 - 0.5 * Math.min(1, pa / 20);
}

export function effortParams(s: EngineState): { rate: number; amp: number; tiN: number } {
  const p = s.patient, x = I(s);
  const fatigueFactor = 1 - 0.6 * s.phys.fatigue;
  // Below eupnoea the breathing rate falls steeply (apnoeic threshold lies a few mmHg under resting PaCO2, Nunn ch 4).
  const rate = p.spontRateBpm * (x.drive >= 1 ? x.drive : Math.pow(x.drive, 4));
  const unloading = effortUnloading(s);
  const amp = p.pmusAmplitudeCmH2O * Math.min(1.4, Math.max(0.6, x.drive)) * fatigueFactor * unloading;
  return { rate, amp, tiN: p.pmusInspTimeSec };
}

export function pmusAt(s: EngineState, t: number): number {
  const x = I(s);

  // Continuously track minimum airway pressure during inspiration for flow starvation detection
  if (x.phase === 'insp' && typeof x.lastPaw === 'number') {
    if (typeof x.minInspPaw !== 'number' || x.lastPaw < x.minInspPaw) {
      x.minInspPaw = x.lastPaw;
    }
  }

  const revPmus = reverseTriggerPmus(s, t);
  const { rate, amp, tiN } = effortParams(s);
  if (rate <= 0.5 || amp <= 0.05) {
    x.effortStart = -1;
    return revPmus;
  }
  if (t >= x.nextEffort) {
    finishEffort(s);
    x.effortStart = x.nextEffort;
    x.nextEffort = x.effortStart + 60 / rate;
    x.effortTriggered = false;
    x.effortStartedInExp = x.phase === 'exp';
    x.effortCounted = false;
  }
  if (x.effortStart < 0) return revPmus;
  const te = t - x.effortStart;
  let spontPmus = 0;
  if (te < tiN) {
    spontPmus = (amp * (1 - Math.cos((Math.PI * te) / tiN))) / 2;
  } else {
    if (!x.effortCounted) finishEffort(s);
    spontPmus = amp * Math.exp(-(te - tiN) / PMUS_RELAX_TAU);
  }
  return Math.max(spontPmus, revPmus);
}

/** An effort that started in expiration on a ventilator and never triggered is ineffective. */
export function finishEffort(s: EngineState) {
  const x = I(s);
  if (x.effortCounted || x.effortStart < 0) return;
  x.effortCounted = true;
  const drive = driveFor(s.device);
  if (drive.kind === 'vent' && x.effortStartedInExp && !x.effortTriggered) {
    x.accIneffective += 1;
  }
}

export function closeBreath(s: EngineState, t: number, updateMonitoredFromBreaths: (st: EngineState) => void) {
  const x = I(s);
  if (x.kind === 'none' || x.accN === 0) return;
  const C = effectiveCompliance(s.patient, x.V, setPeepLevel(s.device) ?? 0);
  const summary: BreathSummary = {
    endTimeSec: t,
    breathType: x.kind,
    vtiMl: x.accVti,
    vteMl: x.accVte,
    ppeakCmH2O: x.accPpeak,
    pmeanCmH2O: x.accPawSum / x.accN,
    tiSec: x.accTiSec,
    teSec: Math.max(0, t - x.breathStart - x.accTiSec),
    endExpFlowLps: x.lastFlow,
    leakLpm: s.device.device === 'niv' ? nivLeakLpm(s.device.maskFit, x.accPawSum / x.accN) : 0,
    triggerDelayMs: x.accTriggerDelayMs,
    ineffectiveEfforts: x.accIneffective,
    ...(x.accPmaxHit ? { pmaxLimited: true } : {}),
    ...(x.accDoubleTriggered ? { doubleTriggered: true } : {}),
    ...(x.accPrematureCycled ? { prematureCycled: true } : {}),
    ...(x.accDelayedCycled ? { delayedCycled: true } : {}),
    ...(x.accFlowStarved ? { flowStarved: true } : {}),
    ...(x.accAutoTriggered ? { autoTriggered: true } : {}),
    ...(x.accReverseTriggered ? { reverseTriggered: true } : {}),
  };
  s.lastBreath = summary;
  x.breathLog.push({
    tEnd: t,
    tStart: x.breathStart,
    vtMl: x.accVti,
    kind: x.kind,
    pifLps: x.peakInspFlow,
    palvMean: x.accPalvSum / x.accN,
    pmean: summary.pmeanCmH2O,
    ppeak: x.accPpeak,
    vteMl: x.accVte,
    palvEndInsp: x.accPalvEndInsp,
    palvEndExp: x.V / C,
  });
  while (x.breathLog.length && x.breathLog[0].tEnd < t - 120) x.breathLog.shift();
  updateMonitoredFromBreaths(s);
}

export function openBreath(
  s: EngineState,
  t: number,
  kind: Exclude<BreathKind, 'none'>,
  control: Control,
  updateMonitoredFromBreaths: (st: EngineState) => void
) {
  const x = I(s);
  closeBreath(s, t, updateMonitoredFromBreaths);
  if (x.pendingDoubleTrigger && s.lastBreath) {
    s.lastBreath.doubleTriggered = true;
  }
  if (Number.isNaN(x.firstBreathStart)) x.firstBreathStart = t;
  x.breathStart = t;
  x.kind = kind;
  x.control = control;
  x.phase = 'insp';
  x.inspDeliveredMl = 0;
  x.peakInspFlow = 0;
  x.accVti = 0;
  x.accVte = 0;
  x.accPpeak = 0;
  x.accPawSum = 0;
  x.accPalvSum = 0;
  x.accN = 0;
  x.accVnet = 0;
  x.accIneffective = 0;
  x.accTiSec = 0;
  x.accPalvEndInsp = 0;
  x.accTriggerDelayMs = undefined;
  x.accPmaxHit = false;
  x.minInspPaw = undefined;

  // Dyssynchrony breath state
  x.accDoubleTriggered = Boolean(x.pendingDoubleTrigger);
  x.pendingDoubleTrigger = false;
  x.accAutoTriggered = Boolean(x.pendingAutoTrigger);
  x.pendingAutoTrigger = false;
  x.accPrematureCycled = false;
  x.accDelayedCycled = false;
  x.accFlowStarved = false;

  // Neuromechanical coupling (reverse triggering) check
  x.accReverseTriggered = checkReverseTrigger(s, t, kind);

  if (control !== 'free') x.lastVentBreathStart = t;
  if (kind === 'mandatory' || (kind === 'assisted' && control !== 'ps')) x.lastMandatoryStart = t;
}

export function startHold(
  s: EngineState,
  t: number,
  kind: 'insp-hold' | 'exp-hold' | 'occlusion',
  maxSec: number,
  resumeMandatory: boolean
) {
  const x = I(s);
  x.pending = null;
  x.phase = 'hold';
  x.holdKind = kind;
  x.holdStart = t;
  x.holdMax = Math.min(5, Math.max(0.5, maxSec));
  x.holdMaxPmus = 0;
  x.holdPawSum = 0;
  x.holdN = 0;
  x.holdResumeMandatory = resumeMandatory;
  x.occlusionMinPaw = undefined;
  x.occlusionP01 = undefined;
}

export function endHold(
  s: EngineState,
  t: number,
  startVentBreathFn: (st: EngineState, tm: number, k: 'mandatory' | 'assisted') => void
) {
  const x = I(s);
  const avgPaw = x.holdN ? x.holdPawSum / x.holdN : x.lastPaw;
  const peep = setPeepLevel(s.device) ?? 0;

  if (x.holdKind === 'insp-hold') {
    const valid = x.holdMaxPmus < 1.5;
    x.result = { kind: 'insp-hold', pplatCmH2O: round1(avgPaw), valid };
    x.holdKind = null;
    x.phase = 'exp';
    x.inspEnd = t;
  } else if (x.holdKind === 'exp-hold') {
    const valid = x.holdMaxPmus < 1.5;
    x.result = {
      kind: 'exp-hold',
      totalPeepCmH2O: round1(avgPaw),
      autoPeepCmH2O: round1(Math.max(0, avgPaw - peep)),
      valid,
    };
    x.holdKind = null;
    x.phase = 'exp';
    if (x.holdResumeMandatory) startVentBreathFn(s, t, 'mandatory');
  } else if (x.holdKind === 'occlusion') {
    // End-expiratory occlusion manoeuvre (Bertoni 2019)
    const deltaPocc = x.occlusionMinPaw !== undefined ? Math.max(0, peep - x.occlusionMinPaw) : 0;
    const p01 = x.occlusionP01 ?? 0;
    const valid = deltaPocc > 1.0;
    const pmusEst = round1(0.75 * deltaPocc);
    x.result = {
      kind: 'occlusion',
      p01CmH2O: round1(p01),
      deltaPoccCmH2O: round1(deltaPocc),
      pmusEstimatedCmH2O: pmusEst,
      deltaPlDynEstimatedCmH2O: pmusEst,
      valid,
    };
    x.holdKind = null;
    x.phase = 'exp';
    if (x.holdResumeMandatory) startVentBreathFn(s, t, 'mandatory');
  }
}

export function endInspiration(s: EngineState, t: number) {
  const x = I(s);
  const tIn = t - x.breathStart;
  x.accTiSec = tIn;
  const C = effectiveCompliance(s.patient, x.V, setPeepLevel(s.device) ?? 0);
  x.accPalvEndInsp = x.V / C;

  // Evaluate cycling dyssynchronies and flow starvation
  const currentPmus = pmusAt(s, t);
  if (checkPrematureCycling(s, tIn, currentPmus)) {
    x.accPrematureCycled = true;
    x.prematureCycleCount = (x.prematureCycleCount ?? 0) + 1;
  }
  if (checkDelayedCycling(s, tIn)) {
    x.accDelayedCycled = true;
    x.delayedCycleCount = (x.delayedCycleCount ?? 0) + 1;
  }
  if (checkFlowStarvation(s)) {
    x.accFlowStarved = true;
    x.flowStarvationCount = (x.flowStarvationCount ?? 0) + 1;
  }

  if (x.pending?.kind === 'insp-hold' && (x.control === 'vc' || x.control === 'pc')) {
    startHold(s, t, 'insp-hold', x.pending.maxSec, false);
    return;
  }
  x.phase = 'exp';
  x.inspEnd = t;
}

export function startVentBreath(
  s: EngineState,
  t: number,
  kind: 'mandatory' | 'assisted',
  updateMonitoredFromBreaths: (st: EngineState) => void
) {
  const d = s.device;
  const x = I(s);
  let control: Control = 'pc';
  if (x.apnoeaBackup) {
    if (kind === 'mandatory') x.backupSpont = 0;
    else if ((x.backupSpont = (x.backupSpont ?? 0) + 1) >= BACKUP_EXIT_BREATHS) x.apnoeaBackup = false;
  }
  if (d.device === 'invasive') {
    if (d.mode === 'VC-AC') control = 'vc';
    else if (d.mode === 'PC-AC') control = 'pc';
    else if (d.mode === 'PSV' || d.mode === 'CPAP') control = 'ps';
    else if (d.mode === 'SIMV-VC') {
      if (!x.simvMandatoryDone) {
        control = 'vc';
        x.simvMandatoryDone = true;
      } else {
        control = 'ps';
      }
    }
  } else if (d.device === 'niv') {
    control = kind === 'assisted' ? 'ps' : 'pc';
  }
  if (x.apnoeaBackup && kind === 'mandatory') control = 'pc';
  if (x.effortStart >= 0 && kind === 'assisted') {
    x.effortTriggered = true;
    x.accTriggerDelayMs = (t - x.effortStart) * 1000;
  }
  openBreath(s, t, kind, control, updateMonitoredFromBreaths);
}

export function maybeTrigger(
  s: EngineState,
  t: number,
  drive: Extract<Drive, { kind: 'vent' }>,
  flowIfExp: number,
  startVentBreathFn: (st: EngineState, tm: number, k: 'mandatory' | 'assisted') => void
) {
  const x = I(s), d = s.device;
  if (x.phase !== 'exp') return;
  const sinceStart = t - x.lastVentBreathStart;
  const rr = x.apnoeaBackup ? BACKUP_RATE_BPM : d.device === 'invasive' ? d.rrSetBpm : d.device === 'niv' ? (d.backupRrBpm ?? 0) : 0;
  const period = rr > 0 ? 60 / rr : Infinity;
  const trigLps = (d.device === 'invasive' ? (d.triggerFlowLpm ?? 2) : 2) / 60;
  const canPatientTrigger = t - x.inspEnd >= REFRACTORY_SEC;

  // SIMV window bookkeeping
  if (drive.mode === 'SIMV-VC' && t - x.simvWindowStart >= period) {
    x.simvWindowStart = t;
    if (!x.simvMandatoryDone) {
      if (x.pending?.kind === 'exp-hold' || x.pending?.kind === 'occlusion') {
        startHold(s, t, x.pending.kind, x.pending.maxSec, true);
        return;
      }
      startVentBreathFn(s, t, 'mandatory');
      return;
    }
    x.simvMandatoryDone = false;
  }

  // Auto-triggering from unintentional circuit leak exceeding flow trigger threshold
  if (canPatientTrigger && checkAutoTrigger(s, canPatientTrigger)) {
    if (x.pending?.kind !== 'exp-hold' && x.pending?.kind !== 'occlusion') {
      x.autoTriggerCount = (x.autoTriggerCount ?? 0) + 1;
      x.pendingAutoTrigger = true;
      startVentBreathFn(s, t, 'assisted');
      return;
    }
  }

  // Double triggering from persistent neural effort outlasting ventilator inspiratory time
  const currentPmus = pmusAt(s, t);
  if (canPatientTrigger && checkDoubleTrigger(s, t, canPatientTrigger, currentPmus)) {
    if (x.pending?.kind !== 'exp-hold' && x.pending?.kind !== 'occlusion') {
      x.lastDoubleTriggerEffort = x.effortStart;
      x.doubleTriggerCount = (x.doubleTriggerCount ?? 0) + 1;
      x.pendingDoubleTrigger = true;
      startVentBreathFn(s, t, 'assisted');
      return;
    }
  }

  // Patient trigger. Pressure the effort must overcome = (auto-PEEP - applied PEEP, floored at 0) + trigger
  // sensitivity (as a pressure, flow trigger x inspiratory resistance). Applied PEEP therefore offsets auto-PEEP
  // even when expiratory flow limitation (waterfall) keeps expiratory flow from reversing (Ventilator Book ch 4).
  const cTrig = effectiveCompliance(s.patient, x.V, drive.peep);
  const threshold = Math.max(0, x.V / cTrig - drive.peep) + trigLps * s.patient.inspResistanceCmH2OPerLps;
  const effortTrigger = x.effortStart >= 0 && currentPmus >= threshold;
  if (canPatientTrigger && (flowIfExp > trigLps || effortTrigger) && x.effortStart >= 0 && x.pending?.kind !== 'exp-hold' && x.pending?.kind !== 'occlusion') {
    startVentBreathFn(s, t, 'assisted');
    return;
  }

  // Machine time trigger
  const timeTriggers = drive.mode === 'VC-AC' || drive.mode === 'PC-AC' || drive.mode === 'NIV-ST' || Boolean(x.apnoeaBackup);
  if (timeTriggers && sinceStart >= period) {
    if (x.pending?.kind === 'exp-hold' || x.pending?.kind === 'occlusion') {
      startHold(s, t, x.pending.kind, x.pending.maxSec, true);
      return;
    }
    startVentBreathFn(s, t, 'mandatory');
    return;
  }

  // Diagnostic manoeuvre in non-time-triggered modes
  if ((x.pending?.kind === 'exp-hold' || x.pending?.kind === 'occlusion') && !timeTriggers && t - x.inspEnd > 1.0) {
    startHold(s, t, x.pending.kind, x.pending.maxSec, false);
  }
}
