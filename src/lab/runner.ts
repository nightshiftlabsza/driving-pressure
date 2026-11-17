import type {
  EngineApi,
  EngineState,
  PatientParams,
  DeviceSettings,
  WaveformSample,
} from '../shared/engineTypes';
import { METRICS, type BaseMetric } from '../shared/caseSchema';
import {
  LAB_METRICS,
  type LabMetric,
  LAB_NOISE_BAND,
  type Direction,
  type LabExperiment,
  type LabVariable,
} from './schema';
import { metricOf } from '../engine/metrics';
import type { ActivityCandidate } from '../shared/learnerApi';
import {
  type EventSink,
  type LearnerEvent,
  EVENT_SCHEMA_VERSION,
  type Confidence,
  type GuidanceLevel,
} from '../shared/events';
import { newId } from '../shared/eventSink';

/**
 * Metric evaluation for the Lab:
 * - Delegates base metrics in METRICS to `metricOf(state, metric)`.
 * - For 'endExpFlow', returns magnitude of end-expiratory flow in L/s (|endExpFlowLps|).
 * - For 'ineffectiveEfforts', returns ineffective efforts from the last breath.
 */
export function labMetricOf(state: EngineState, metric: LabMetric): number | null {
  if (metric === 'endExpFlow') {
    return state.lastBreath ? Math.abs(state.lastBreath.endExpFlowLps) : null;
  }
  if (metric === 'ineffectiveEfforts') {
    return state.lastBreath ? state.lastBreath.ineffectiveEfforts : 0;
  }
  // Base metrics from METRICS
  return metricOf(state, metric as BaseMetric);
}

/**
 * Direction marking comparing before and after values against LAB_NOISE_BAND.
 * Returns 'up' if after - before > band, 'down' if before - after > band, otherwise 'same'.
 */
export function markDirection(
  before: number | null,
  after: number | null,
  metric: LabMetric
): Direction {
  if (before === null || after === null) {
    return 'same';
  }
  const band = LAB_NOISE_BAND[metric] ?? 0;
  if (after - before > band) {
    return 'up';
  }
  if (before - after > band) {
    return 'down';
  }
  return 'same';
}

/**
 * Applies a variable option to the engine state.
 * Supports device overrides, patient overrides, or target field setting.
 */
export function applyVariableOption(
  engine: EngineApi,
  state: EngineState,
  variable: LabVariable,
  optionIndex = 0
): EngineState {
  const opt = variable.options[optionIndex] ?? variable.options[0];
  if (!opt) {
    return state;
  }

  let nextState = state;
  if (opt.deviceOverride) {
    nextState = engine.setDevice(nextState, opt.deviceOverride);
  } else if (variable.target === 'device') {
    nextState = engine.setDevice(nextState, {
      ...nextState.device,
      [variable.field]: opt.value,
    } as DeviceSettings);
  }

  if (opt.patientOverride) {
    nextState = engine.setPatient(nextState, opt.patientOverride);
  } else if (variable.target === 'patient') {
    nextState = engine.setPatient(nextState, {
      [variable.field]: opt.value,
    } as Partial<PatientParams>);
  }

  return nextState;
}

export interface HeadlessExperimentResult {
  baselineState: EngineState;
  afterState: EngineState;
  baselineMetrics: Record<LabMetric, number | null>;
  afterMetrics: Record<LabMetric, number | null>;
  answerKey: Record<string, Direction>;
  baselineSamples: WaveformSample[];
  afterSamples: WaveformSample[];
}

/**
 * Headless deterministic experiment runner:
 * 1. Creates initial state with seed 1.
 * 2. Steps baselineSimSec in 1s steps.
 * 3. Records baselineState and baselineMetrics.
 * 4. Applies the chosen variable option.
 * 5. Steps observeSimSec in 1s steps.
 * 6. Records afterState, afterMetrics, and answerKey.
 */
export function runExperimentHeadless(
  engine: EngineApi,
  exp: LabExperiment,
  optionIndex = 0
): HeadlessExperimentResult {
  let s = engine.createState(
    exp.patient.params as PatientParams,
    exp.initialDevice as DeviceSettings,
    exp.initialPhys,
    1
  );

  const baselineSamples: WaveformSample[] = [];
  const baselineSimSec = Math.max(1, exp.baselineSimSec);
  for (let t = 0; t < baselineSimSec; t++) {
    const res = engine.step(s, 1);
    s = res.state;
    baselineSamples.push(...res.samples);
  }

  const baselineState = s;

  s = applyVariableOption(engine, baselineState, exp.variable, optionIndex);

  const afterSamples: WaveformSample[] = [];
  const observeSimSec = Math.max(1, exp.observeSimSec);
  for (let t = 0; t < observeSimSec; t++) {
    const res = engine.step(s, 1);
    s = res.state;
    afterSamples.push(...res.samples);
  }

  const afterState = s;

  const baselineMetrics = {} as Record<LabMetric, number | null>;
  const afterMetrics = {} as Record<LabMetric, number | null>;
  for (const m of LAB_METRICS) {
    baselineMetrics[m] = labMetricOf(baselineState, m);
    afterMetrics[m] = labMetricOf(afterState, m);
  }

  const answerKey: Record<string, Direction> = {};
  for (const m of exp.prediction.metrics) {
    answerKey[m] = markDirection(baselineMetrics[m], afterMetrics[m], m);
  }

  return {
    baselineState,
    afterState,
    baselineMetrics,
    afterMetrics,
    answerKey,
    baselineSamples,
    afterSamples,
  };
}

/**
 * Converts a LabExperiment into an ActivityCandidate for learner recommendations.
 */
export function toActivityCandidate(exp: LabExperiment): ActivityCandidate {
  return {
    activity: 'lab',
    id: exp.id,
    competencies: exp.competencies,
    hiddenCompetencies: [],
    contextTags: exp.contextTags,
    difficulty: exp.difficulty,
  };
}

export interface RecordLabRunStartOptions {
  runId?: string;
  sessionId?: string;
}

export async function recordLabRunStart(
  sink: EventSink,
  exp: LabExperiment,
  runIdOrOptions?: string | RecordLabRunStartOptions,
  sessionIdArg?: string
): Promise<string> {
  let runId = newId();
  let sessionId = sessionIdArg ?? 'lab-session';

  if (typeof runIdOrOptions === 'string') {
    runId = runIdOrOptions;
  } else if (runIdOrOptions) {
    if (runIdOrOptions.runId) runId = runIdOrOptions.runId;
    if (runIdOrOptions.sessionId) sessionId = runIdOrOptions.sessionId;
  }

  const guidanceByCompetency: Record<string, GuidanceLevel> = {};
  for (const c of exp.competencies) {
    guidanceByCompetency[c] = 'independent';
  }

  const event: LearnerEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: newId(),
    wallTime: new Date().toISOString(),
    sessionId,
    runId,
    activity: 'lab',
    activityId: exp.id,
    contextTags: exp.contextTags,
    type: 'run_start',
    guidanceByCompetency,
  };

  await sink.record(event);
  return runId;
}

export interface RecordLabPredictionOptions {
  runId: string;
  sessionId?: string;
  answer: Record<string, Direction>;
  expected: Record<string, Direction>;
  correct: boolean;
  confidence: Confidence;
  latencyMs?: number;
}

export async function recordLabPrediction(
  sink: EventSink,
  exp: LabExperiment,
  runIdOrOptions: string | RecordLabPredictionOptions,
  answerArg?: Record<string, Direction>,
  expectedArg?: Record<string, Direction>,
  correctArg?: boolean,
  confidenceArg?: Confidence,
  latencyMsArg?: number,
  sessionIdArg?: string
): Promise<void> {
  let runId: string;
  let sessionId = sessionIdArg ?? 'lab-session';
  let answer: Record<string, Direction>;
  let expected: Record<string, Direction>;
  let correct: boolean;
  let confidence: Confidence;
  let latencyMs: number | undefined;

  if (typeof runIdOrOptions === 'object') {
    runId = runIdOrOptions.runId;
    sessionId = runIdOrOptions.sessionId ?? 'lab-session';
    answer = runIdOrOptions.answer;
    expected = runIdOrOptions.expected;
    correct = runIdOrOptions.correct;
    confidence = runIdOrOptions.confidence;
    latencyMs = runIdOrOptions.latencyMs;
  } else {
    runId = runIdOrOptions;
    answer = answerArg ?? {};
    expected = expectedArg ?? {};
    correct = Boolean(correctArg);
    confidence = confidenceArg ?? 'fairly_sure';
    latencyMs = latencyMsArg;
  }

  const predictionEvent: LearnerEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: newId(),
    wallTime: new Date().toISOString(),
    sessionId,
    runId,
    activity: 'lab',
    activityId: exp.id,
    contextTags: exp.contextTags,
    type: 'prediction',
    predictionId: `${exp.id}-prediction`,
    question: exp.prediction.question,
    answer,
    expected,
    competency: exp.competencies[0],
    evidenceType: 'prediction',
    correct,
    confidence,
    guidance: 'independent',
    hidden: false,
    latencyMs,
  };

  await sink.record(predictionEvent);

  if (confidence === 'certain' && !correct) {
    const mistakeEvent: LearnerEvent = {
      v: EVENT_SCHEMA_VERSION,
      id: newId(),
      wallTime: new Date().toISOString(),
      sessionId,
      runId,
      activity: 'lab',
      activityId: exp.id,
      contextTags: exp.contextTags,
      type: 'mistake',
      mistake: 'calibration_error',
      competency: exp.competencies[0],
      severity: 'minor',
      detail: 'Certain confidence on incorrect lab prediction',
    };
    await sink.record(mistakeEvent);
  }
}

export interface RecordLabReflectionOptions {
  runId: string;
  sessionId?: string;
  selectedOptionId: string;
  latencyMs?: number;
}

export async function recordLabReflection(
  sink: EventSink,
  exp: LabExperiment,
  runIdOrOptions: string | RecordLabReflectionOptions,
  selectedOptionIdArg?: string,
  latencyMsArg?: number,
  sessionIdArg?: string
): Promise<void> {
  let runId: string;
  let sessionId = sessionIdArg ?? 'lab-session';
  let selectedOptionId: string;
  let latencyMs: number | undefined;

  if (typeof runIdOrOptions === 'object') {
    runId = runIdOrOptions.runId;
    sessionId = runIdOrOptions.sessionId ?? 'lab-session';
    selectedOptionId = runIdOrOptions.selectedOptionId;
    latencyMs = runIdOrOptions.latencyMs;
  } else {
    runId = runIdOrOptions;
    selectedOptionId = selectedOptionIdArg ?? '';
    latencyMs = latencyMsArg;
  }

  const correct = selectedOptionId === exp.reflection.correctOptionId;
  const competency =
    exp.competencies.length > 1 ? exp.competencies[1] : exp.competencies[0];

  const reflectionEvent: LearnerEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: newId(),
    wallTime: new Date().toISOString(),
    sessionId,
    runId,
    activity: 'lab',
    activityId: exp.id,
    contextTags: exp.contextTags,
    type: 'prediction',
    predictionId: `${exp.id}-reflection`,
    question: exp.reflection.question,
    answer: selectedOptionId,
    expected: exp.reflection.correctOptionId,
    competency,
    evidenceType: 'interpretation',
    correct,
    guidance: 'independent',
    hidden: false,
    latencyMs,
  };

  await sink.record(reflectionEvent);
}

export interface RecordLabRunEndOptions {
  runId: string;
  sessionId?: string;
  outcome?: 'completed' | 'abandoned';
  score?: number;
  maxScore?: number;
}

export async function recordLabRunEnd(
  sink: EventSink,
  exp: LabExperiment,
  runIdOrOptions: string | RecordLabRunEndOptions,
  outcomeArg: 'completed' | 'abandoned' = 'completed',
  scoreArg?: number,
  maxScoreArg?: number,
  sessionIdArg?: string
): Promise<void> {
  let runId: string;
  let sessionId = sessionIdArg ?? 'lab-session';
  let outcome: 'completed' | 'abandoned' = outcomeArg;
  let score = scoreArg;
  let maxScore = maxScoreArg;

  if (typeof runIdOrOptions === 'object') {
    runId = runIdOrOptions.runId;
    sessionId = runIdOrOptions.sessionId ?? 'lab-session';
    if (runIdOrOptions.outcome) outcome = runIdOrOptions.outcome;
    score = runIdOrOptions.score;
    maxScore = runIdOrOptions.maxScore;
  } else {
    runId = runIdOrOptions;
  }

  const runEndEvent: LearnerEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: newId(),
    wallTime: new Date().toISOString(),
    sessionId,
    runId,
    activity: 'lab',
    activityId: exp.id,
    contextTags: exp.contextTags,
    type: 'run_end',
    outcome,
    score,
    maxScore,
  };

  await sink.record(runEndEvent);
}
