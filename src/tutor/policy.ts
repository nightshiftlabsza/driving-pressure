import type {
  HelpLevel,
  LearnerRequestKind,
  TutorConfidence,
  TutorContextKind,
  TutorMode,
} from './types';
import { countWords, detectGateBypassInput } from './types';

export type StruggleState =
  | 'none'
  | 'productive_struggle'
  | 'unproductive_struggle';

export interface StruggleInputs {
  failedAttemptsCount: number;
  consecutiveSameCompetencyErrors?: number;
  recentManeuversCount?: number;
  previousHypothesis?: string;
  currentHypothesis?: string;
  latencyMs?: number;
  rapidKnobChangesWithoutManeuver?: number;
  confidence?: TutorConfidence;
}

export interface FatigueInputs {
  localTime?: Date;
  sessionDurationMs?: number;
  latencyMs?: number;
  baselineLatencyMs?: number;
  currentInput?: string;
  failedAttemptsCount?: number;
}

export interface FatigueClassification {
  fatigued: boolean;
  reasons: string[];
  offerBookmark: boolean;
  offerLowBandwidth: boolean;
}

export interface SafetyVitalsSnapshot {
  spo2Pct?: number | null;
  mapMmHg?: number | null;
  ph?: number | null;
  pplatCmH2O?: number | null;
  dangerDurationSec?: number;
}

export interface PolicyInputs {
  guidanceLevel: 'guided' | 'prompted' | 'independent';
  isProbe: boolean;
  hasCommittedDecision: boolean;
  failedAttemptsCount: number;
  hasConfidentError: boolean;
  isStuck: boolean;
  isImmediateDanger: boolean;
  learnerRequest?: LearnerRequestKind;
  /** Optional alias accepted for caller compatibility. */
  requestKind?: LearnerRequestKind;
  learnerMessage?: string;
  contextKind: TutorContextKind;
  attemptNumberInProblem?: number;
  tutorMode?: TutorMode;
  hasValidAttempt?: boolean;
  isUiHelpQuestion?: boolean;
  isCorrectGuess?: boolean;
  competingHypothesesCount?: number;
  competencyStatus?: 'not_seen' | 'practising' | 'independent' | 'mastered' | 'retained';
  consecutiveGuessFailures?: number;
  vitals?: SafetyVitalsSnapshot;
  debriefSelfCritiqueSubmitted?: boolean;
  struggleInputs?: StruggleInputs;
  fatigueInputs?: FatigueInputs;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  return new Set(tokens);
}

/**
 * Jaccard token distance in [0, 1] between two hypothesis strings.
 * Higher values indicate the learner substantively revised their hypothesis.
 */
export function tokenJaccardDistance(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

/**
 * Exception A (Section 6.2):
 * SpO2 < 85%, MAP < 55 mmHg, pH < 7.10, or Pplat > 35 cmH2O persisting > 60 seconds.
 */
export function isSafetyCrisisVitals(vitals?: SafetyVitalsSnapshot): boolean {
  if (!vitals) return false;
  const thresholdBreached =
    (typeof vitals.spo2Pct === 'number' && vitals.spo2Pct < 85) ||
    (typeof vitals.mapMmHg === 'number' && vitals.mapMmHg < 55) ||
    (typeof vitals.ph === 'number' && vitals.ph < 7.1) ||
    (typeof vitals.pplatCmH2O === 'number' && vitals.pplatCmH2O > 35);

  if (!thresholdBreached) return false;
  if (typeof vitals.dangerDurationSec === 'number') {
    return vitals.dangerDurationSec > 60;
  }
  return true;
}

/**
 * Deterministic Struggle Classifier (Section 6.3).
 * Productive struggle keeps cap at 0 or 1; unproductive wheel-spinning escalates by +1.
 */
export function classifyStruggle(inputs: StruggleInputs): StruggleState {
  const consecutiveErrors = inputs.consecutiveSameCompetencyErrors ?? inputs.failedAttemptsCount;
  const rapidKnobs = inputs.rapidKnobChangesWithoutManeuver ?? 0;
  const latency = inputs.latencyMs ?? 30_000;
  const maneuvers = inputs.recentManeuversCount ?? 0;

  const hasBothHypotheses = Boolean(
    inputs.previousHypothesis?.trim() && inputs.currentHypothesis?.trim()
  );
  const distance = hasBothHypotheses
    ? tokenJaccardDistance(inputs.previousHypothesis!, inputs.currentHypothesis!)
    : 1;

  // Unproductive struggle / wheel-spinning (Beck & Gong, 2013)
  if (
    consecutiveErrors >= 3 ||
    (hasBothHypotheses && distance <= 0.25 && inputs.failedAttemptsCount >= 1) ||
    rapidKnobs >= 4 ||
    (latency > 180_000 && inputs.confidence === 'guess')
  ) {
    return 'unproductive_struggle';
  }

  // Productive struggle: 1-2 failed attempts, revising hypothesis (>0.25) or using maneuvers, 15-120s latency
  if (
    inputs.failedAttemptsCount >= 1 &&
    inputs.failedAttemptsCount <= 2 &&
    (maneuvers > 0 || distance > 0.25) &&
    latency >= 15_000 &&
    latency <= 120_000
  ) {
    return 'productive_struggle';
  }

  return 'none';
}

/**
 * Deterministic Fatigue / Cognitive Overload Detector (Section 6.3).
 * Triggers when local clock is 23:00-05:30 or session > 60 min, paired with
 * >50% latency rise or <5-word frustration/bypass input with rising errors.
 * Never lowers mastery standards or unlocks free Level 3 answers.
 */
export function classifyFatigue(inputs: FatigueInputs): FatigueClassification {
  const reasons: string[] = [];
  const now = inputs.localTime;
  let circadianRisk = false;
  if (now) {
    const h = now.getHours();
    const m = now.getMinutes();
    if (h >= 23 || h < 5 || (h === 5 && m <= 30)) {
      circadianRisk = true;
      reasons.push('Late post-call hours (23:00-05:30)');
    }
  }

  const longSession = (inputs.sessionDurationMs ?? 0) > 3_600_000;
  if (longSession) {
    reasons.push('Continuous session exceeds 60 minutes');
  }

  const latencySpike =
    typeof inputs.baselineLatencyMs === 'number' &&
    inputs.baselineLatencyMs > 0 &&
    typeof inputs.latencyMs === 'number' &&
    inputs.latencyMs > inputs.baselineLatencyMs * 1.5;

  const text = inputs.currentInput ?? '';
  const shortFrustratedInput =
    (countWords(text) > 0 && countWords(text) < 5 && (inputs.failedAttemptsCount ?? 0) >= 1) ||
    detectGateBypassInput(text);

  const fatigued = (circadianRisk || longSession) && (latencySpike || shortFrustratedInput);
  if (fatigued && latencySpike) {
    reasons.push('Response latency increased >50%');
  }
  if (fatigued && shortFrustratedInput) {
    reasons.push('Short/frustrated input pattern');
  }

  return {
    fatigued,
    reasons: fatigued ? reasons : [],
    offerBookmark: fatigued,
    offerLowBandwidth: fatigued,
  };
}

/**
 * Deterministic maximum help-level cap calculator (Section 6.1, 6.2, 6.3, 9.6 Item 3).
 * Removed legacy "I'm stuck" -> 3 and 2-wrong -> 3 shortcuts.
 */
export function computeHelpLevelCap(inputs: PolicyInputs): HelpLevel {
  const request = inputs.learnerRequest ?? inputs.requestKind;
  const attemptNum = Math.max(1, inputs.attemptNumberInProblem ?? 1);
  const tutorMode = inputs.tutorMode ?? 'coaching';
  const hasValidAttempt = inputs.hasValidAttempt ?? true;

  // Exception C: Pure UI / simulator mechanics clarification
  if (inputs.isUiHelpQuestion) {
    return 0;
  }

  // Surface 8.1(f): Post-Case Debrief opens with self-critique gate
  if (inputs.contextKind === 'debrief') {
    if (!inputs.debriefSelfCritiqueSubmitted) {
      return 1;
    }
    return 3;
  }

  // Surface 8.1(h): Free discussion starts at Cap 2 on Turn 1, rising to 3 on follow-up
  if (inputs.contextKind === 'free_discussion') {
    return attemptNum >= 2 ? 3 : 2;
  }

  // Pathway guidance
  if (inputs.contextKind === 'pathway') {
    return attemptNum >= 2 ? 3 : 2;
  }

  // Surface 8.1(e) & (g): Lab and Practice require commitment/reveal first
  if (inputs.contextKind === 'lab' || inputs.contextKind === 'practice') {
    if (!inputs.hasCommittedDecision) {
      if (request && hasValidAttempt) return 1;
      return 0;
    }
    return attemptNum >= 2 ? 3 : 2;
  }

  // Active case: Exception A (Safety Crisis) unlocks Cap 2 even on Turn 1 or Exam-Silent
  const safetyCrisis = inputs.isImmediateDanger || isSafetyCrisisVitals(inputs.vitals);
  const isAsking =
    Boolean(request) || Boolean(inputs.learnerMessage && inputs.learnerMessage.trim().length > 0);
  if (safetyCrisis && (inputs.failedAttemptsCount >= 1 || isAsking)) {
    return 2;
  }

  // Exam / Consultant-Silent Mode locks tutoring during active case
  if (tutorMode === 'exam_silent') {
    return 0;
  }

  // Locked hidden probe or uncommitted decision/prediction
  if (inputs.isProbe && !inputs.hasCommittedDecision) {
    if (hasValidAttempt && isAsking) {
      return 1;
    }
    return 0;
  }

  // Confident error triggers hypercorrection contrast at Cap 1 (never Cap 3!)
  if (inputs.hasConfidentError) {
    return 1;
  }

  // Correct guess triggers Level 1 mechanism consolidation check
  if (inputs.isCorrectGuess) {
    return 1;
  }

  // Exception B: True unproductive struggle when schema is absent (not_seen + >= 2 guess failures)
  const exceptionB =
    inputs.competencyStatus === 'not_seen' && (inputs.consecutiveGuessFailures ?? 0) >= 2;

  const struggleState = inputs.struggleInputs
    ? classifyStruggle(inputs.struggleInputs)
    : 'none';

  // Turn 1 outside Exception A safety crisis never exceeds Cap 1
  if (attemptNum <= 1) {
    if (inputs.guidanceLevel === 'independent' && !request && !exceptionB) {
      return 0;
    }
    if (inputs.competingHypothesesCount !== undefined && inputs.competingHypothesesCount < 2) {
      return 1;
    }
    if (request === 'hint') return 1;
    if (inputs.guidanceLevel === 'guided' || inputs.guidanceLevel === 'prompted') {
      return 1;
    }
    return isAsking && hasValidAttempt ? 1 : 0;
  }

  // Diagnostic single-hypothesis constraint before narrowing
  if (inputs.competingHypothesesCount !== undefined && inputs.competingHypothesesCount < 2) {
    return 1;
  }

  // Turn 2: Graduated step-up up to Cap 2 (never Cap 3 yet)
  if (attemptNum === 2) {
    if (inputs.guidanceLevel === 'independent') {
      if (struggleState === 'unproductive_struggle' || exceptionB) return 2;
      return isAsking && hasValidAttempt ? 1 : 0;
    }
    if (struggleState === 'productive_struggle') {
      return 1;
    }
    if (
      struggleState === 'unproductive_struggle' ||
      exceptionB ||
      inputs.failedAttemptsCount >= 2 ||
      request === 'narrow' ||
      request === 'explain' ||
      request === 'worked_example'
    ) {
      return 2;
    }
    return 1;
  }

  // Turn 3+: Level 3 ONLY after 3 failed guided attempts (or Exception B at Turn 3+)
  if (
    (inputs.guidanceLevel === 'guided' && inputs.failedAttemptsCount >= 3) ||
    (exceptionB && attemptNum >= 3)
  ) {
    return 3;
  }

  if (inputs.guidanceLevel === 'independent') {
    if (struggleState === 'unproductive_struggle') return 2;
    return isAsking && hasValidAttempt ? 1 : 0;
  }

  if (struggleState === 'productive_struggle') {
    return 1;
  }

  return 2;
}
