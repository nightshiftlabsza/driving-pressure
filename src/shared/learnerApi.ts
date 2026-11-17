/**
 * FROZEN CONTRACT: what the learner model exposes to the rest of the app.
 * Implemented by src/learner (agent B). Consumed by screens (agent D), the case runtime and drills.
 * Agents may import from this file but must not edit it.
 */
import type { EventSink, GuidanceLevel, Confidence, ActivityKind } from './events';

export type CompetencyStatus = 'not_seen' | 'practising' | 'independent' | 'mastered' | 'retained';

export interface CalibrationStats {
  byConfidence: Record<Confidence, { answered: number; correct: number }>;
}

export type TutorMode = 'coaching' | 'exam_silent' | 'low_bandwidth';

export type CompetencyReasoningGrade =
  | 'correct_justified'
  | 'correct_superficial'
  | 'correct_conclusion_wrong_reasoning'
  | 'right_action_wrong_reason'
  | 'incorrect_reasoning'
  | 'incomplete_reasoning';

export interface AssistanceTelemetry {
  assistedInWindow: boolean;
  maxHelpLevelUsed: 0 | 1 | 2 | 3;
  hintCountInProblem: number;
  tutorTurnsBeforeCommit: number;
  reconstructionPassed: boolean | null;
  timeToFirstHypothesisMs: number;
}

export interface CompetencyState {
  competency: string;
  status: CompetencyStatus;
  guidance: GuidanceLevel;
  guidanceOverride: GuidanceLevel | null;   // learner's manual choice, wins over computed
  dueAt: string | null;                     // ISO; null = not scheduled
  intervalDays: number | null;
  evidenceCount: number;
  correctCount: number;
  contextsCorrect: string[];                // distinct context tags with an independent correct answer
  lastEvidenceAt: string | null;
  calibration: CalibrationStats;
  topMistakes: { mistake: string; count: number }[];
  unaidedEntrustmentScore?: number;
  assistedSuccessCount?: number;
  unaidedSuccessContexts?: string[];
  pendingDelayedRetestDueAt?: number | null;
  pendingTransferVariantId?: string | null;
  brierCalibrationScore?: number;
}

export interface CompetencyStateV2 extends CompetencyState {
  unaidedEntrustmentScore: number;
  assistedSuccessCount: number;
  unaidedSuccessContexts: string[];
  pendingDelayedRetestDueAt: number | null;
  pendingTransferVariantId: string | null;
  brierCalibrationScore: number;
}

export interface RunSummary {
  runId: string;
  activity: ActivityKind;
  activityId: string;
  activityVersion?: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  predictions: { predictionId: string; question: string; answer: unknown; expected: unknown; correct: boolean; confidence?: Confidence; competency: string }[];
  rubric: { rubricId: string; met: boolean; critical: boolean; competency: string }[];
  mistakes: { mistake: string; competency: string; severity: 'minor' | 'major' | 'critical'; detail: string }[];
  ordersTimeline: { simTimeSec: number; order: string }[];
}

export interface ActivityCandidate {
  activity: ActivityKind;
  id: string;
  competencies: string[];
  hiddenCompetencies: string[];
  contextTags: string[];
  difficulty: number;
}

export interface Recommendation {
  id: string;
  score: number;        // 0..1
  reasons: string[];    // plain-language, e.g. "auto-PEEP is due for review"
}

export interface LearnerApi extends EventSink {
  getCompetencyStates(now?: Date): Promise<CompetencyState[]>;
  setGuidanceOverride(competency: string, level: GuidanceLevel | null): Promise<void>;
  getRun(runId: string): Promise<RunSummary | null>;
  listRuns(limit?: number): Promise<RunSummary[]>;
  /** Rank candidates. Weights: due 0.35, weak 0.30, curriculum 0.20, novelty 0.15; avoid repeating the last context. */
  recommend(candidates: ActivityCandidate[], now?: Date): Promise<Recommendation[]>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<void>;
  resetAll(): Promise<void>;
}
