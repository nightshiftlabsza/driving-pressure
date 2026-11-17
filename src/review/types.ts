/**
 * Review, replay, exposure ledger and process classification types.
 * Strictly adheres to terminology in docs/overnight/02-product-architecture.md.
 */
import type { DeviceSettings, EngineApi } from '../shared/engineTypes';
import type { CaseFile, OrderType } from '../shared/caseSchema';
import type { Confidence, LearnerEvent } from '../shared/events';
import type { RunState } from '../runtime/caseRuntime';

export type ProcessClass =
  | 'sound'
  | 'sound-unlucky'
  | 'reasonable-uncertain'
  | 'delayed'
  | 'wrong-target'
  | 'unsafe'
  | 'unclassified';

export type DecisionKind = 'order' | 'settings_change' | 'hold' | 'observe';

export interface DecisionInput {
  id?: string;
  simTimeSec: number;
  kind: DecisionKind;
  order?: OrderType;
  detail?: Record<string, unknown>;
  settings?: DeviceSettings;
  holdKind?: 'insp-hold' | 'exp-hold';
  rationale?: string;
  assessment?: string;
  confidence?: Confidence;
}

export interface MetricPoint {
  simTimeSec: number;
  spo2: number | null;
  paco2: number | null;
  pao2: number | null;
  ph: number | null;
  pplat: number | null;
  drivingPressure: number | null;
  ppeak: number | null;
  peep: number | null;
  vte: number | null;
  vteMlKgPbw: number | null;
  fio2: number | null;
  map: number | null;
  hr: number | null;
  rrTotal: number | null;
  pfRatio: number | null;
}

export interface ReplayDecisionPoint {
  index: number;
  decision: DecisionInput;
  simTimeSec: number;
  stateBefore: RunState;
  stateAfter: RunState;
}

export interface ReplayResult {
  caseId: string;
  metrics: MetricPoint[];
  decisions: ReplayDecisionPoint[];
  finalState: RunState;
}

export interface ReplayOptions {
  engine?: EngineApi;
  sampleIntervalSec?: number;
  maxSimSec?: number;
  predictionAnswers?: Record<string, { answer: unknown; confidence: Confidence }>;
}

export interface ExposureThresholdRule {
  id: string;
  name: string;
  description: string;
  metric: keyof MetricPoint;
  op: '>' | '>=' | '<' | '<=';
  threshold: number;
  /** Secondary condition, e.g. FiO2 > 0.6 while SpO2 > 96% */
  secondary?: {
    metric: keyof MetricPoint;
    op: '>' | '>=' | '<' | '<=';
    threshold: number;
  };
  /** Device filter, e.g. invasive ventilation only */
  deviceFilter?: 'invasive' | 'niv' | 'hfnc' | 'any';
  source: string;
}

export interface ExposureLedgerEntry {
  ruleId: string;
  name: string;
  metric: string;
  conditionDescription: string;
  durationSimMinutes: number;
  maxObservedValue: number | null;
  minObservedValue: number | null;
  source: string;
}

export interface ContextAtDecision {
  simTimeSec: number;
  device: DeviceSettings;
  monitored: {
    spo2: number | null;
    paco2: number | null;
    pao2: number | null;
    ph: number | null;
    pplat: number | null;
    drivingPressure: number | null;
    ppeak: number | null;
    map: number | null;
    hr: number | null;
    rrTotal: number | null;
  };
  lastAbg: {
    drawnAtSec: number;
    ph: number;
    paco2: number;
    pao2: number;
    sao2: number;
  } | null;
  dataViewed: string[];
  activeAlarms: string[];
  committedAssessment?: string;
  confidence?: Confidence;
  rationale?: string;
}

export interface PhysiologyResponse {
  windowSimMin: number;
  deltaSpo2: number | null;
  deltaPaco2: number | null;
  deltaPh: number | null;
  deltaDrivingPressure: number | null;
  deltaPplat: number | null;
  summary: string;
}

export interface DecisionClassification {
  decisionIndex: number;
  decision: DecisionInput;
  processClass: ProcessClass;
  ruleId: string;
  ruleExplanation: string;
  source: string;
  context: ContextAtDecision;
  response: PhysiologyResponse;
  isRescueAction: boolean;
}

export interface AuthoredReferenceDecision {
  simTimeSec: number;
  kind: DecisionKind;
  order?: OrderType;
  detail?: Record<string, unknown>;
  settings?: Partial<DeviceSettings>;
  rationale: string;
  source: string;
}

export interface ReferenceRunDefinition {
  caseId: string;
  title: string;
  label: string; // "One reasonable approach"
  source: string;
  decisions: AuthoredReferenceDecision[];
}
