/**
 * FROZEN CONTRACT: engine inputs and outputs.
 *
 * Owned by the engine maintainer. Agents may import from this file but must not edit it.
 * Any change needs a version bump and a note in docs/CONTRACTS.md.
 *
 * Units are in every field name or comment. Pressures are cmH2O, flows L/s unless stated,
 * volumes mL, gases mmHg, time seconds.
 */

export const ENGINE_API_VERSION = '1.3.0';

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

/**
 * How this patient's cardiac output responds to positive intrathoracic pressure.
 * - helpful: positive pressure improves things (e.g. LV failure, afterload reduction)
 * - unhelpful: little effect either way
 * - complicated: mixed (e.g. RV failure, where PEEP can help or hurt depending on level)
 * - clean-kill: strongly preload dependent; positive pressure or auto-PEEP drops BP sharply
 */
export type PpvResponse = 'helpful' | 'unhelpful' | 'complicated' | 'clean-kill';

export interface PatientParams {
  sex: 'M' | 'F';
  ageYears: number;
  heightCm: number;
  actualWeightKg: number;

  // Respiratory mechanics (single compartment)
  complianceMlPerCmH2O: number;      // static respiratory system compliance
  inspResistanceCmH2OPerLps: number; // airway + tube resistance during inspiration
  expResistanceCmH2OPerLps: number;  // expiratory resistance (higher in COPD/asthma)
  /** Optional (added 1.1.0). Airway closing pressure for expiratory flow limitation (COPD), cmH2O.
   *  Exhalation cannot be driven below this pressure faster than slowly, so external PEEP/EPAP below it
   *  does not slow emptying but does make triggering easier. Omit for no flow limitation. */
  expFlowLimitationCmH2O?: number;

  // Spontaneous breathing
  spontRateBpm: number;              // intrinsic drive when breathing spontaneously; 0 = apnoeic/paralysed
  pmusAmplitudeCmH2O: number;        // peak inspiratory muscle pressure per breath; 0 = no effort
  pmusInspTimeSec: number;           // neural inspiratory time

  // Gas exchange
  vco2MlPerMin: number;              // CO2 production
  vo2MlPerMin: number;               // O2 consumption
  anatomicDeadSpaceMl: number;       // conducting airway + apparatus dead space
  alveolarDeadSpaceFraction: number; // 0..1, fraction of alveolar ventilation that is wasted
  shuntFraction: number;             // 0..1, true shunt at baseline PEEP of 5
  recruitability: number;            // 0..1, how much shunt PEEP can reverse
  hbGPerDl: number;
  temperatureC: number;

  // Acid-base
  baselineHco3MmolL: number;         // standard bicarbonate: HCO3 the patient would have at PaCO2 40 (metabolic component).
                                     // Measured HCO3 adds acute buffering: +0.1 mmol/L per mmHg PaCO2 above 40, 0.2 per mmHg below,
                                     // scaled down in proportion when standard HCO3 is below 24 (engine 1.1.0).
                                     // If the case gives initialPhys.hco3MmolL, that measured value wins and sets the metabolic part.
  /** Optional (added Phase 2). Usual compensated PaCO2 when well, mmHg. Default 40.
   *  In chronic CO2 retention, sets the target for both chemical drive defense and baseline renal compensation. */
  chronicPaco2MmHg?: number;

  // Circulation (rule based, not a cardiovascular model)
  hrBaselineBpm: number;
  sbpBaselineMmHg: number;
  dbpBaselineMmHg: number;
  ppvResponse: PpvResponse;
  ppvSeverity: number;               // 0..1, how strong the ppvResponse effect is

  // Load and fatigue
  respiratoryReserve: number;        // 0..1, 1 = fresh; fatigue accumulates when load exceeds reserve

  // Phase 6 additions (Physiology v2)
  /** Optional (added Phase 6). V/Q mismatch: fraction of pulmonary perfusion to low V/Q units (0..1, default 0). */
  lowVqFraction?: number;
  /** Optional (added Phase 6). V/Q ratio of the low compartment (default 0.1). */
  lowVqRatio?: number;
  /** Optional (added Phase 6). Lung architecture model: single (default) or two-compartment. */
  lungModel?: 'single' | 'two-compartment';
  /** Optional (added Phase 6). Two-compartment recruitment & overdistension parameters. */
  twoCompartmentParams?: TwoCompartmentParams;
  /** Optional (added Phase 6). Chest wall compliance, mL/cmH2O. Default derived so total Crs is unchanged. */
  chestWallComplianceMlPerCmH2O?: number;
  /** Optional (added Phase 6). Probability (0..1) of reverse-trigger entrainment after mandatory breath. */
  reverseTriggerProbability?: number;
}

export interface TwoCompartmentParams {
  openingPressureCmH2O?: number;       // critical opening pressure for recruitable units (cmH2O)
  closingPressureCmH2O?: number;       // closing pressure for derecruitment (cmH2O)
  recruitComplianceMlPerCmH2O?: number;// additional compliance when fully recruited (mL/cmH2O)
  overdistensionVolumeMl?: number;     // volume above which compliance falls off (mL)
  overdistensionFalloff?: number;      // rate of compliance decrease per mL above overdistension threshold
}

// ---------------------------------------------------------------------------
// Devices and settings
// ---------------------------------------------------------------------------

export type InvasiveMode = 'VC-AC' | 'PC-AC' | 'PSV' | 'CPAP' | 'SIMV-VC' | 'APRV';

export interface InvasiveSettings {
  device: 'invasive';
  mode: InvasiveMode;
  fio2: number;                      // 0.21..1.0
  peep: number;                      // cmH2O
  rrSetBpm: number;                  // mandatory rate (ignored in PSV/CPAP)
  vtSetMl?: number;                  // VC-AC, SIMV-VC
  inspFlowLpm?: number;              // VC: peak inspiratory flow, L/min
  flowPattern?: 'square' | 'decelerating';
  pinspAbovePeep?: number;           // PC-AC: inspiratory pressure above PEEP
  tiSec?: number;                    // PC-AC: inspiratory time
  psAbovePeep?: number;              // PSV, SIMV-VC spontaneous breaths, CPAP + PS
  cyclePctPeakFlow?: number;         // PSV expiratory trigger, % of peak flow (default 25)
  triggerFlowLpm?: number;           // flow trigger sensitivity (default 2)
  riseTimeSec?: number;              // pressure rise time for PC/PS (default 0.1)
  pmaxCmH2O?: number;                // high-pressure limit: breath cycles off at this Paw (default 60 = DEFAULT_PMAX_CMH2O; the high-pressure ALARM is at 40, owner decision 9 Nov 2026)
  circuitLeakLpm?: number;           // unintentional circuit leak, L/min (default 0)
  cycleOffPct?: number;              // alias for cyclePctPeakFlow
  apnoeaBackup?: boolean;            // PSV/CPAP: backup mandatory ventilation after 20 s of apnoea (default on, Hamilton C1 manual 5.5.2)
  // APRV (time-cycled pressure release; the engine ignores `peep`/`rrSetBpm` in this mode, the UI mirrors Plow into `peep`)
  phighCmH2O?: number;               // APRV: high pressure level
  plowCmH2O?: number;                // APRV: release (low) pressure level
  thighSec?: number;                 // APRV: time at Phigh
  tlowSec?: number;                  // APRV: release time at Plow
}

export interface NivSettings {
  device: 'niv';
  mode: 'CPAP' | 'ST';               // ST = spontaneous/timed bilevel
  fio2: number;
  epap: number;                      // cmH2O; CPAP level when mode = CPAP
  ipap?: number;                     // cmH2O, absolute (not above EPAP); ST only
  backupRrBpm?: number;              // ST only
  tiSec?: number;                    // backup breath inspiratory time
  apnoeaBackup?: boolean;            // CPAP: backup mandatory ventilation after 20 s of apnoea (default on)
  interface: 'oronasal' | 'full-face' | 'nasal' | 'helmet';
  maskFit: 'good' | 'fair' | 'poor'; // drives unintentional leak in the engine
}

export interface HfncSettings {
  device: 'hfnc';
  flowLpm: number;                   // 10..60 adult
  fio2: number;
  temperatureC: number;              // 31, 34 or 37
}

export interface NoDeviceSettings {
  device: 'none';
  o2: 'room-air' | 'nasal-cannula' | 'simple-mask' | 'venturi' | 'non-rebreather';
  o2FlowLpm: number;
}

export type DeviceSettings = InvasiveSettings | NivSettings | HfncSettings | NoDeviceSettings;

/** Manoeuvres the learner can run. Holds last until released or maxSec. */
export type Manoeuvre =
  | { kind: 'insp-hold'; maxSec: number }
  | { kind: 'exp-hold'; maxSec: number }
  | { kind: 'occlusion'; maxSec: number };

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface WaveformSample {
  tSec: number;                      // simulated time
  pawCmH2O: number;                  // airway pressure at the Y-piece / mask
  flowLps: number;                   // + inspiration, - expiration (patient flow, leak removed)
  volumeMl: number;                  // volume above FRC at set PEEP (includes trapped volume)
  pmusCmH2O: number;                 // patient effort (positive = inspiratory effort); for teaching overlays
  phase: 'insp' | 'exp' | 'hold';
  breathType: 'mandatory' | 'assisted' | 'spontaneous' | 'none';
  pesCmH2O?: number;                 // esophageal pressure, cmH2O
  plCmH2O?: number;                  // transpulmonary pressure (Paw - Pes), cmH2O
}

export interface BreathSummary {
  endTimeSec: number;
  breathType: 'mandatory' | 'assisted' | 'spontaneous';
  vtiMl: number;
  vteMl: number;
  ppeakCmH2O: number;
  pmeanCmH2O: number;                // integrated over the whole breath
  tiSec: number;
  teSec: number;
  endExpFlowLps: number;             // non-zero = incomplete exhalation
  leakLpm: number;                   // NIV only, 0 otherwise
  triggerDelayMs?: number;
  ineffectiveEfforts: number;        // efforts during this breath that failed to trigger
  pmaxLimited?: boolean;             // inspiration was cut off by the high-pressure limit
  // Optional dyssynchrony markers (Phase 6)
  doubleTriggered?: boolean;
  prematureCycled?: boolean;
  delayedCycled?: boolean;
  flowStarved?: boolean;
  autoTriggered?: boolean;
  reverseTriggered?: boolean;
}

export interface ManoeuvreResult {
  kind: 'insp-hold' | 'exp-hold' | 'occlusion';
  pplatCmH2O?: number;               // insp-hold
  totalPeepCmH2O?: number;           // exp-hold
  autoPeepCmH2O?: number;            // exp-hold: total PEEP - set PEEP
  p01CmH2O?: number;                 // occlusion: 100 ms airway occlusion pressure drop
  deltaPoccCmH2O?: number;           // occlusion: peak negative airway deflection
  pmusEstimatedCmH2O?: number;       // occlusion: estimated Pmus (-0.75 * deltaPocc)
  deltaPlDynEstimatedCmH2O?: number; // occlusion: dynamic transpulmonary pressure swing
  valid: boolean;                    // false if patient effort spoiled the hold / no effort during occlusion
}

export interface AprvReadouts {
  releaseVolumeMl: number | null;         // gas exhaled during the last release
  releaseRatePerMin: number;              // releases in the last 60 s
  spontRatePerMin: number;                // spontaneous breaths in the last 60 s
  meanAirwayPressureCmH2O: number | null; // time-weighted over the last full cycle
  endReleaseFlowPctOfPeak: number | null; // flow at the end of the last release as % of its peak expiratory flow
  autoPeepCmH2O: number | null;           // from the last valid expiratory hold during APRV, else null
}

/** What a bedside monitor and ventilator screen show. Rolling averages over recent breaths. */
export interface MonitoredValues {
  simTimeSec: number;
  // ventilator / device
  ppeakCmH2O: number | null;
  pmeanCmH2O: number | null;
  peepSetCmH2O: number | null;
  vteMl: number | null;
  minuteVentLpm: number | null;
  rrTotalBpm: number;
  rrSpontBpm: number;
  fio2: number;
  leakLpm: number | null;
  /** Optional (added Phase 4). Estimated continuous positive airway pressure on HFNC, cmH2O. Rule-based mouth-open estimate (0.05 * flowLpm). Null on other devices. */
  hfncPressureCmH2O?: number | null;
  // patient monitor
  hrBpm: number;
  sbpMmHg: number;
  dbpMmHg: number;
  mapMmHg: number;
  spo2Pct: number;
  etco2MmHg: number | null;          // null when no capnography (e.g. HFNC)
  temperatureC: number;
  // Advanced mechanics / effort monitoring (added Phase 6)
  pesCmH2O?: number | null;          // esophageal pressure, cmH2O
  plEndInspCmH2O?: number | null;    // end-inspiratory transpulmonary pressure, cmH2O
  plEndExpCmH2O?: number | null;     // end-expiratory transpulmonary pressure, cmH2O
  p01CmH2O?: number | null;          // 100 ms airway occlusion pressure drop, cmH2O
  /** APRV readouts; present only while the mode is APRV. Neutral measurements, not graded. */
  aprv?: AprvReadouts;
  deltaPoccCmH2O?: number | null;    // peak occlusion pressure deflection, cmH2O
  /** True while the ventilator is giving apnoea backup ventilation (PSV/CPAP, no breath for 20 s). */
  apnoeaBackupActive?: boolean;
}

export interface AbgResult {
  sampledAtSimSec: number;
  fio2: number;
  ph: number;
  paco2MmHg: number;
  pao2MmHg: number;
  hco3MmolL: number;
  baseExcessMmolL: number;
  sao2Pct: number;
  lactateMmolL: number;
}

/** Exposure counters for debrief only. They never feed back into physiology in v1. */
export interface ViliExposure {
  minutesPplatOver30: number;
  minutesDrivingPressureOver15: number;
  minutesVtOver8MlKgPbw: number;
}

/** Slow physiological state. Serializable so a run can be saved and replayed. */
export interface PhysState {
  paco2MmHg: number;
  pao2MmHg: number;
  hco3MmolL: number;
  recruitedFraction: number;         // -0.5..1: share of recruitable shunt currently recruited (negative = derecruited, PEEP below 5)
  fatigue: number;                   // 0..1, 0 = none
  trappedVolumeMl: number;
  vili: ViliExposure;
}

/** Full engine state. Treat as opaque outside src/engine except for the fields named here. */
export interface EngineState {
  apiVersion: string;
  simTimeSec: number;
  patient: PatientParams;
  device: DeviceSettings;
  phys: PhysState;
  lastBreath: BreathSummary | null;
  lastManoeuvre?: ManoeuvreResult | null;
  monitored: MonitoredValues;
  /** Engine-private fields live here. Do not read them outside src/engine. */
  internal: Record<string, unknown>;
}

export interface StepResult {
  state: EngineState;
  samples: WaveformSample[];         // at the engine sample rate (default 50 Hz)
  breaths: BreathSummary[];          // breaths completed during this step
  manoeuvre?: ManoeuvreResult;
}

/**
 * The engine API. Implemented in src/engine/index.ts. All functions are pure:
 * same input gives the same output (randomness only through an explicit seed).
 */
export interface EngineApi {
  createState(patient: PatientParams, device: DeviceSettings, phys?: Partial<PhysState>, seed?: number): EngineState;
  /** Advance with full waveforms. dtSec is usually 0.1 (real-time UI tick). */
  step(state: EngineState, dtSec: number): StepResult;
  /** Advance quickly without waveforms (time compression). Slow physiology only. */
  fastForward(state: EngineState, simSeconds: number): EngineState;
  setDevice(state: EngineState, device: DeviceSettings): EngineState;
  setPatient(state: EngineState, patch: Partial<PatientParams>): EngineState;
  startManoeuvre(state: EngineState, m: Manoeuvre): EngineState;
  drawAbg(state: EngineState): AbgResult;
  /** Convenience for drills and the physiology lab: run n breaths from steady state. */
  simulateBreaths(patient: PatientParams, device: DeviceSettings, nBreaths: number, phys?: Partial<PhysState>): StepResult;
}

/** Predicted body weight (ARDSNet). Exported here because cases, drills and engine all need it. */
export function predictedBodyWeightKg(sex: 'M' | 'F', heightCm: number): number {
  return (sex === 'M' ? 50 : 45.5) + 0.91 * (heightCm - 152.4);
}
