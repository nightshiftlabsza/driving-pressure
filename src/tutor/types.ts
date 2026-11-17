import { z } from 'zod';

export const REASONING_GRADES = [
  'correct_justified',
  'correct_superficial',
  'correct_conclusion_wrong_reasoning',
  'wrong_conclusion_sound_parts',
  'unsupported_assumption',
  'specific_misconception',
  'too_ambiguous',
] as const;
export type ReasoningGrade = (typeof REASONING_GRADES)[number];

export const EVIDENCE_LEVELS = [
  'physiology',
  'guideline',
  'trial',
  'expert_opinion',
  'uncertain',
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const VALID_MISCONCEPTION_IDS = [
  'knowledge_gap',
  'faulty_model',
  'misinterpretation',
  'missed_clue',
  'poor_prioritisation',
  'premature_closure',
  'failure_to_reassess',
  'right_action_wrong_reason',
  'calibration_error',
  'unsafe_action',
] as const;
export type MisconceptionId = (typeof VALID_MISCONCEPTION_IDS)[number];

export type HelpLevel = 0 | 1 | 2 | 3;

export const LEARNER_REQUEST_KINDS = [
  'hint',
  'narrow',
  'explain',
  'go_deeper',
  'worked_example',
  'challenge_me',
] as const;
export type LearnerRequestKind = (typeof LEARNER_REQUEST_KINDS)[number];

export type TutorContextKind =
  | 'active_case'
  | 'debrief'
  | 'free_discussion'
  | 'lab'
  | 'practice'
  | 'pathway';

export type TutorConfidence = 'guess' | 'fairly_sure' | 'certain';

export type TutorMode = 'coaching' | 'exam_silent' | 'low_bandwidth';

export type ManeuverType =
  | 'inspiratory_hold'
  | 'expiratory_hold'
  | 'abg_ordered'
  | 'cxr_viewed';

export interface StructuredLearnerAttempt {
  observation: string;
  mechanismHypothesis: string;
  predictedConsequence?: string;
  confidence: TutorConfidence;
  maneuversPerformed: ManeuverType[];
  attemptNumberInProblem: number;
  latencyMs: number;
}

export interface TutorTurnSummary {
  turnIndex: number;
  learnerAttempt: StructuredLearnerAttempt;
  tutorMessage: string;
  helpLevelUsed: HelpLevel;
  reasoningGrade: ReasoningGrade | null;
}

export interface AbgCommitInterpretation {
  primaryDisorder: string;
  compensationStatus: string;
  oxygenationAaStatus: string;
  anionGapStatus?: string;
}

export type FreeDiscussionMode = 'stress_test' | 'compare_scenarios';

export interface TutorClaim {
  text: string;
  evidence_level: EvidenceLevel;
  numeric_values_cited?: Record<string, number>;
}

export const TutorClaimSchema = z.object({
  text: z.string(),
  evidence_level: z.enum(EVIDENCE_LEVELS),
  numeric_values_cited: z.record(z.number()).optional(),
});

export const TutorResponseSchema = z.object({
  message: z.string(),
  help_level_used: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  question: z.string().nullable(),
  needs_clarification: z.boolean(),
  reasoning_grade: z.enum(REASONING_GRADES).nullable(),
  misconception_ids: z.array(z.string()),
  claims: z.array(TutorClaimSchema),
  confidence: z.number().min(0).max(1),
  causal_nodes_verified: z.array(z.string()).optional(),
  unaccounted_data_keys: z.array(z.string()).optional(),
});

export type TutorResponse = z.infer<typeof TutorResponseSchema>;
export type TutorResponseV2 = TutorResponse;

export interface TutorRequestContext {
  contextKind: TutorContextKind;
  helpLevelCap: HelpLevel;
  caseId?: string;
  patientDescription?: string;
  monitoredSnapshot?: Record<string, string | number | null>;
  ventilatorSettings?: Record<string, string | number | null>;
  recentOrders?: { simTimeSec: number; order: string; detail?: Record<string, unknown> }[];
  recentPredictions?: { question: string; answer: unknown; expected?: unknown; correct?: boolean }[];
  lastFindings?: { examine?: string; cxr?: string; abg?: Record<string, unknown> };
  learnerCompetencySummary?: { competency: string; status: string; guidance: string; topMistakes: string[] }[];
  isProbeActive?: boolean;
  withheldDiagnosis?: string;
  forbiddenPhrases?: string[];
}

export interface TutorRequest {
  contextKind: TutorContextKind;
  helpLevelCap: HelpLevel;
  requestKind?: LearnerRequestKind;
  learnerMessage?: string;
  learnerAttempt?: StructuredLearnerAttempt;
  history?: TutorTurnSummary[];
  tutorMode?: TutorMode;
  isUiHelpQuestion?: boolean;
  abgInterpretation?: AbgCommitInterpretation;
  freeDiscussionMode?: FreeDiscussionMode;
  derivedIndicesSummary?: string;
  unaccountedAbnormalities?: string[];
  ragPearls?: string[];
  contextText: string;
  withheldDiagnosis?: string;
  forbiddenPhrases?: string[];
  promptVersion?: string;
}

export type TutorFailureKind =
  | 'timeout'
  | 'quota'
  | 'malformed'
  | 'network'
  | 'rate_limited'
  | 'unavailable'
  | 'policy_blocked'
  | 'no_ai';

export interface TutorSuccessResult {
  success: true;
  data: TutorResponse;
  provider: string;
  model: string;
  latencyMs: number;
  promptVersion: string;
  rawJson?: string;
  notice?: string;
}

export interface TutorFailureResult {
  success: false;
  error: string;
  failureKind: TutorFailureKind;
  provider?: string;
  rawResponse?: string;
  notice?: string;
}

export type TutorResult = TutorSuccessResult | TutorFailureResult;

export interface TutorLogRecord {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  tokens?: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  outcome: 'success' | 'failure';
  failureKind?: TutorFailureKind;
  errorMessage?: string;
}

export const MIN_OBSERVATION_WORDS = 4;
export const MIN_MECHANISM_WORDS = 6;
export const MIN_PREDICTION_WORDS = 2;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

const BYPASS_PHRASES = [
  /\bjust tell me\b/i,
  /\btell me the answer\b/i,
  /\bgive me the answer\b/i,
  /\bi\s*don'?t\s*know\b/i,
  /\bidk\b/i,
  /\bwhat setting should i (set|use|change)\b/i,
  /\bskip\b/i,
];

export function detectGateBypassInput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return BYPASS_PHRASES.some(rx => rx.test(trimmed));
}

export interface AttemptValidationResult {
  valid: boolean;
  reason?: string;
  bypassDetected?: boolean;
}

export function validateStructuredAttempt(
  attempt: Partial<StructuredLearnerAttempt> | null | undefined,
  options?: {
    requiresPrediction?: boolean;
    requireAbgStrip?: boolean;
    abgInterpretation?: Partial<AbgCommitInterpretation> | null;
  }
): AttemptValidationResult {
  if (!attempt) {
    return { valid: false, reason: 'Submit your observation, mechanism hypothesis, and confidence first.' };
  }

  const obs = attempt.observation ?? '';
  const mech = attempt.mechanismHypothesis ?? '';
  const pred = attempt.predictedConsequence ?? '';

  if (detectGateBypassInput(obs) || detectGateBypassInput(mech)) {
    return {
      valid: false,
      bypassDetected: true,
      reason: 'State a clinical observation and causal mechanism before requesting guidance.',
    };
  }

  if (countWords(obs) < MIN_OBSERVATION_WORDS) {
    return {
      valid: false,
      reason: `Observation requires at least ${MIN_OBSERVATION_WORDS} words describing monitor or waveform findings.`,
    };
  }

  if (countWords(mech) < MIN_MECHANISM_WORDS) {
    return {
      valid: false,
      reason: `Mechanism hypothesis requires at least ${MIN_MECHANISM_WORDS} words explaining the causal physiology.`,
    };
  }

  if (!attempt.confidence || !['guess', 'fairly_sure', 'certain'].includes(attempt.confidence)) {
    return { valid: false, reason: 'Select a confidence rating (guess, fairly sure, or certain).' };
  }

  if (options?.requiresPrediction && countWords(pred) < MIN_PREDICTION_WORDS) {
    return {
      valid: false,
      reason: 'Predict the directional physiological consequence before committing or asking.',
    };
  }

  if (options?.requireAbgStrip) {
    const abg = options.abgInterpretation;
    if (
      !abg ||
      !abg.primaryDisorder?.trim() ||
      !abg.compensationStatus?.trim() ||
      !abg.oxygenationAaStatus?.trim()
    ) {
      return {
        valid: false,
        reason: 'Complete the ABG Commit Strip (primary disorder, compensation, oxygenation/A-a) first.',
      };
    }
  }

  return { valid: true };
}
