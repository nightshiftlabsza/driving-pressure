/**
 * Engine core: single-compartment respiratory mechanics with patient effort,
 * a ventilator phase machine, and slow physiology (gas exchange, acid-base,
 * fatigue, circulation) updated once per simulated second.
 *
 * Equation of motion: Paw - (V/C - Pmus) = R * flow.
 * V is absolute lung volume above the relaxed volume at 0 cmH2O, so V/C is alveolar
 * elastic recoil pressure; at the end of a complete exhalation V = C * PEEP.
 * Volume carries over between breaths, so incomplete exhalation (auto-PEEP),
 * ineffective triggering and breath stacking emerge from the mechanics, not from rules.
 *
 * All functions mutate the EngineState they are given; index.ts clones before calling.
 */
import type {
  AbgResult,
  DeviceSettings,
  EngineState,
  MonitoredValues,
  PatientParams,
  PhysState,
  WaveformSample,
} from '../shared/engineTypes';
import { ENGINE_API_VERSION } from '../shared/engineTypes';
import {
  acuteBuffer,
  alveolarPo2,
  arterialPo2,
  baseExcess,
  initialMetabolicHco3,
  PATM_MMHG,
  PH2O_MMHG,
  phFrom,
  satFromPo2,
  steadyPaco2,
} from './gas';
import {
  driveFor,
  effectiveFio2,
  hfncPeep,
  hfncWashoutMl,
  nivLeakLpm,
  pbwKg,
  ppvEffect,
  recruitingPressure,
  setPeepLevel,
} from './devices';
import {
  APNOEA_TIME_SEC,
  APNOEIC_HFNC_UNREPLACED,
  BACKUP_VT_ML_PER_KG_PBW,
  DEFAULT_PMAX_CMH2O,
  DT,
  I,
  Internal,
  SAMPLE_EVERY,
  SLOW_STEP,
  Truth,
  VA_WINDOW,
} from './types';
import { flowStep, inspPressureAbovePeep, pmaxLimit, relax, vcFlowLps } from './mechanics';
import { effectiveCompliance } from './lung2';
import { aprvBeginHigh, aprvReadouts, aprvStep, mainBreaths } from './aprv';
import {
  closeBreath,
  effortParams,
  effortUnloading,
  endHold,
  endInspiration,
  maybeTrigger,
  openBreath,
  pmusAt,
  startHold,
  startVentBreath,
} from './phaseMachine';

export { DT, SAMPLE_EVERY, DEFAULT_PMAX_CMH2O, I, type Internal, type Truth };
export { effortUnloading };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createInternal(patient: PatientParams, device: DeviceSettings, phys: PhysState): Internal {
  const drive = driveFor(device);
  const level = drive.kind === 'vent' ? drive.peep : drive.kind === 'aprv' ? drive.plow : drive.paw;
  const C = effectiveCompliance(patient, undefined, level);
  return {
    V: C * level,
    phase: 'exp',
    control: drive.kind === 'free' ? 'free' : 'pc',
    kind: 'none',
    breathStart: -1,
    inspEnd: -10,
    inspDeliveredMl: 0,
    peakInspFlow: 0,
    lastVentBreathStart: -100,
    lastMandatoryStart: -100,
    simvWindowStart: 0,
    simvMandatoryDone: false,
    effortStart: -1,
    nextEffort: 0.3,
    effortTriggered: false,
    effortStartedInExp: false,
    effortCounted: true,
    accVti: 0,
    accVte: 0,
    accPpeak: 0,
    accPawSum: 0,
    accPalvSum: 0,
    accN: 0,
    accVnet: 0,
    accIneffective: 0,
    accTiSec: 0,
    accPalvEndInsp: 0,
    lastFlow: 0,
    lastPaw: level,
    breathLog: [],
    firstBreathStart: NaN,
    pending: null,
    holdKind: null,
    holdStart: 0,
    holdMax: 0,
    holdMaxPmus: 0,
    holdPawSum: 0,
    holdN: 0,
    holdResumeMandatory: false,
    result: null,
    lastSlow: 0,
    metabolicHco3: initialMetabolicHco3(phys.hco3MmolL, phys.paco2MmHg, patient.chronicPaco2MmHg),
    pao2Target: phys.pao2MmHg,
    sao2: satFromPo2(phys.pao2MmHg),
    spo2Shown: satFromPo2(phys.pao2MmHg) * 100,
    drive: 1,
    hr: patient.hrBaselineBpm,
    sbp: patient.sbpBaselineMmHg,
    dbp: patient.dbpBaselineMmHg,
    co: 5,
    stepCounter: 0,
    trace: null,
    doubleTriggerCount: 0,
    prematureCycleCount: 0,
    delayedCycleCount: 0,
    flowStarvationCount: 0,
    autoTriggerCount: 0,
    reverseTriggerCount: 0,
  };
}

export function emptyMonitored(
  state: { simTimeSec: number; device: DeviceSettings; patient: PatientParams },
  fio2: number
): MonitoredValues {
  const p = state.patient;
  return {
    simTimeSec: state.simTimeSec,
    ppeakCmH2O: null,
    pmeanCmH2O: null,
    peepSetCmH2O: setPeepLevel(state.device),
    hfncPressureCmH2O: state.device.device === 'hfnc' ? round1(hfncPeep(state.device.flowLpm)) : null,
    vteMl: null,
    minuteVentLpm: null,
    rrTotalBpm: 0,
    rrSpontBpm: 0,
    fio2,
    leakLpm: null,
    hrBpm: p.hrBaselineBpm,
    sbpMmHg: p.sbpBaselineMmHg,
    dbpMmHg: p.dbpBaselineMmHg,
    mapMmHg: (p.sbpBaselineMmHg + 2 * p.dbpBaselineMmHg) / 3,
    spo2Pct: 90,
    etco2MmHg: null,
    temperatureC: p.temperatureC,
    pesCmH2O: null,
    plEndInspCmH2O: null,
    plEndExpCmH2O: null,
    p01CmH2O: null,
    deltaPoccCmH2O: null,
  };
}

// ---------------------------------------------------------------------------
// One integration step
// ---------------------------------------------------------------------------

function backupEligible(d: DeviceSettings): boolean {
  if (d.device === 'invasive') return (d.mode === 'PSV' || d.mode === 'CPAP') && d.apnoeaBackup !== false;
  if (d.device === 'niv') return d.mode === 'CPAP' && d.apnoeaBackup !== false;
  return false;
}

/** Drive actually applied: free CPAP becomes a pressure-controlled machine while apnoea backup is active. */
function activeDrive(s: EngineState) {
  const d = driveFor(s.device);
  if (I(s).apnoeaBackup && d.kind === 'free' && (s.device.device === 'invasive' || s.device.device === 'niv')) {
    return { kind: 'vent' as const, mode: s.device.device === 'niv' ? ('NIV-ST' as const) : ('PSV' as const), peep: d.paw };
  }
  return d;
}

/** Apnoea backup: no breath for APNOEA_TIME_SEC in PSV/CPAP starts mandatory pressure breaths (about 8 mL/kg PBW). */
function updateApnoeaBackup(s: EngineState, t: number) {
  const x = I(s);
  if (!backupEligible(s.device)) {
    x.apnoeaBackup = false;
    return;
  }
  if (x.apnoeaBackup) return;
  const lastActivity = x.phase === 'exp' ? Math.max(0, x.breathStart, x.inspEnd) : t;
  if (t - lastActivity < APNOEA_TIME_SEC) return;
  const peep = setPeepLevel(s.device) ?? 0;
  const C = effectiveCompliance(s.patient, x.V, peep);
  x.backupPinsp = Math.min(30, Math.max(8, (BACKUP_VT_ML_PER_KG_PBW * pbwKg(s.patient)) / (0.9 * C)));
  x.apnoeaBackup = true;
  x.backupSpont = 0;
}

export function microStep(s: EngineState, samples: WaveformSample[] | null) {
  const x = I(s),
    p = s.patient;
  const t = s.simTimeSec + DT;
  const drive = activeDrive(s);
  const V0 = x.V;
  const C = effectiveCompliance(p, V0, drive.kind === 'free' ? drive.paw : drive.kind === 'aprv' ? drive.plow : drive.peep);
  const Ri = p.inspResistanceCmH2OPerLps,
    Re = p.expResistanceCmH2OPerLps;
  const pmus = pmusAt(s, t);
  let paw: number;
  let flow: number;

  const startVentFn = (st: EngineState, tm: number, k: 'mandatory' | 'assisted') =>
    drive.kind === 'aprv' ? aprvBeginHigh(st, tm) : startVentBreath(st, tm, k, updateMonitoredFromBreaths);

  if (x.phase === 'hold') {
    flow = 0;
    paw = V0 / C - pmus;
    x.holdMaxPmus = Math.max(x.holdMaxPmus, pmus);

    // Track occlusion deflection and P0.1 during occlusion hold
    if (x.holdKind === 'occlusion') {
      const peep = setPeepLevel(s.device) ?? 0;
      if (x.occlusionMinPaw === undefined || paw < x.occlusionMinPaw) {
        x.occlusionMinPaw = paw;
      }
      const tHold = t - x.holdStart;
      if (tHold >= 0.095 && tHold <= 0.105 && x.occlusionP01 === undefined) {
        x.occlusionP01 = Math.max(0, peep - paw);
      }
    }

    if (t - x.holdStart > Math.max(0.2, x.holdMax - 0.3)) {
      x.holdPawSum += paw;
      x.holdN++;
    }
    if (t - x.holdStart >= x.holdMax) endHold(s, t, startVentFn);
  } else if (drive.kind === 'aprv') {
    ({ paw, flow } = aprvStep(s, t, drive, pmus, updateMonitoredFromBreaths));
  } else if (drive.kind === 'free') {
    paw = drive.paw;
    x.V = flowStep(p, V0, paw, pmus, C, DT);
    flow = (x.V - V0) / 1000 / DT;
    if (x.phase !== 'insp' && flow > 0.05) {
      openBreath(s, t, 'spontaneous', 'free', updateMonitoredFromBreaths);
    } else if (x.phase === 'insp' && flow < -0.02) {
      x.accTiSec = t - x.breathStart;
      x.accPalvEndInsp = V0 / C;
      x.phase = 'exp';
      x.inspEnd = t;
    }
  } else if (x.phase === 'insp') {
    const tIn = t - x.breathStart;
    if (x.control === 'vc') {
      flow = vcFlowLps(s, tIn);
      x.V = V0 + flow * 1000 * DT;
      paw = Ri * flow + x.V / C - pmus;
      x.inspDeliveredMl += flow * 1000 * DT;
      const vt = s.device.device === 'invasive' ? s.device.vtSetMl ?? 450 : 450;
      const pmax = pmaxLimit(s.device);
      if (paw >= pmax) {
        paw = pmax;
        x.accPmaxHit = true;
        endInspiration(s, t);
      } else if (x.inspDeliveredMl >= vt) {
        endInspiration(s, t);
      }
    } else {
      const rise = s.device.device === 'invasive' ? s.device.riseTimeSec ?? 0.1 : 0.15;
      const dp = inspPressureAbovePeep(s);
      paw = Math.min(pmaxLimit(s.device), drive.peep + dp * Math.min(1, rise > 0 ? tIn / rise : 1));
      const R = paw + pmus > V0 / C ? Ri : Re;
      x.V = relax(V0, paw, pmus, R, C, DT);
      flow = (x.V - V0) / 1000 / DT;
      x.peakInspFlow = Math.max(x.peakInspFlow, flow);
      if (x.control === 'pc') {
        const ti =
          s.device.device === 'invasive'
            ? s.device.tiSec ?? 1.0
            : s.device.device === 'niv'
            ? s.device.tiSec ?? 1.0
            : 1.0;
        if (tIn >= ti) endInspiration(s, t);
      } else {
        const cycRaw = s.device.device === 'invasive' ? s.device.cycleOffPct ?? s.device.cyclePctPeakFlow ?? 25 : 25;
        const cyc = cycRaw / 100;
        if ((tIn > 0.15 && flow < cyc * x.peakInspFlow) || tIn >= 3) endInspiration(s, t);
      }
    }
  } else {
    // expiration on a ventilator
    paw = drive.peep;
    x.V = flowStep(p, V0, paw, pmus, C, DT);
    flow = (x.V - V0) / 1000 / DT;
    maybeTrigger(s, t, drive, flow, startVentFn);
  }

  if (x.phase !== 'hold' || flow !== 0) x.peakInspFlow = Math.max(x.peakInspFlow, flow);
  if (flow > 0) x.accVti += flow * 1000 * DT;
  else x.accVte += -flow * 1000 * DT;
  x.accVnet += flow * 1000 * DT;
  x.accPpeak = Math.max(x.accPpeak, paw);
  x.accPawSum += paw;
  x.accPalvSum += x.V / C - pmus;
  x.accN++;
  x.lastFlow = flow;
  x.lastPaw = paw;
  s.simTimeSec = t;
  x.stepCounter++;

  if (samples && x.stepCounter % SAMPLE_EVERY === 0) {
    samples.push({
      tSec: round3(t),
      pawCmH2O: round2(paw),
      flowLps: round3(flow),
      volumeMl: round1(Math.max(-50, x.accVnet)),
      pmusCmH2O: round2(pmus),
      phase: x.phase,
      breathType: x.kind,
    });
  }
  if (t - x.lastSlow >= SLOW_STEP - 1e-9) {
    slowUpdate(s, t - x.lastSlow);
    x.lastSlow = t;
  }
}

// ---------------------------------------------------------------------------
// Slow physiology
// ---------------------------------------------------------------------------

export function alveolarVentilationLpm(s: EngineState): number | null {
  const x = I(s),
    p = s.patient,
    t = s.simTimeSec;
  if (Number.isNaN(x.firstBreathStart)) return t > 15 ? 0 : null;
  const window = Math.min(VA_WINDOW, t - x.firstBreathStart);
  if (window < 3) return null;
  const recent = x.breathLog.filter(b => b.tEnd > t - window);
  const lastEnd = x.breathLog.length ? x.breathLog[x.breathLog.length - 1].tEnd : x.firstBreathStart;
  if (t - lastEnd > 20 && x.phase !== 'insp') return 0;
  const vd = p.anatomicDeadSpaceMl - (s.device.device === 'hfnc' ? hfncWashoutMl(s.device.flowLpm) : 0);
  const alvMl = recent.reduce((a, b) => a + Math.max(0, b.vtMl - vd), 0);
  return (
    ((alvMl / Math.min(window, Math.max(5, t - (recent[0]?.tStart ?? t)))) * 60) /
    1000 *
    (1 - p.alveolarDeadSpaceFraction - (x.o2DeadSpace ?? 0))
  );
}

function pifLpm(s: EngineState): number {
  const recent = I(s).breathLog.slice(-4);
  if (!recent.length) return 30;
  return (60 * recent.reduce((a, b) => a + b.pifLps, 0)) / recent.length;
}

function minuteVentLpm(s: EngineState): number {
  const x = I(s),
    t = s.simTimeSec;
  const recent = x.breathLog.filter(b => b.tEnd > t - 30);
  if (!recent.length) return 0;
  const span = Math.min(30, Math.max(5, t - recent[0].tStart));
  return ((recent.reduce((a, b) => a + b.vtMl, 0) / span) * 60) / 1000;
}

export function currentFio2(s: EngineState): number {
  return effectiveFio2(s.device, pifLpm(s), minuteVentLpm(s));
}

export function currentPh(s: EngineState): number {
  return phFrom(currentHco3(s), s.phys.paco2MmHg);
}

export function currentHco3(s: EngineState): number {
  const m = I(s).metabolicHco3;
  return m + acuteBuffer(s.phys.paco2MmHg, m, s.patient.chronicPaco2MmHg ?? 40);
}

const PACO2_RISE_TAU_SEC = 800; // rise half-time about 16 min with the tissue blend (Nunn & Lumb 9e ch 9)
const PACO2_FALL_TAU_SEC = 90;
const CHEMO_GAIN_ACID_PER_PH = 8; // rise in drive per pH unit of acidaemia
const CHEMO_GAIN_ALK_PER_PH = 3; // fall in drive per pH unit of alkalaemia (response curve flattens below the set point, Nunn ch 4)
const DRIVE_FLOOR = 0.2;
const DRIVE_CEILING = 1.4; // was 1.6; with the higher gain the ceiling keeps metabolic acidosis on Winter formula (1.5 x HCO3 + 8 +- 2)
const TISSUE_RISE_TAU_SEC = 900;
const TISSUE_FALL_TAU_SEC = 480;

// Oxygen-induced rise in V/Q dead space (release of hypoxic vasoconstriction) in chronic CO2 retainers only.
const O2_DEADSPACE_GAIN = 0.25; // UNVERIFIED magnitude - for physiology audit
const O2_DEADSPACE_TAU_SEC = 900;

function steadyVaAtPaco2(vco2: number, paco2: number): number {
  return (0.863 * vco2) / Math.max(1, paco2);
}

export function slowUpdate(s: EngineState, dt: number) {
  const x = I(s),
    p = s.patient,
    phys = s.phys;

  updateApnoeaBackup(s, s.simTimeSec);
  const va = alveolarVentilationLpm(s);
  let ssTarget: number | null = null;
  let dCo2: number | null = null;
  if (x.tissueCo2 === undefined) x.tissueCo2 = phys.paco2MmHg;
  const o2Target =
    (p.chronicPaco2MmHg ?? 40) > 45 ? O2_DEADSPACE_GAIN * Math.max(0, (currentFio2(s) - 0.21) / 0.79) : 0;
  x.o2DeadSpace = (x.o2DeadSpace ?? 0) + (o2Target - (x.o2DeadSpace ?? 0)) * Math.min(1, dt / O2_DEADSPACE_TAU_SEC);
  if (va !== null) {
    const ss = steadyPaco2(p.vco2MlPerMin, va);
    const target = 0.6 * ss + 0.4 * x.tissueCo2;
    const rising = target > phys.paco2MmHg;
    let d = (target - phys.paco2MmHg) * Math.min(1, dt / (rising ? PACO2_RISE_TAU_SEC : PACO2_FALL_TAU_SEC));
    // Rise cap (6 mmHg/min in total apnoea) scales with the fraction of CO2 actually retained.
    const retained = Math.max(0, 1 - va / steadyVaAtPaco2(p.vco2MlPerMin, phys.paco2MmHg));
    d = Math.min(d, (6 / 60) * dt * retained);
    phys.paco2MmHg = Math.max(10, phys.paco2MmHg + d);
    // Tissue stores fill slowly (rise) and wash out faster (fall), after Nunn & Lumb 9e ch 9/27.
    const ttau = phys.paco2MmHg < x.tissueCo2 ? TISSUE_FALL_TAU_SEC : TISSUE_RISE_TAU_SEC;
    x.tissueCo2 += (phys.paco2MmHg - x.tissueCo2) * Math.min(1, dt / ttau);
    ssTarget = target;
    dCo2 = d;
  }
  phys.hco3MmolL = currentHco3(s);
  const ph = phFrom(phys.hco3MmolL, phys.paco2MmHg);

  // Recruitment: target depends on sustained end-expiratory pressure; recruit slowly, derecruit fast.
  const pr = recruitingPressure(s.device);
  const recruitTarget = pr >= 5 ? Math.min(1, (pr - 5) / 10) : (-0.5 * (5 - pr)) / 5;
  const rtau = recruitTarget > phys.recruitedFraction ? 120 : 30;
  phys.recruitedFraction += (recruitTarget - phys.recruitedFraction) * Math.min(1, dt / rtau);
  const shunt = Math.min(0.9, Math.max(0, p.shuntFraction * (1 - p.recruitability * phys.recruitedFraction)));

  // Circulation (rule based)
  const recent = mainBreaths(s).filter(b => b.tEnd > s.simTimeSec - 30).slice(-4);
  const C_eff = effectiveCompliance(p, x.V, setPeepLevel(s.device) ?? 0);
  const palvNow =
    x.V / C_eff; // V is absolute volume and already includes the PEEP volume
  const palvMean = recent.length ? recent.reduce((a, b) => a + b.palvMean, 0) / recent.length : palvNow;
  const eff = ppvEffect(p.ppvResponse, p.ppvSeverity, palvMean);

  let mapFrac = eff.mapFrac;
  if (ph < 7.1) mapFrac -= Math.min(0.25, (7.1 - ph) * 1.5);
  const sbp = p.sbpBaselineMmHg * (1 + mapFrac);
  const dbp = p.dbpBaselineMmHg * (1 + mapFrac);
  const sat = x.sao2 * 100;
  let hr = p.hrBaselineBpm + eff.hrDelta;
  if (sat < 90) hr += Math.min(40, (90 - sat) * 1.2);
  if (phys.paco2MmHg > 50) hr += Math.min(20, (phys.paco2MmHg - 50) * 0.3);
  hr += 10 * phys.fatigue;
  const htau = 20;
  x.sbp += (sbp - x.sbp) * Math.min(1, dt / htau);
  x.dbp += (dbp - x.dbp) * Math.min(1, dt / htau);
  x.hr += (hr - x.hr) * Math.min(1, dt / htau);
  x.co = 5 * (1 + eff.coFrac);

  // Oxygen: shunt equation; arterial PO2 follows within about 20 s; monitor SpO2 lags about 15 s.
  const fio2 = currentFio2(s);
  const pao2Steady = alveolarPo2(fio2, phys.paco2MmHg);
  const frcMl = Math.max(1000, 30 * p.actualWeightKg);
  const vaLpm = va ?? 4;
  if (x.alvPo2Store === undefined) x.alvPo2Store = pao2Steady;
  const depletion =
    p.vo2MlPerMin *
    (s.device.device === 'hfnc' ? APNOEIC_HFNC_UNREPLACED : 1) *
    Math.min(1, x.alvPo2Store / 100) *
    (PATM_MMHG - PH2O_MMHG) *
    Math.max(0, 1 - vaLpm / 0.5);
  const dStore = ((vaLpm * 1000 * (pao2Steady - x.alvPo2Store) - depletion) / frcMl) * (dt / 60);
  x.alvPo2Store = Math.max(5, Math.min(pao2Steady, x.alvPo2Store + dStore));
  const pao2Alv = x.alvPo2Store;
  const pao2 = arterialPo2({
    alvPo2: pao2Alv,
    fio2,
    paco2: phys.paco2MmHg,
    shunt,
    hb: p.hbGPerDl,
    vo2: p.vo2MlPerMin,
    coLpm: x.co,
    ph,
    tempC: p.temperatureC,
    lowVqFraction: p.lowVqFraction,
    lowVqRatio: p.lowVqRatio,
  });
  x.pao2Target = pao2;
  phys.pao2MmHg += (pao2 - phys.pao2MmHg) * Math.min(1, dt / 20);
  x.sao2 = satFromPo2(phys.pao2MmHg, ph, p.temperatureC);
  x.spo2Shown += (x.sao2 * 100 - x.spo2Shown) * Math.min(1, dt / 15);

  // Chemoreflex drive relative to the starting pH; hypoxaemia adds drive.
  const chronicPaco2 = p.chronicPaco2MmHg ?? 40;
  const phSet = 7.4 - 0.003 * (chronicPaco2 - 40);
  // Gain: healthy awake about 2 L/min per mmHg PaCO2 (Nunn ch 4 p48), a large relative change per 0.01 pH.
  // Scaled down for chronic retainers (blunted CO2 response) and for sedation (low spontaneous rate/effort).
  const retainerScale = chronicPaco2 > 45 ? Math.max(0.4, 1 - (chronicPaco2 - 45) / 25) : 1;
  const sedScale = Math.min(1, Math.max(0.2, Math.min(p.spontRateBpm / 10, p.pmusAmplitudeCmH2O / 4)));
  const dPh = phSet - ph;
  let drive = 1 + (dPh > 0 ? CHEMO_GAIN_ACID_PER_PH : CHEMO_GAIN_ALK_PER_PH) * retainerScale * sedScale * dPh;
  if (phys.pao2MmHg < 60) drive *= 1 + 0.5 * Math.min(1, (60 - phys.pao2MmHg) / 30);
  x.drive = Math.min(DRIVE_CEILING, Math.max(DRIVE_FLOOR, drive));

  // Fatigue
  const unloading = effortUnloading(s);
  const { rate, amp, tiN } = effortParams(s);
  const ptp = rate > 0.5 ? amp * rate * tiN * 0.5 : 0;
  const capacity = Math.max(1, p.respiratoryReserve * 250);
  const ratio = ptp / capacity;
  const fatChange = (ratio > 1 ? (ratio - 1) / 1800 : -(1 - ratio) / 3600) * dt;
  phys.fatigue += fatChange;
  phys.fatigue = Math.min(1, Math.max(0, phys.fatigue));

  // Trapped volume and VILI exposure
  const C = effectiveCompliance(p, x.V, setPeepLevel(s.device) ?? 0);
  const peepSet =
    setPeepLevel(s.device) ?? (driveFor(s.device).kind === 'free' ? (driveFor(s.device) as { paw: number }).paw : 0);
  const mb = mainBreaths(s);
  const last = mb[mb.length - 1];
  if (last) {
    phys.trappedVolumeMl = Math.max(0, (last.palvEndExp - peepSet) * C);
    if (s.device.device === 'invasive') {
      if (last.palvEndInsp > 30) phys.vili.minutesPplatOver30 += dt / 60;
      if (last.palvEndInsp - last.palvEndExp > 15) phys.vili.minutesDrivingPressureOver15 += dt / 60;
      if (last.vtMl / pbwKg(p) > 8) phys.vili.minutesVtOver8MlKgPbw += dt / 60;
    }
  }
  updateMonitoredSlow(s, fio2);

  x.trace = {
    alveolarVentilation: va,
    deadSpaceFraction: p.alveolarDeadSpaceFraction,
    steadyPaco2Target: ssTarget,
    paco2Change: dCo2,
    ph,
    shuntUsed: shunt,
    recruitedFraction: phys.recruitedFraction,
    fio2Effective: fio2,
    pao2Alveolar: pao2Alv,
    pao2,
    drive: x.drive,
    unloading,
    ptp,
    fatigueChange: fatChange,
    circulationMultiplier: 1 + mapFrac,
  };
}

// ---------------------------------------------------------------------------
// Monitored values
// ---------------------------------------------------------------------------

function updateMonitoredFromBreaths(s: EngineState) {
  const x = I(s),
    m = s.monitored,
    t = s.simTimeSec;
  const ar = aprvReadouts(s);
  if (ar) {
    // APRV: releases are the ventilator cycles; spontaneous breaths are counted on top.
    const rel = mainBreaths(s).slice(-4);
    const inMin = x.breathLog.filter(b => b.tEnd > t - 60);
    const span = Math.min(60, Math.max(10, t - (inMin[0]?.tStart ?? t)));
    m.aprv = ar;
    m.rrTotalBpm = Math.round(ar.releaseRatePerMin + ar.spontRatePerMin);
    m.rrSpontBpm = Math.round(ar.spontRatePerMin);
    m.ppeakCmH2O = rel.length ? round1(avg(rel.map(b => b.ppeak))) : null;
    m.pmeanCmH2O = ar.meanAirwayPressureCmH2O;
    m.vteMl = rel.length ? Math.round(avg(rel.map(b => b.vteMl))) : null;
    m.minuteVentLpm = rel.length ? round1((inMin.reduce((a, b) => a + b.vteMl, 0) / span) * (60 / 1000)) : null;
    m.leakLpm = null;
    return;
  }
  if (m.aprv) delete m.aprv;
  const recent = x.breathLog.slice(-4);
  const inLastMin = x.breathLog.filter(b => b.tEnd > t - 60);
  const span = Math.min(60, Math.max(10, t - (inLastMin[0]?.tStart ?? t)));
  const isVent = s.device.device === 'invasive' || s.device.device === 'niv';
  const durs = recent.map(b => b.tEnd - b.tStart).filter(d => d > 0);
  m.rrTotalBpm = durs.length ? Math.round(60 / avg(durs)) : 0;
  const spontShare = inLastMin.length ? inLastMin.filter(b => b.kind !== 'mandatory').length / inLastMin.length : 0;
  m.rrSpontBpm = Math.round(m.rrTotalBpm * spontShare);
  if (isVent && recent.length) {
    m.ppeakCmH2O = round1(avg(recent.map(b => b.ppeak)));
    m.pmeanCmH2O = round1(avg(recent.map(b => b.pmean)));
    m.vteMl = Math.round(avg(recent.map(b => b.vteMl)));
    m.minuteVentLpm = round1((inLastMin.reduce((a, b) => a + b.vteMl, 0) / span) * (60 / 1000));
    m.leakLpm = s.device.device === 'niv' ? Math.round(nivLeakLpm(s.device.maskFit, m.pmeanCmH2O)) : null;
  } else {
    m.ppeakCmH2O = null;
    m.pmeanCmH2O = null;
    m.vteMl = null;
    m.minuteVentLpm = null;
    m.leakLpm = null;
  }
}

function updateMonitoredSlow(s: EngineState, fio2: number) {
  const x = I(s),
    m = s.monitored,
    p = s.patient;
  m.simTimeSec = round1(s.simTimeSec);
  m.apnoeaBackupActive = Boolean(x.apnoeaBackup);
  m.fio2 = round2(fio2);
  m.peepSetCmH2O = setPeepLevel(s.device);
  m.hfncPressureCmH2O = s.device.device === 'hfnc' ? round1(hfncPeep(s.device.flowLpm)) : null;
  m.hrBpm = Math.round(x.hr);
  m.sbpMmHg = Math.round(x.sbp);
  m.dbpMmHg = Math.round(x.dbp);
  m.mapMmHg = Math.round((x.sbp + 2 * x.dbp) / 3);
  m.spo2Pct = Math.round(Math.min(100, x.spo2Shown));
  m.temperatureC = p.temperatureC;

  const recentVte = mainBreaths(s).slice(-4);
  const meanVte = recentVte.length ? avg(recentVte.map(b => b.vteMl)) : 0;
  const vd = p.anatomicDeadSpaceMl;
  // EtCO2 tracks alveolar CO2 while Vt > VD (modest dilution as Vt nears VD); fades only as Vt falls below VD.
  const vtScale =
    meanVte >= vd
      ? Math.min(1, 0.6 + (0.4 * (meanVte - vd)) / Math.max(1, vd))
      : Math.max(0, (0.6 * (meanVte - 0.75 * vd)) / Math.max(1, 0.25 * vd));
  const normalEtco2 = s.phys.paco2MmHg * (1 - p.alveolarDeadSpaceFraction);
  m.etco2MmHg = s.device.device === 'invasive' && x.breathLog.length ? Math.round(normalEtco2 * vtScale) : null;

  const isVent = s.device.device === 'invasive' || s.device.device === 'niv';
  const lastEnd = x.breathLog.length ? x.breathLog[x.breathLog.length - 1].tEnd : -Infinity;
  const cycles = x.breathLog
    .slice(-4)
    .map(b => b.tEnd - b.tStart)
    .filter(d => d > 0);
  const staleAfter = Math.max(15, 3 * (cycles.length ? avg(cycles) : 5));
  const stale = s.simTimeSec - lastEnd > staleAfter && x.phase !== 'insp';
  if (!isVent) {
    m.ppeakCmH2O = null;
    m.pmeanCmH2O = null;
    m.vteMl = null;
    m.minuteVentLpm = null;
    m.leakLpm = null;
    if (s.device.device !== 'invasive') m.etco2MmHg = null;
  } else if (stale) {
    m.ppeakCmH2O = null;
    m.pmeanCmH2O = null;
    m.vteMl = null;
    m.minuteVentLpm = 0;
    m.leakLpm = null;
    m.rrTotalBpm = 0;
    m.rrSpontBpm = 0;
    if (s.device.device === 'invasive') m.etco2MmHg = 0;
  } else if (x.breathLog.length && s.simTimeSec - lastEnd > 20) {
    m.rrTotalBpm = 0;
    m.rrSpontBpm = 0;
    if (m.minuteVentLpm !== null) m.minuteVentLpm = 0;
  }
}

// ---------------------------------------------------------------------------
// Truth values
// ---------------------------------------------------------------------------

export function truth(s: EngineState): Truth {
  const x = I(s),
    p = s.patient;
  const mbT = mainBreaths(s);
  const last = mbT[mbT.length - 1];
  const peep = setPeepLevel(s.device);
  const fio2 = currentFio2(s);
  return {
    ph: currentPh(s),
    paco2: s.phys.paco2MmHg,
    pao2: s.phys.pao2MmHg,
    pfRatio: s.phys.pao2MmHg / fio2,
    fatigue: s.phys.fatigue,
    pplat: last && s.device.device !== 'none' && s.device.device !== 'hfnc' ? last.palvEndInsp : null,
    autoPeep: last && peep !== null ? Math.max(0, last.palvEndExp - peep) : null,
    drivingPressure: last && peep !== null ? last.palvEndInsp - last.palvEndExp : null,
    vteMlKgPbw: last ? last.vtMl / pbwKg(p) : null,
    alveolarVentLpm: alveolarVentilationLpm(s),
    trappedVolumeMl: s.phys.trappedVolumeMl,
  };
}

export function abg(s: EngineState): AbgResult {
  const x = I(s);
  const hco3 = currentHco3(s);
  const ph = phFrom(hco3, s.phys.paco2MmHg);
  const map = (x.sbp + 2 * x.dbp) / 3;
  let lactate = 1.0 + Math.max(0, 65 - map) / 10;
  if (x.sao2 < 0.8) lactate += (0.8 - x.sao2) * 10;
  return {
    sampledAtSimSec: round1(s.simTimeSec),
    fio2: round2(currentFio2(s)),
    ph: round2(ph),
    paco2MmHg: Math.round(s.phys.paco2MmHg),
    pao2MmHg: Math.round(s.phys.pao2MmHg),
    hco3MmolL: round1(hco3),
    baseExcessMmolL: round1(baseExcess(hco3, ph)),
    sao2Pct: Math.round(x.sao2 * 100),
    lactateMmolL: round1(lactate),
  };
}

export function initialPao2(patient: PatientParams, device: DeviceSettings, paco2: number, ph: number): number {
  const fio2 = effectiveFio2(device, 30, 8);
  const shunt = patient.shuntFraction;
  return (
    arterialPo2({
      fio2,
      paco2,
      shunt,
      hb: patient.hbGPerDl,
      vo2: patient.vo2MlPerMin,
      coLpm: 5,
      ph,
      tempC: patient.temperatureC,
      lowVqFraction: patient.lowVqFraction,
      lowVqRatio: patient.lowVqRatio,
    }) || alveolarPo2(fio2, paco2)
  );
}

export function newState(patient: PatientParams, device: DeviceSettings, phys: PhysState): EngineState {
  const st: EngineState = {
    apiVersion: ENGINE_API_VERSION,
    simTimeSec: 0,
    patient,
    device,
    phys,
    lastBreath: null,
    monitored: emptyMonitored({ simTimeSec: 0, device, patient }, 0.21),
    internal: createInternal(patient, device, phys),
  };
  return st;
}

function avg(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function round1(v: number) {
  return Math.round(v * 10) / 10;
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}
function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}
