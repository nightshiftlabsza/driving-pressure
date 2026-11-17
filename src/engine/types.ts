import type {
  BreathSummary,
  DeviceSettings,
  EngineState,
  Manoeuvre,
  ManoeuvreResult,
  PatientParams,
  PhysState,
} from '../shared/engineTypes';
import type { EngineTrace } from './trace';

export const DT = 0.005;              // integration step, s (200 Hz)
export const SAMPLE_EVERY = 4;        // output at 50 Hz
export const REFRACTORY_SEC = 0.25;   // no triggering this soon after inspiration ends
export const PMUS_RELAX_TAU = 0.15;   // s, exponential relaxation after neural inspiration
export const SLOW_STEP = 1;           // s, slow physiology update period
export const VA_WINDOW = 30;          // s, window for alveolar ventilation
export const DEFAULT_PMAX_CMH2O = 60;
export const APNOEIC_HFNC_UNREPLACED = 0.4;
// Apnoea backup (Hamilton C1 manual 5.5.2: on by default; adult apnoea time 20 s)
export const APNOEA_TIME_SEC = 20;
export const BACKUP_RATE_BPM = 12;
export const BACKUP_VT_ML_PER_KG_PBW = 8;
export const BACKUP_EXIT_BREATHS = 3; // consecutive patient-triggered breaths that end backup

export type Phase = 'insp' | 'exp' | 'hold';
export type Control = 'vc' | 'pc' | 'ps' | 'free';
export type BreathKind = 'mandatory' | 'assisted' | 'spontaneous' | 'none';

export interface BreathLogEntry {
  tEnd: number;
  tStart: number;
  vtMl: number;
  kind: Exclude<BreathKind, 'none'>;
  pifLps: number;
  palvMean: number;
  pmean: number;
  ppeak: number;
  vteMl: number;
  palvEndInsp: number;
  palvEndExp: number;
  level?: 'high' | 'low';        // APRV: pressure level the breath belongs to
}

export interface Internal {
  [key: string]: unknown;
  V: number;
  phase: Phase;
  control: Control;
  kind: BreathKind;
  breathStart: number;
  inspEnd: number;
  inspDeliveredMl: number;
  peakInspFlow: number;
  lastVentBreathStart: number;
  lastMandatoryStart: number;
  simvWindowStart: number;
  simvMandatoryDone: boolean;
  // patient effort generator
  effortStart: number;            // -1 = none yet
  nextEffort: number;
  effortTriggered: boolean;
  effortStartedInExp: boolean;
  effortCounted: boolean;
  // breath accumulators
  accVti: number;
  accVte: number;
  accPpeak: number;
  accPawSum: number;
  accPalvSum: number;
  accN: number;
  accVnet: number;
  accIneffective: number;
  accTiSec: number;
  accPalvEndInsp: number;
  accTriggerDelayMs?: number;
  lastFlow: number;
  lastPaw: number;
  breathLog: BreathLogEntry[];
  firstBreathStart: number;       // NaN before the first breath
  // manoeuvres
  pending: Manoeuvre | null;
  holdKind: 'insp-hold' | 'exp-hold' | 'occlusion' | null;
  holdStart: number;
  holdMax: number;
  holdMaxPmus: number;
  holdPawSum: number;
  holdN: number;
  holdResumeMandatory: boolean;
  occlusionMinPaw?: number;
  occlusionP01?: number;
  result: ManoeuvreResult | null;
  // slow physiology
  lastSlow: number;
  metabolicHco3: number;
  pao2Target: number;
  sao2: number;
  spo2Shown: number;
  drive: number;                  // chemoreflex multiplier
  tissueCo2?: number;             // slow CO2 store, mmHg
  o2DeadSpace?: number;           // added V/Q dead-space fraction from oxygen (chronic retainers only)
  alvPo2Store?: number;           // alveolar PO2 held in the FRC O2 store, mmHg
  accPmaxHit?: boolean;           // current breath was cut off at the high-pressure limit
  hr: number;
  sbp: number;
  dbp: number;
  co: number;
  stepCounter: number;
  trace?: EngineTrace | null;
  aprv?: import('./aprv').AprvState;
  apnoeaBackup?: boolean;         // apnoea backup ventilation currently active
  backupSpont?: number;           // consecutive patient-triggered breaths while in backup
  backupPinsp?: number;           // backup inspiratory pressure above PEEP, cmH2O
  // Phase 6 dyssynchrony counters
  doubleTriggerCount?: number;
  prematureCycleCount?: number;
  delayedCycleCount?: number;
  flowStarvationCount?: number;
  autoTriggerCount?: number;
  reverseTriggerCount?: number;
}

export function I(s: EngineState): Internal {
  return s.internal as Internal;
}

export interface Truth {
  ph: number;
  paco2: number;
  pao2: number;
  pfRatio: number;
  fatigue: number;
  pplat: number | null;
  autoPeep: number | null;
  drivingPressure: number | null;
  vteMlKgPbw: number | null;
  alveolarVentLpm: number | null;
  trappedVolumeMl: number;
}
