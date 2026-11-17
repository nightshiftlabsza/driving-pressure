import type { CaseFile } from '../shared/caseSchema';
import type {
  EngineState,
  MonitoredValues,
  BreathSummary,
  ManoeuvreResult,
  AbgResult,
  DeviceSettings,
} from '../shared/engineTypes';
import { predictedBodyWeightKg } from '../shared/engineTypes';
import type { RunState, PlacedOrder } from '../runtime/caseRuntime';
import type { CompetencyState, RunSummary } from '../shared/learnerApi';
import type { StructuredLearnerAttempt, TutorContextKind } from './types';
import { getForbiddenTermsForCompetencies, learnerDescribedAbnormality } from './forbiddenTerms';
import type { LabExperiment } from '../lab/schema';
import type { PracticeItem } from '../practice/types';
import type { ReferenceDivergence } from '../review/reference';

export interface DerivedPhysiologicalIndices {
  pbwKg: number;
  vtPerKgPbwMlPerKg: number | null;
  staticComplianceMlPerCmH2O: number | null;
  dynamicComplianceMlPerCmH2O: number | null;
  drivingPressureCmH2O: number | null;
  peakToPlateauGapCmH2O: number | null;
  airwayResistanceCmH2OPerLps: number | null;
  autoPeepCmH2O: number | null;
  totalPeepCmH2O: number | null;
  pfRatio: number | null;
  alveolarO2MmHg: number | null;
  aaGradientMmHg: number | null;
  wintersExpectedPaco2MmHg: { min: number; max: number; mid: number } | null;
  anionGapMeqL: number | null;
  transpulmonaryInspCmH2O: number | null;
  transpulmonaryExpCmH2O: number | null;
}

export interface ActiveCaseSnapshot {
  caseFile: CaseFile;
  engine: EngineState;
  orders?: PlacedOrder[];
  predictionResults?: RunState['predictionResults'];
  findings?: { examine?: string; cxr?: string };
  abgs?: AbgResult[];
  lastManoeuvre?: ManoeuvreResult | null;
  competencyStates?: CompetencyState[];
  electrolytes?: { naMmolL?: number; clMmolL?: number };
}

export type ActiveCaseSnapshotData = RunState | ActiveCaseSnapshot;

export interface LabTutorSnapshot {
  experiment: LabExperiment;
  stage: 'predict' | 'setup' | 'observe' | 'reflect' | string;
  committed: boolean;
  reflectionSubmitted?: boolean;
  baselineMonitored?: MonitoredValues | Record<string, number | null | undefined>;
  afterMonitored?: MonitoredValues | Record<string, number | null | undefined>;
  selectedVariableValue?: number | string;
  learnerPrediction?: Record<string, string>;
  whyNodesText?: string;
}

export interface PracticeTutorSnapshot {
  item: PracticeItem;
  revealed: boolean;
  learnerAnswer?: unknown;
  currentStepIndex?: number;
  stepRevealed?: boolean;
}

export interface PathwayTutorSnapshot {
  currentStageId: string;
  unlockedStages: string[];
  competencySummary?: Array<{ competency: string; status: string; guidance?: string }>;
  recommendedActivity?: { type: string; id: string; title: string };
}

export type SnapshotData =
  | ActiveCaseSnapshotData
  | LabTutorSnapshot
  | PracticeTutorSnapshot
  | PathwayTutorSnapshot;

export interface BuiltTutorContext {
  contextText: string;
  withheldDiagnosis?: string;
  hiddenCompetencies: string[];
  forbiddenPhrases: string[];
  derivedIndices?: DerivedPhysiologicalIndices;
  verifiedEngineNumbers?: Record<string, number>;
  activeAbnormalities?: string[];
  unaccountedAbnormalities?: string[];
}

function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Deterministic physiological index derivation strictly from src/engine outputs.
 * Never delegates bedside arithmetic to the LLM.
 */
export function computeDerivedIndices(input: {
  engine: EngineState;
  abgs?: AbgResult[];
  lastManoeuvre?: ManoeuvreResult | null;
  pbwKg: number;
  electrolytes?: { naMmolL?: number; clMmolL?: number };
}): DerivedPhysiologicalIndices {
  const { engine, abgs = [], lastManoeuvre, pbwKg, electrolytes } = input;
  const m = engine.monitored;
  const dev = engine.device;
  const lb = engine.lastBreath;
  const latestAbg = abgs.length > 0 ? abgs[abgs.length - 1] : null;

  const pplat =
    lastManoeuvre?.kind === 'insp-hold' && lastManoeuvre.valid
      ? lastManoeuvre.pplatCmH2O ?? null
      : null;

  const autoPeep =
    lastManoeuvre?.kind === 'exp-hold' && lastManoeuvre.valid
      ? lastManoeuvre.autoPeepCmH2O ?? null
      : null;

  const totalPeep =
    lastManoeuvre?.kind === 'exp-hold' && lastManoeuvre.valid && lastManoeuvre.totalPeepCmH2O !== undefined
      ? lastManoeuvre.totalPeepCmH2O
      : m.peepSetCmH2O !== null
      ? m.peepSetCmH2O + (autoPeep ?? 0)
      : null;

  const vte = m.vteMl ?? lb?.vteMl ?? null;
  const vtPerKgPbwMlPerKg = vte !== null && pbwKg > 0 ? roundTo(vte / pbwKg, 1) : null;

  const drivingPressureCmH2O =
    pplat !== null && totalPeep !== null ? roundTo(pplat - totalPeep, 1) : null;

  const staticComplianceMlPerCmH2O =
    vte !== null && drivingPressureCmH2O !== null && drivingPressureCmH2O > 0
      ? roundTo(vte / drivingPressureCmH2O, 1)
      : null;

  const ppeak = m.ppeakCmH2O ?? lb?.ppeakCmH2O ?? null;
  const dynamicComplianceMlPerCmH2O =
    vte !== null && ppeak !== null && totalPeep !== null && ppeak - totalPeep > 0
      ? roundTo(vte / (ppeak - totalPeep), 1)
      : null;

  const peakToPlateauGapCmH2O =
    ppeak !== null && pplat !== null ? roundTo(ppeak - pplat, 1) : null;

  const inspFlowLps =
    dev.device === 'invasive' && typeof dev.inspFlowLpm === 'number' && dev.inspFlowLpm > 0
      ? dev.inspFlowLpm / 60
      : null;

  const airwayResistanceCmH2OPerLps =
    peakToPlateauGapCmH2O !== null && inspFlowLps !== null
      ? roundTo(peakToPlateauGapCmH2O / inspFlowLps, 1)
      : null;

  const pfRatio =
    latestAbg && latestAbg.fio2 > 0
      ? roundTo(latestAbg.pao2MmHg / latestAbg.fio2, 0)
      : null;

  const alveolarO2MmHg =
    latestAbg && latestAbg.fio2 > 0
      ? roundTo(latestAbg.fio2 * (760 - 47) - latestAbg.paco2MmHg / 0.8, 1)
      : null;

  const aaGradientMmHg =
    alveolarO2MmHg !== null && latestAbg
      ? roundTo(alveolarO2MmHg - latestAbg.pao2MmHg, 1)
      : null;

  const wintersExpectedPaco2MmHg =
    latestAbg && latestAbg.hco3MmolL < 22
      ? (() => {
          const mid = roundTo(1.5 * latestAbg.hco3MmolL + 8, 1);
          return { min: roundTo(mid - 2, 1), max: roundTo(mid + 2, 1), mid };
        })()
      : null;

  const anionGapMeqL =
    latestAbg &&
    typeof electrolytes?.naMmolL === 'number' &&
    typeof electrolytes?.clMmolL === 'number'
      ? roundTo(electrolytes.naMmolL - (electrolytes.clMmolL + latestAbg.hco3MmolL), 1)
      : null;

  return {
    pbwKg: roundTo(pbwKg, 1),
    vtPerKgPbwMlPerKg,
    staticComplianceMlPerCmH2O,
    dynamicComplianceMlPerCmH2O,
    drivingPressureCmH2O,
    peakToPlateauGapCmH2O,
    airwayResistanceCmH2OPerLps,
    autoPeepCmH2O: autoPeep !== null ? roundTo(autoPeep, 1) : null,
    totalPeepCmH2O: totalPeep !== null ? roundTo(totalPeep, 1) : null,
    pfRatio,
    alveolarO2MmHg,
    aaGradientMmHg,
    wintersExpectedPaco2MmHg,
    anionGapMeqL,
    transpulmonaryInspCmH2O:
      typeof m.plEndInspCmH2O === 'number' ? roundTo(m.plEndInspCmH2O, 1) : null,
    transpulmonaryExpCmH2O:
      typeof m.plEndExpCmH2O === 'number' ? roundTo(m.plEndExpCmH2O, 1) : null,
  };
}

export function detectActiveAbnormalities(
  engine: EngineState,
  abgs: AbgResult[] = [],
  derived?: DerivedPhysiologicalIndices
): string[] {
  const active: string[] = [];
  const lb = engine.lastBreath;
  const m = engine.monitored;
  const latestAbg = abgs.length > 0 ? abgs[abgs.length - 1] : null;

  if ((derived?.autoPeepCmH2O ?? 0) > 2 || (lb && lb.endExpFlowLps > 0.05)) {
    active.push('auto_peep');
  }
  if (lb?.doubleTriggered) active.push('double_trigger');
  if (lb?.flowStarved) active.push('flow_starvation');
  if (lb?.prematureCycled) active.push('premature_cycling');
  if (lb && lb.ineffectiveEfforts > 0) active.push('ineffective_triggering');
  if ((m.leakLpm ?? lb?.leakLpm ?? 0) > 15) active.push('circuit_leak');
  if ((derived?.drivingPressureCmH2O ?? 0) > 15) active.push('high_driving_pressure');
  if (m.spo2Pct < 88) active.push('severe_hypoxaemia');
  if (m.mapMmHg < 65) active.push('hypotension');
  if (
    latestAbg &&
    derived?.wintersExpectedPaco2MmHg &&
    (latestAbg.paco2MmHg < derived.wintersExpectedPaco2MmHg.min ||
      latestAbg.paco2MmHg > derived.wintersExpectedPaco2MmHg.max)
  ) {
    active.push('mixed_acid_base');
  }

  return Array.from(new Set(active));
}

export function computeUnaccountedAbnormalities(
  activeAbnormalities: string[],
  learnerAttempt?: StructuredLearnerAttempt
): string[] {
  if (!learnerAttempt) return [...activeAbnormalities];
  const learnerText = `${learnerAttempt.observation} ${learnerAttempt.mechanismHypothesis} ${learnerAttempt.predictedConsequence ?? ''}`.toLowerCase();

  return activeAbnormalities.filter(abn => {
    if (learnerDescribedAbnormality(learnerText, abn)) return false;
    if (abn === 'high_driving_pressure' && (learnerText.includes('driving pressure') || learnerText.includes('plateau') || learnerText.includes('stiff'))) {
      return false;
    }
    if (abn === 'severe_hypoxaemia' && (learnerText.includes('hypox') || learnerText.includes('spo2') || learnerText.includes('desat'))) {
      return false;
    }
    if (abn === 'hypotension' && (learnerText.includes('hypotens') || learnerText.includes('map') || learnerText.includes('bp') || learnerText.includes('shock'))) {
      return false;
    }
    if (abn === 'mixed_acid_base' && (learnerText.includes('winter') || learnerText.includes('mixed') || learnerText.includes('alkalosis'))) {
      return false;
    }
    return true;
  });
}

export interface ActiveCaseContextOptions {
  hidePbw?: boolean;
}

export function buildVerifiedEngineNumbers(
  engine: EngineState,
  abgs: AbgResult[],
  lastManoeuvre: ManoeuvreResult | null | undefined,
  derived: DerivedPhysiologicalIndices,
  options?: ActiveCaseContextOptions
): Record<string, number> {
  const nums: Record<string, number> = {};
  const setIfNum = (keys: string[], v: number | null | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      for (const k of keys) nums[k] = v;
    }
  };

  const m = engine.monitored;
  const lb = engine.lastBreath;
  const abg = abgs.length > 0 ? abgs[abgs.length - 1] : null;

  setIfNum(['P_peak', 'ppeak', 'peak_pressure'], m.ppeakCmH2O ?? lb?.ppeakCmH2O);
  setIfNum(['P_mean', 'pmean', 'mean_pressure'], m.pmeanCmH2O ?? lb?.pmeanCmH2O);
  setIfNum(['PEEP', 'peep', 'set_peep'], m.peepSetCmH2O);
  setIfNum(['V_T', 'vte', 'tidal_volume'], m.vteMl ?? lb?.vteMl);
  setIfNum(['minute_ventilation', 'VE'], m.minuteVentLpm);
  setIfNum(['RR', 'rr_total', 'respiratory_rate'], m.rrTotalBpm);
  setIfNum(['SpO2', 'spo2'], m.spo2Pct);
  setIfNum(['MAP', 'map'], m.mapMmHg);
  setIfNum(['SBP', 'sbp'], m.sbpMmHg);
  setIfNum(['DBP', 'dbp'], m.dbpMmHg);
  setIfNum(['HR', 'hr'], m.hrBpm);
  setIfNum(['EtCO2', 'etco2'], m.etco2MmHg);
  setIfNum(['FiO2', 'fio2'], m.fio2);
  setIfNum(['fio2_pct'], Math.round(m.fio2 * 100));

  if (lastManoeuvre?.kind === 'insp-hold' && lastManoeuvre.valid) {
    setIfNum(['P_plat', 'pplat', 'plateau_pressure'], lastManoeuvre.pplatCmH2O);
  }
  if (lastManoeuvre?.kind === 'exp-hold' && lastManoeuvre.valid) {
    setIfNum(['PEEP_tot', 'total_peep'], lastManoeuvre.totalPeepCmH2O);
    setIfNum(['PEEP_i', 'auto_peep', 'intrinsic_peep'], lastManoeuvre.autoPeepCmH2O);
  }

  if (abg) {
    setIfNum(['pH', 'ph'], abg.ph);
    setIfNum(['PaCO2', 'paco2'], abg.paco2MmHg);
    setIfNum(['PaO2', 'pao2'], abg.pao2MmHg);
    setIfNum(['HCO3', 'hco3'], abg.hco3MmolL);
    setIfNum(['Lactate', 'lactate'], abg.lactateMmolL);
    setIfNum(['SaO2', 'sao2'], abg.sao2Pct);
  }

  if (!options?.hidePbw) {
    setIfNum(['PBW', 'pbw'], derived.pbwKg);
    setIfNum(['Vt_per_kg_PBW'], derived.vtPerKgPbwMlPerKg);
  }
  setIfNum(['C_stat', 'static_compliance'], derived.staticComplianceMlPerCmH2O);
  setIfNum(['C_dyn', 'dynamic_compliance'], derived.dynamicComplianceMlPerCmH2O);
  setIfNum(['Delta_P', 'driving_pressure'], derived.drivingPressureCmH2O);
  setIfNum(['P_peak_minus_P_plat', 'peak_plateau_gap'], derived.peakToPlateauGapCmH2O);
  setIfNum(['R_aw', 'airway_resistance'], derived.airwayResistanceCmH2OPerLps);
  setIfNum(['PEEP_i', 'auto_peep', 'intrinsic_peep'], derived.autoPeepCmH2O);
  setIfNum(['PEEP_tot', 'total_peep'], derived.totalPeepCmH2O);
  setIfNum(['PF_ratio', 'pf_ratio'], derived.pfRatio);
  setIfNum(['PAO2', 'alveolar_o2'], derived.alveolarO2MmHg);
  setIfNum(['Aa_gradient', 'aa_gradient'], derived.aaGradientMmHg);
  setIfNum(['Winters_PaCO2', 'winters_paco2'], derived.wintersExpectedPaco2MmHg?.mid);
  setIfNum(['AG', 'anion_gap'], derived.anionGapMeqL);
  setIfNum(['P_L_insp', 'pl_insp'], derived.transpulmonaryInspCmH2O);
  setIfNum(['P_L_exp', 'pl_exp'], derived.transpulmonaryExpCmH2O);

  return nums;
}

function formatDeviceSettings(dev: DeviceSettings): string {
  switch (dev.device) {
    case 'invasive': {
      const parts: string[] = [
        `Device: Invasive Mechanical Ventilator`,
        `Mode: ${dev.mode}`,
        `PEEP: ${dev.peep} cmH2O`,
        `Set RR: ${dev.rrSetBpm} bpm`,
        `FiO2: ${Math.round(dev.fio2 * 100)}% (${dev.fio2})`,
      ];
      if (dev.vtSetMl !== undefined) parts.push(`Set Vt: ${dev.vtSetMl} mL`);
      if (dev.inspFlowLpm !== undefined) parts.push(`Insp Flow: ${dev.inspFlowLpm} L/min`);
      if (dev.flowPattern !== undefined) parts.push(`Flow Pattern: ${dev.flowPattern}`);
      if (dev.pinspAbovePeep !== undefined) parts.push(`Pinsp above PEEP: ${dev.pinspAbovePeep} cmH2O`);
      if (dev.tiSec !== undefined) parts.push(`Ti: ${dev.tiSec} s`);
      if (dev.psAbovePeep !== undefined) parts.push(`PS: ${dev.psAbovePeep} cmH2O`);
      if (dev.triggerFlowLpm !== undefined) parts.push(`Trigger: ${dev.triggerFlowLpm} L/min`);
      if (dev.cyclePctPeakFlow !== undefined) parts.push(`Cycle: ${dev.cyclePctPeakFlow}%`);
      if (dev.riseTimeSec !== undefined) parts.push(`Rise Time: ${dev.riseTimeSec} s`);
      return parts.join('\n- ');
    }
    case 'niv': {
      const parts: string[] = [
        `Device: Non-Invasive Ventilation (NIV)`,
        `Mode: ${dev.mode}`,
        `EPAP: ${dev.epap} cmH2O`,
        `FiO2: ${Math.round(dev.fio2 * 100)}% (${dev.fio2})`,
        `Interface: ${dev.interface}`,
        `Mask Fit: ${dev.maskFit}`,
      ];
      if (dev.ipap !== undefined) parts.push(`IPAP: ${dev.ipap} cmH2O`);
      if (dev.backupRrBpm !== undefined) parts.push(`Backup RR: ${dev.backupRrBpm} bpm`);
      if (dev.tiSec !== undefined) parts.push(`Ti: ${dev.tiSec} s`);
      return parts.join('\n- ');
    }
    case 'hfnc': {
      return [
        `Device: High-Flow Nasal Cannula (HFNC)`,
        `Flow: ${dev.flowLpm} L/min`,
        `FiO2: ${Math.round(dev.fio2 * 100)}% (${dev.fio2})`,
        `Temp: ${dev.temperatureC} °C`,
      ].join('\n- ');
    }
    case 'none': {
      return [
        `Device: None (Supplemental O2)`,
        `Delivery: ${dev.o2}`,
        `Flow: ${dev.o2FlowLpm} L/min`,
      ].join('\n- ');
    }
  }
}

function formatMonitoredValues(m: MonitoredValues): string {
  const lines: string[] = [];

  const ppeakStr = m.ppeakCmH2O !== null ? `${m.ppeakCmH2O} cmH2O` : 'N/A';
  const pmeanStr = m.pmeanCmH2O !== null ? `${m.pmeanCmH2O} cmH2O` : 'N/A';
  const peepStr = m.peepSetCmH2O !== null ? `${m.peepSetCmH2O} cmH2O` : 'N/A';
  lines.push(`- Pressures: Peak ${ppeakStr}, Mean ${pmeanStr}, PEEP ${peepStr}`);

  const vteStr = m.vteMl !== null ? `${m.vteMl} mL` : 'N/A';
  const mvStr = m.minuteVentLpm !== null ? `${m.minuteVentLpm} L/min` : 'N/A';
  const rrTotStr = `${m.rrTotalBpm} /min`;
  const rrSpontStr = `${m.rrSpontBpm} /min`;
  lines.push(`- Ventilation: VTe ${vteStr}, Minute Ventilation ${mvStr}, RR Total ${rrTotStr} (Spontaneous: ${rrSpontStr})`);

  const fio2Str = `${Math.round(m.fio2 * 100)}% (${m.fio2})`;
  const leakStr = m.leakLpm !== null ? `${m.leakLpm} L/min` : '0 L/min';
  lines.push(`- Gas Delivery: FiO2 ${fio2Str}, Leak ${leakStr}`);

  lines.push(`- Hemodynamics: HR ${m.hrBpm} bpm, BP ${m.sbpMmHg}/${m.dbpMmHg} mmHg (MAP ${m.mapMmHg} mmHg)`);

  const etco2Str = m.etco2MmHg !== null ? `${m.etco2MmHg} mmHg` : 'N/A';
  lines.push(`- Gas Exchange: SpO2 ${m.spo2Pct}%, EtCO2 ${etco2Str}, Temp ${m.temperatureC} °C`);

  return lines.join('\n');
}

function formatBreathSummary(lb: BreathSummary | null): string {
  if (!lb) return 'No breath cycle completed yet.';
  const parts: string[] = [
    `- Breath Type: ${lb.breathType}`,
    `- Tidal Volumes: Insp ${lb.vtiMl} mL, Exp ${lb.vteMl} mL`,
    `- Pressures: Peak ${lb.ppeakCmH2O} cmH2O, Mean ${lb.pmeanCmH2O} cmH2O`,
    `- Timing: Ti ${lb.tiSec.toFixed(2)} s, Te ${lb.teSec.toFixed(2)} s`,
    `- End-Expiratory Flow: ${lb.endExpFlowLps.toFixed(2)} L/s`,
    `- Leak: ${lb.leakLpm} L/min, Ineffective Efforts: ${lb.ineffectiveEfforts}`,
  ];
  if (lb.triggerDelayMs !== undefined) {
    parts.push(`- Trigger Delay: ${lb.triggerDelayMs} ms`);
  }
  return parts.join('\n');
}

function formatManoeuvre(m: ManoeuvreResult | null | undefined): string {
  if (!m) return 'None performed.';
  if (m.kind === 'insp-hold') {
    return `- Inspiratory Hold: Pplat ${m.pplatCmH2O !== undefined ? `${m.pplatCmH2O} cmH2O` : 'N/A'}, Valid: ${m.valid ? 'Yes' : 'No (effort artifact)'}`;
  }
  if (m.kind === 'exp-hold') {
    return `- Expiratory Hold: Total PEEP ${m.totalPeepCmH2O !== undefined ? `${m.totalPeepCmH2O} cmH2O` : 'N/A'}, Auto-PEEP ${m.autoPeepCmH2O !== undefined ? `${m.autoPeepCmH2O} cmH2O` : 'N/A'}, Valid: ${m.valid ? 'Yes' : 'No (effort artifact)'}`;
  }
  return 'None performed.';
}

function formatLatestAbg(abgs: AbgResult[]): string {
  if (!abgs || abgs.length === 0) return 'No ABG ordered/drawn yet.';
  const abg = abgs[abgs.length - 1];
  return (
    `- Sampled at Sim Time: ${abg.sampledAtSimSec}s\n` +
    `- pH: ${abg.ph.toFixed(2)}, PaCO2: ${abg.paco2MmHg} mmHg, PaO2: ${abg.pao2MmHg} mmHg\n` +
    `- HCO3: ${abg.hco3MmolL.toFixed(1)} mmol/L, Base Excess: ${abg.baseExcessMmolL.toFixed(1)} mmol/L\n` +
    `- SaO2: ${abg.sao2Pct}%, Lactate: ${abg.lactateMmolL.toFixed(1)} mmol/L, FiO2: ${Math.round(abg.fio2 * 100)}%`
  );
}

function formatOrders(orders: PlacedOrder[]): string {
  const recent = orders.slice(-10);
  if (recent.length === 0) return 'No orders placed yet.';
  return recent
    .map(o => `- [${o.simTimeSec}s] ${o.order}${o.detail ? ` (${JSON.stringify(o.detail)})` : ''}`)
    .join('\n');
}

function formatPredictions(
  results: RunState['predictionResults'] | undefined,
  caseFile: CaseFile
): string {
  if (!results || results.length === 0) return 'No predictions answered yet.';
  const recent = results.slice(-10);
  return recent
    .map(r => {
      const qText =
        caseFile.predictionPoints?.find(p => p.id === r.predictionId)?.question ??
        r.predictionId;
      return `- Q: "${qText}" | Learner Answer: ${JSON.stringify(r.answer)} | Result: ${r.correct ? 'Correct' : 'Incorrect'} (Confidence: ${r.confidence})`;
    })
    .join('\n');
}

function formatFindings(findings: { examine?: string; cxr?: string } | undefined): string | null {
  if (!findings) return null;
  const parts: string[] = [];
  if (findings.examine) {
    parts.push(`- Physical Examination: ${findings.examine}`);
  }
  if (findings.cxr) {
    parts.push(`- Chest X-ray (CXR): ${findings.cxr}`);
  }
  if (parts.length === 0) return null;
  return parts.join('\n');
}

/**
 * Builds the tutor context for an active case using real data types and shapes.
 */
export function buildActiveCaseContext(
  input: ActiveCaseSnapshotData & { hidePbw?: boolean },
  learnerAttemptOrOptions?: StructuredLearnerAttempt | ActiveCaseContextOptions,
  maybeOptions?: ActiveCaseContextOptions
): BuiltTutorContext {
  const learnerAttempt =
    learnerAttemptOrOptions && ('observation' in learnerAttemptOrOptions || 'mechanismHypothesis' in learnerAttemptOrOptions)
      ? (learnerAttemptOrOptions as StructuredLearnerAttempt)
      : undefined;
  const options =
    maybeOptions ??
    (learnerAttemptOrOptions && !('observation' in learnerAttemptOrOptions) && !('mechanismHypothesis' in learnerAttemptOrOptions)
      ? (learnerAttemptOrOptions as ActiveCaseContextOptions)
      : undefined);
  const hidePbw = Boolean(options?.hidePbw ?? input.hidePbw);

  const caseFile = input.caseFile;
  const engine = input.engine;
  const orders = input.orders ?? [];
  const predictionResults = input.predictionResults ?? [];
  const findings = input.findings;
  const abgs = input.abgs ?? [];
  const lastManoeuvre = input.lastManoeuvre;
  const competencyStates = 'competencyStates' in input ? input.competencyStates : undefined;

  const hiddenCompetencyNames: string[] = caseFile.hiddenCompetencies || [];
  const forbiddenPhrases: string[] = getForbiddenTermsForCompetencies(hiddenCompetencyNames);

  const sections: string[] = [];

  // Patient Information
  const pat = caseFile.patient;
  const params = pat.params;
  const pbw = predictedBodyWeightKg(params.sex, params.heightCm);
  const derivedIndices = computeDerivedIndices({
    engine,
    abgs,
    lastManoeuvre,
    pbwKg: pbw,
    electrolytes: 'electrolytes' in input ? input.electrolytes : undefined,
  });
  const verifiedEngineNumbers = buildVerifiedEngineNumbers(engine, abgs, lastManoeuvre, derivedIndices, { hidePbw });
  const activeAbnormalities = detectActiveAbnormalities(engine, abgs, derivedIndices);
  const unaccountedAbnormalities = computeUnaccountedAbnormalities(activeAbnormalities, learnerAttempt);

  const pbwDemographic = hidePbw ? '' : ` (PBW: ${pbw.toFixed(1)} kg)`;
  sections.push(
    `### Patient Information\n` +
      `- Identity: ${pat.displayName}\n` +
      `- Demographics: ${params.ageYears}yo ${params.sex}, Height: ${params.heightCm} cm, Weight: ${params.actualWeightKg} kg${pbwDemographic}\n` +
      `- Presenting Story: ${pat.presentingStory}\n` +
      `- Medical History: ${pat.history}\n` +
      `- Diagnosis / Underlying Condition: [hidden during active case: probe active]`
  );

  // Device & Settings
  sections.push(
    `### Current Ventilator Settings\n` +
      `- ${formatDeviceSettings(engine.device)}`
  );

  // Monitored Data
  sections.push(
    `### Bedside Monitored Data (Sim Time: ${engine.monitored.simTimeSec}s)\n` +
      formatMonitoredValues(engine.monitored)
  );

  // Last Breath Summary
  sections.push(
    `### Last Completed Breath Summary\n` +
      formatBreathSummary(engine.lastBreath)
  );

  // Respiratory Manoeuvre
  sections.push(
    `### Recent Respiratory Manoeuvre\n` +
      formatManoeuvre(lastManoeuvre)
  );

  // Latest ABG
  sections.push(
    `### Arterial Blood Gas (ABG)\n` +
      formatLatestAbg(abgs)
  );

  // Ordered Findings (only if ordered)
  const formattedFindings = formatFindings(findings);
  if (formattedFindings) {
    sections.push(
      `### Ordered Diagnostic Findings\n` +
        formattedFindings
    );
  }

  // Recent Orders (last 10)
  sections.push(
    `### Recent Orders (last 10)\n` +
      formatOrders(orders)
  );

  // Recent Predictions (last 10)
  sections.push(
    `### Recent Predictions (last 10)\n` +
      formatPredictions(predictionResults, caseFile)
  );

  // Competency summary from learner model (excluding hidden competencies)
  if (competencyStates && competencyStates.length > 0) {
    const compSummary = competencyStates
      .filter(c => !hiddenCompetencyNames.includes(c.competency))
      .slice(0, 10)
      .map(
        c =>
          `- ${c.competency}: status=${c.status}, guidance=${c.guidance}, topMistakes=[${c.topMistakes.map(m => m.mistake).join(', ')}]`
      );
    if (compSummary.length > 0) {
      sections.push(`### Learner Model Profile\n` + compSummary.join('\n'));
    }
  }

  // Pre-computed Physiological Indices (Engine Ground Truth - do not recalculate)
  const idxLines: string[] = [];
  if (!hidePbw) {
    idxLines.push(`- PBW: ${derivedIndices.pbwKg} kg`);
    if (derivedIndices.vtPerKgPbwMlPerKg !== null) {
      idxLines.push(`- Vt/PBW: ${derivedIndices.vtPerKgPbwMlPerKg} mL/kg`);
    }
  }
  if (derivedIndices.staticComplianceMlPerCmH2O !== null) {
    idxLines.push(`- Static Compliance (C_stat): ${derivedIndices.staticComplianceMlPerCmH2O} mL/cmH2O`);
  }
  if (derivedIndices.dynamicComplianceMlPerCmH2O !== null) {
    idxLines.push(`- Dynamic Compliance (C_dyn): ${derivedIndices.dynamicComplianceMlPerCmH2O} mL/cmH2O`);
  }
  if (derivedIndices.drivingPressureCmH2O !== null) {
    idxLines.push(`- Driving Pressure (Delta_P): ${derivedIndices.drivingPressureCmH2O} cmH2O`);
  }
  if (derivedIndices.peakToPlateauGapCmH2O !== null) {
    idxLines.push(`- Peak-to-Plateau Gap: ${derivedIndices.peakToPlateauGapCmH2O} cmH2O`);
  }
  if (derivedIndices.airwayResistanceCmH2OPerLps !== null) {
    idxLines.push(`- Airway Resistance (R_aw): ${derivedIndices.airwayResistanceCmH2OPerLps} cmH2O/L/s`);
  }
  if (derivedIndices.totalPeepCmH2O !== null) {
    idxLines.push(`- Total PEEP: ${derivedIndices.totalPeepCmH2O} cmH2O`);
  }
  if (derivedIndices.autoPeepCmH2O !== null && !hiddenCompetencyNames.some(c => c.includes('auto-peep'))) {
    idxLines.push(`- Auto-PEEP (PEEP_i): ${derivedIndices.autoPeepCmH2O} cmH2O`);
  }
  if (derivedIndices.pfRatio !== null) {
    idxLines.push(`- PaO2/FiO2 Ratio: ${derivedIndices.pfRatio} mmHg`);
  }
  if (derivedIndices.alveolarO2MmHg !== null) {
    idxLines.push(`- Alveolar O2 (PAO2): ${derivedIndices.alveolarO2MmHg} mmHg`);
  }
  if (derivedIndices.aaGradientMmHg !== null) {
    idxLines.push(`- A-a Gradient: ${derivedIndices.aaGradientMmHg} mmHg`);
  }
  if (derivedIndices.wintersExpectedPaco2MmHg !== null) {
    idxLines.push(
      `- Winter's Expected PaCO2: ${derivedIndices.wintersExpectedPaco2MmHg.mid} mmHg (range ${derivedIndices.wintersExpectedPaco2MmHg.min}-${derivedIndices.wintersExpectedPaco2MmHg.max})`
    );
  }
  if (derivedIndices.anionGapMeqL !== null) {
    idxLines.push(`- Anion Gap: ${derivedIndices.anionGapMeqL} mEq/L`);
  }
  if (derivedIndices.transpulmonaryInspCmH2O !== null) {
    idxLines.push(`- End-Inspiratory Transpulmonary Pressure (P_L,insp): ${derivedIndices.transpulmonaryInspCmH2O} cmH2O`);
  }
  if (derivedIndices.transpulmonaryExpCmH2O !== null) {
    idxLines.push(`- End-Expiratory Transpulmonary Pressure (P_L,exp): ${derivedIndices.transpulmonaryExpCmH2O} cmH2O`);
  }
  sections.push(`### Pre-Computed Physiological Indices (Engine Ground Truth)\n` + idxLines.join('\n'));

  if (unaccountedAbnormalities.length > 0) {
    const safeLabels = unaccountedAbnormalities.map(abn => {
      if (abn === 'auto_peep') return 'end-expiratory flow not returning to zero baseline';
      if (abn === 'double_trigger') return 'double triggering / breath stacking (inspiratory flow mismatch / short Ti triggering secondary breath)';
      return abn.replace(/_/g, ' ');
    });
    sections.push(
      `### Unaccounted Abnormalities (Highlight via Level 0/1 Contrast)\n` +
        safeLabels.map(l => `- ${l}`).join('\n')
    );
  }

  return {
    contextText: sections.join('\n\n'),
    withheldDiagnosis: undefined,
    hiddenCompetencies: hiddenCompetencyNames,
    forbiddenPhrases,
    derivedIndices,
    verifiedEngineNumbers,
    activeAbnormalities,
    unaccountedAbnormalities,
  };
}

/**
 * Builds the rich debrief context from RunSummary and CaseFile.
 */
export function buildDebriefContext(
  run: RunSummary,
  caseFile: CaseFile,
  options?: { referenceDivergence?: ReferenceDivergence | null }
): BuiltTutorContext {
  const sections: string[] = [];

  // Case Overview & Patient
  sections.push(
    `### Case Debrief: ${caseFile.title}\n` +
      `- Patient: ${caseFile.patient.displayName} (${caseFile.patient.params.ageYears}yo ${caseFile.patient.params.sex})\n` +
      `- Summary / Diagnosis: ${caseFile.summary}\n` +
      `- Presenting Story: ${caseFile.patient.presentingStory}\n` +
      `- Clinical History: ${caseFile.patient.history}\n` +
      `- Final Run Outcome: ${run.outcome ?? 'completed'}\n` +
      `- Overall Score: ${run.score ?? 0} / ${run.maxScore ?? 0}`
  );

  // Key Debrief Teaching Points
  if (caseFile.debrief?.keyPoints && caseFile.debrief.keyPoints.length > 0) {
    sections.push(
      `### Key Clinical Learning Points\n` +
        caseFile.debrief.keyPoints.map(kp => `- ${kp}`).join('\n')
    );
  }

  // Predictions Made
  if (run.predictions && run.predictions.length > 0) {
    sections.push(
      `### Predictions & Physiological Reasoning\n` +
        run.predictions
          .map(
            p =>
              `- Q: "${p.question}" | Learner: ${JSON.stringify(p.answer)} | Expected: ${JSON.stringify(p.expected)} | Result: ${p.correct ? 'Correct' : 'Incorrect'}${p.confidence ? ` (Confidence: ${p.confidence})` : ''} [Competency: ${p.competency}]`
          )
          .join('\n')
    );
  }

  // Rubric Performance
  if (run.rubric && run.rubric.length > 0) {
    sections.push(
      `### Clinical Decision Rubric Results\n` +
        run.rubric
          .map(r => {
            const item = caseFile.rubric?.find(cr => cr.id === r.rubricId);
            const desc = item?.description ?? r.rubricId;
            return `- [${r.met ? 'MET' : 'UNMET'}] ${desc}${r.critical ? ' (CRITICAL)' : ''} [Competency: ${r.competency}]`;
          })
          .join('\n')
    );
  }

  // Mistakes Logged
  if (run.mistakes && run.mistakes.length > 0) {
    sections.push(
      `### Logged Clinical Mistakes\n` +
        run.mistakes
          .map(m => `- [${m.severity.toUpperCase()}] ${m.mistake}: ${m.detail} [Competency: ${m.competency}]`)
          .join('\n')
    );
  }

  // Orders Timeline
  if (run.ordersTimeline && run.ordersTimeline.length > 0) {
    sections.push(
      `### Orders Timeline\n` +
        run.ordersTimeline
          .map(o => `- [+${Math.floor(o.simTimeSec / 60)}m ${o.simTimeSec % 60}s] ${o.order}`)
          .join('\n')
    );
  }

  // Attending Reference Divergence Timestamp (Item 8)
  if (options?.referenceDivergence) {
    const d = options.referenceDivergence;
    const mins = Math.floor(d.simTimeSec / 60);
    const secs = d.simTimeSec % 60;
    sections.push(
      `### Attending Reference Divergence Timestamp\n` +
        `- First notable divergence occurred at +${mins}m ${secs}s on ${d.label}: ` +
        `learner ${d.learnerValue}${d.unit ? ` ${d.unit}` : ''} vs attending reference ${d.referenceValue}${d.unit ? ` ${d.unit}` : ''}` +
        (d.referenceDecisionNote ? ` (${d.referenceDecisionNote})` : '')
    );
  }

  // References & Guidelines
  if (caseFile.debrief?.resources && caseFile.debrief.resources.length > 0) {
    sections.push(
      `### References & Guidelines\n` +
        caseFile.debrief.resources
          .map(res => `- ${res.title} (${res.ref})${res.url ? ` - ${res.url}` : ''}`)
          .join('\n')
    );
  }

  return {
    contextText: sections.join('\n\n'),
    withheldDiagnosis: undefined,
    hiddenCompetencies: [],
    forbiddenPhrases: [],
  };
}

/**
 * Builds tutor context for an interactive Physiology Lab experiment.
 * When committed === false, the causal "Why" trace and reflection answers
 * are strictly withheld from the AI tutor and added to forbiddenPhrases.
 */
export function buildLabContext(input: LabTutorSnapshot): BuiltTutorContext {
  const exp = input.experiment;
  const sections: string[] = [];
  const forbiddenPhrases: string[] = [];

  sections.push(
    `### Physiology Lab Experiment: ${exp.title}\n` +
      `- Subtitle: ${exp.subtitle}\n` +
      `- Domain: ${exp.competencies.join(', ')}\n` +
      `- Patient: ${exp.patient.displayName} - ${exp.patient.summary}\n` +
      `- Current Stage: ${input.stage.toUpperCase()}`
  );

  sections.push(
    `### Intervention\n` +
      `- Variable: ${exp.variable.label} (${exp.variable.field})\n` +
      `- Baseline: ${exp.variable.baselineValue} ${exp.variable.unit}\n` +
      `- Applied: ${input.selectedVariableValue ?? exp.variable.options[0]?.value} ${exp.variable.unit}`
  );

  if (input.baselineMonitored) {
    const baseStr = Object.entries(input.baselineMonitored)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    sections.push(`### Baseline Monitored Values\n${baseStr}`);
  }

  const reflectionUnlocked = input.reflectionSubmitted ?? input.committed;

  if (!input.committed) {
    // Locked state: DO NOT leak prediction directions, post-intervention values, Why trace, or reflection answer
    sections.push(
      `### Prediction Task (UNCOMMITTED - DO NOT REVEAL)\n` +
        `- Question: "${exp.prediction.question}"\n` +
        `- Focus metrics: ${exp.prediction.metrics.join(', ')}\n` +
        `- Status: Learner has not committed yet. Socratic questioning only.`
    );
    // Add reflection answers & explanation to forbidden phrases
    forbiddenPhrases.push(exp.reflection.explanation);
    const correctOpt = exp.reflection.options.find(o => o.id === exp.reflection.correctOptionId);
    if (correctOpt) {
      forbiddenPhrases.push(correctOpt.text);
    }
  } else {
    // Committed prediction: learner can see post-intervention values & Why trace!
    if (input.afterMonitored) {
      const afterStr = Object.entries(input.afterMonitored)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      sections.push(`### Post-Intervention Monitored Values\n${afterStr}`);
    }
    if (input.learnerPrediction) {
      const predStr = Object.entries(input.learnerPrediction)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      sections.push(`### Learner Prediction\n${predStr}`);
    }
    if (input.whyNodesText) {
      sections.push(`### Causal Why Trace\n${input.whyNodesText}`);
    } else {
      sections.push(
        `### Causal Physiological Trace\n` +
          `Causal Chain: ${exp.causalChainFields.join(' -> ')}`
      );
    }

    if (!reflectionUnlocked) {
      // Reflection MCQ is still uncommitted: keep correct option and explanation locked!
      sections.push(
        `### Reflection Question (UNCOMMITTED - DO NOT REVEAL)\n` +
          `- Question: "${exp.reflection.question}"\n` +
          `- Status: Learner has not submitted reflection yet. Discuss observed mechanics without naming the reflection answer.`
      );
      forbiddenPhrases.push(exp.reflection.explanation);
      const correctOpt = exp.reflection.options.find(o => o.id === exp.reflection.correctOptionId);
      if (correctOpt) {
        forbiddenPhrases.push(correctOpt.text);
      }
    } else {
      sections.push(`### Reflection Mechanism\n${exp.reflection.explanation}`);
    }
  }

  return {
    contextText: sections.join('\n\n'),
    withheldDiagnosis: undefined,
    hiddenCompetencies: [],
    forbiddenPhrases,
  };
}

/**
 * Builds tutor context for deliberate practice items (predict-then-reveal, flashcard, case-drill).
 * When revealed === false, correct answers and back faces are withheld from context
 * and added to forbiddenPhrases.
 */
export function buildPracticeContext(input: PracticeTutorSnapshot): BuiltTutorContext {
  const item = input.item;
  const sections: string[] = [];
  const forbiddenPhrases: string[] = [];

  const isRevealed = item.kind === 'case-drill'
    ? (input.stepRevealed ?? input.revealed)
    : input.revealed;

  sections.push(
    `### Deliberate Practice: ${item.kind.toUpperCase()}\n` +
      `- Competency: ${item.competencyId}\n` +
      `- Difficulty: Level ${item.difficulty}\n` +
      `- Status: ${isRevealed ? 'REVEALED / ANSWERED' : 'UNCOMMITTED / HIDDEN'}`
  );

  switch (item.kind) {
    case 'predict-then-reveal': {
      sections.push(`### Scenario\n${item.scenario}`);
      sections.push(`### Question\n${item.question}`);
      if (item.options && item.options.length > 0) {
        sections.push(`### Options\n${item.options.map(o => `- ${o}`).join('\n')}`);
      }
      if (!isRevealed) {
        sections.push(`### State\nLearner has not committed. Do NOT reveal the correct answer or explanation.`);
        forbiddenPhrases.push(item.correctAnswer);
        forbiddenPhrases.push(item.explanation);
      } else {
        if (input.learnerAnswer !== undefined) {
          sections.push(`### Learner Answer\n${JSON.stringify(input.learnerAnswer)}`);
        }
        sections.push(
          `### Solution & Physiological Explanation\n` +
            `- Correct Answer: ${item.correctAnswer}\n` +
            `- Explanation: ${item.explanation}`
        );
      }
      break;
    }
    case 'flashcard': {
      sections.push(`### Prompt / Front\n${item.front}`);
      if (item.subheading) {
        sections.push(`### Subheading\n${item.subheading}`);
      }
      if (!isRevealed) {
        sections.push(`### State\nBack is hidden. Socratic prompts only; do not reveal the answer directly.`);
        forbiddenPhrases.push(item.back);
      } else {
        sections.push(`### Answer / Back\n${item.back}`);
      }
      break;
    }
    case 'case-drill': {
      sections.push(`### Vignette\n${item.vignette}`);
      const stepIdx = Math.max(0, Math.min(input.currentStepIndex ?? 0, Math.max(0, item.steps.length - 1)));
      // Include prior completed steps if advancing past step 0
      if (stepIdx > 0) {
        const priorLines = item.steps.slice(0, stepIdx).map(
          s =>
            `Step ${s.stepNumber}: ${s.prompt}\n` +
            s.options.map(o => `  - [${o.isCorrect ? 'CORRECT' : 'INCORRECT'}] ${o.text} (${o.feedback})`).join('\n')
        );
        sections.push(`### Completed Prior Steps\n${priorLines.join('\n\n')}`);
      }
      const step = item.steps[stepIdx];
      if (step) {
        if (!isRevealed) {
          sections.push(`### Current Step ${step.stepNumber} Prompt\n${step.prompt}`);
          sections.push(`### Options\n${step.options.map(o => `- ${o.text}`).join('\n')}`);
          sections.push(`### State\nLearner has not committed to this step. Do NOT reveal which option is correct.`);
          for (const opt of step.options) {
            if (opt.isCorrect) {
              forbiddenPhrases.push(opt.text);
              forbiddenPhrases.push(opt.feedback);
            }
          }
        } else {
          sections.push(
            `### Step ${step.stepNumber} Solution\n${step.prompt}\n` +
              step.options.map(o => `  - [${o.isCorrect ? 'CORRECT' : 'INCORRECT'}] ${o.text} (${o.feedback})`).join('\n')
          );
        }
      }
      // Always lock future unreached steps from leakage
      for (const futureStep of item.steps.slice(stepIdx + 1)) {
        for (const opt of futureStep.options) {
          if (opt.isCorrect) {
            forbiddenPhrases.push(opt.text);
            forbiddenPhrases.push(opt.feedback);
          }
        }
      }
      break;
    }
  }

  return {
    contextText: sections.join('\n\n'),
    withheldDiagnosis: undefined,
    hiddenCompetencies: [],
    forbiddenPhrases,
  };
}

/**
 * Builds tutor context for the learning pathway view.
 */
export function buildPathwayContext(input: PathwayTutorSnapshot): BuiltTutorContext {
  const sections: string[] = [];

  sections.push(
    `### Learning Pathway Overview\n` +
      `- Current Stage: ${input.currentStageId}\n` +
      `- Unlocked Stages: ${input.unlockedStages.join(', ')}`
  );

  if (input.recommendedActivity) {
    sections.push(
      `### Next Recommended Milestone\n` +
        `- Type: ${input.recommendedActivity.type}\n` +
        `- Title: ${input.recommendedActivity.title} (${input.recommendedActivity.id})`
    );
  }

  if (input.competencySummary && input.competencySummary.length > 0) {
    sections.push(
      `### Competency Mastery Summary\n` +
        input.competencySummary
          .slice(0, 12)
          .map(c => `- ${c.competency}: ${c.status}${c.guidance ? ` (Guidance: ${c.guidance})` : ''}`)
          .join('\n')
    );
  }

  return {
    contextText: sections.join('\n\n'),
    withheldDiagnosis: undefined,
    hiddenCompetencies: [],
    forbiddenPhrases: [],
  };
}

/**
 * Main context builder function that dispatches based on contextKind.
 */
export function buildTutorContext(
  snapshot: SnapshotData | { runSummary: RunSummary; caseFile: CaseFile },
  contextKind: TutorContextKind,
  options?: ActiveCaseContextOptions
): BuiltTutorContext {
  if (contextKind === 'lab') {
    return buildLabContext(snapshot as LabTutorSnapshot);
  }

  if (contextKind === 'practice') {
    return buildPracticeContext(snapshot as PracticeTutorSnapshot);
  }

  if (contextKind === 'pathway') {
    return buildPathwayContext(snapshot as PathwayTutorSnapshot);
  }

  if (contextKind === 'debrief') {
    if ('runSummary' in snapshot && 'caseFile' in snapshot) {
      return buildDebriefContext(snapshot.runSummary, snapshot.caseFile);
    }
    const caseFile = (snapshot as { caseFile: CaseFile }).caseFile;
    const mockSummary: RunSummary = {
      runId: 'run-debrief',
      activity: 'case',
      activityId: caseFile.id,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      outcome: 'completed',
      score: 10,
      maxScore: 10,
      predictions: [],
      rubric: [],
      mistakes: [],
      ordersTimeline: ((snapshot as ActiveCaseSnapshot).orders ?? []).map(o => ({
        simTimeSec: o.simTimeSec,
        order: o.order,
      })),
    };
    return buildDebriefContext(mockSummary, caseFile);
  }

  return buildActiveCaseContext(snapshot as ActiveCaseSnapshotData, undefined, options);
}
