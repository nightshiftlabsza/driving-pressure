import type { GuidanceLevel } from '../shared/events';
import type { CardState } from '../practice/types';
import { createInitialCardState, formatDateIso, scheduleNextReview } from '../practice/scheduler';
import { countWords, validateStructuredAttempt, type HelpLevel, type StructuredLearnerAttempt, type TutorResponse } from './types';
import { scheduleDelayedRetest } from './store';

export type TutorEpisodeState =
  | 'ATTEMPT'
  | 'COMMIT'
  | 'REVEAL'
  | 'RECONSTRUCT'
  | 'DELAYED_RETEST';

export type DesignStateStage =
  | 'IDLE_OBSERVE'
  | 'ATTEMPT_REQUIRED'
  | 'GUIDED_DIALOGUE'
  | 'ENGINE_REVEAL'
  | 'RECONSTRUCT_REQUIRED'
  | 'COMPLETED';

export const MAX_SOCRATIC_TURNS = 3;
export const DELAYED_RETEST_INTERVAL_HOURS = 48;
export const MIN_RECONSTRUCTION_WORDS = 8;

const CAUSAL_MECHANISM_PATTERN =
  /\b(because|therefore|since|causes?|leading to|leads? to|results? in|due to|increases?|decreases?|reduces?|lowers?|raises?|worsens?|improves?|traps?|prevents?|empties?|lengthens?|shortens?|restores?|overdistends?|compresses?)\b/i;

const DOMAIN_TERM_PATTERN =
  /\b(pressure|pplat|plateau|peep|flow|volume|compliance|resistance|expiratory|alveolar|shunt|dead\s*space|ventilation|paco2|ph|spo2|venous\s*return|time\s*constant)\b/gi;

export interface TutorStateMachineConfig {
  runId?: string;
  problemId?: string;
  guidanceLevel?: GuidanceLevel;
  competencyIds?: string[];
}

export interface TutorStateMachineState {
  runId: string;
  problemId: string;
  state: TutorEpisodeState;
  designStage: DesignStateStage;
  guidanceLevel: GuidanceLevel;
  competencyIds: string[];
  turnCount: number;
  maxHelpLevelUsedInEpisode: HelpLevel;
  maskTutorResponses: boolean;
  reconstructionRequired: boolean;
  reconstructionPassed: boolean | null;
  reconstructionError: string | null;
  caseCompletionBlocked: boolean;
  metaSocraticPrompt: string | null;
  delayedRetestDueAt: number | null;
  retestCardId: string | null;
}

export type TutorEpisodeEvent =
  | { type: 'SUBMIT_ATTEMPT'; attempt: StructuredLearnerAttempt; requiresPrediction?: boolean }
  | { type: 'RECORD_TUTOR_RESPONSE'; response: TutorResponse }
  | { type: 'ENGINE_COMMIT' }
  | { type: 'START_RECONSTRUCT' }
  | { type: 'SUBMIT_RECONSTRUCTION'; text: string; nowMs?: number }
  | { type: 'RESET_FOR_NEW_PROBLEM'; problemId?: string; guidanceLevel?: GuidanceLevel };

/**
 * Meta-Socratic fading by learner guidance level:
 * - guided: concrete analytical framing
 * - prompted: concise falsification cue
 * - independent: faded (null pre-commit; only reconstructive cue after reveal)
 */
export function getMetaSocraticPrompt(
  guidanceLevel: GuidanceLevel,
  turnIndex: number,
  state: TutorEpisodeState = 'ATTEMPT'
): string | null {
  if (state === 'RECONSTRUCT') {
    return 'Summarize from memory the physical mechanism connecting settings, ventilator mechanics, and patient outcome.';
  }
  if (guidanceLevel === 'independent') {
    return null;
  }
  if (guidanceLevel === 'prompted') {
    return turnIndex === 0
      ? 'State the physiological mechanism and what measurement would falsify an alternative explanation.'
      : 'Check whether your working hypothesis explains all monitored variables before committing.';
  }
  // guided
  return turnIndex === 0
    ? 'Step 1: Compare airway vs alveolar pressures and expiratory flow before forming your hypothesis.'
    : 'Link the change in pressure or flow trace directly to compliance, resistance, or expiratory time.';
}

export function validateCausalReconstruction(text: string): { valid: boolean; reason?: string } {
  const trimmed = text.trim();
  const words = countWords(trimmed);
  if (words < MIN_RECONSTRUCTION_WORDS) {
    return {
      valid: false,
      reason: `State a causal 1-2 sentence synthesis (${words}/${MIN_RECONSTRUCTION_WORDS} minimum words).`,
    };
  }
  if (/^(ok|okay|idk|yes|no|same|agree|understood|got it|just tell me)[.!?\s]*$/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Acknowledgment is not sufficient. Reconstruct the physiological mechanism in your own words.',
    };
  }
  const hasCausalVerb = CAUSAL_MECHANISM_PATTERN.test(trimmed);
  const domainMatches = trimmed.match(DOMAIN_TERM_PATTERN) ?? [];
  const uniqueDomainTerms = new Set(domainMatches.map(m => m.toLowerCase().trim()));
  if (!hasCausalVerb && uniqueDomainTerms.size < 2) {
    return {
      valid: false,
      reason: 'Include the causal link (e.g., because/reduces/increases) and physiological variables.',
    };
  }
  return { valid: true };
}

export function createTutorStateMachineState(
  config: TutorStateMachineConfig = {}
): TutorStateMachineState {
  const guidanceLevel = config.guidanceLevel ?? 'prompted';
  return {
    runId: config.runId ?? 'session-run',
    problemId: config.problemId ?? 'active-problem',
    state: 'ATTEMPT',
    designStage: 'ATTEMPT_REQUIRED',
    guidanceLevel,
    competencyIds: config.competencyIds ?? [],
    turnCount: 0,
    maxHelpLevelUsedInEpisode: 0,
    maskTutorResponses: false,
    reconstructionRequired: false,
    reconstructionPassed: null,
    reconstructionError: null,
    caseCompletionBlocked: false,
    metaSocraticPrompt: getMetaSocraticPrompt(guidanceLevel, 0, 'ATTEMPT'),
    delayedRetestDueAt: null,
    retestCardId: null,
  };
}

export function canRequestSocraticTurn(machine: TutorStateMachineState): boolean {
  if (machine.state === 'RECONSTRUCT') return false;
  return machine.turnCount < MAX_SOCRATIC_TURNS;
}

export function transitionTutorEpisode(
  machine: TutorStateMachineState,
  event: TutorEpisodeEvent
): TutorStateMachineState {
  switch (event.type) {
    case 'RESET_FOR_NEW_PROBLEM':
      return createTutorStateMachineState({
        runId: machine.runId,
        problemId: event.problemId ?? machine.problemId,
        guidanceLevel: event.guidanceLevel ?? machine.guidanceLevel,
        competencyIds: machine.competencyIds,
      });

    case 'SUBMIT_ATTEMPT': {
      const check = validateStructuredAttempt(event.attempt, {
        requiresPrediction: event.requiresPrediction,
      });
      if (!check.valid) return machine;
      if (machine.state === 'RECONSTRUCT') return machine;
      return {
        ...machine,
        state: 'COMMIT',
        designStage: 'GUIDED_DIALOGUE',
        metaSocraticPrompt: getMetaSocraticPrompt(
          machine.guidanceLevel,
          machine.turnCount,
          'COMMIT'
        ),
      };
    }

    case 'RECORD_TUTOR_RESPONSE': {
      const nextTurns = Math.min(MAX_SOCRATIC_TURNS, machine.turnCount + 1);
      const nextMaxHelp = Math.max(
        machine.maxHelpLevelUsedInEpisode,
        event.response.help_level_used
      ) as HelpLevel;
      const needsReconstruct = nextMaxHelp >= 2;
      const nextState: TutorEpisodeState = needsReconstruct ? 'REVEAL' : 'COMMIT';
      const nextDesign: DesignStateStage = needsReconstruct ? 'ENGINE_REVEAL' : 'GUIDED_DIALOGUE';

      return {
        ...machine,
        state: nextState,
        designStage: nextDesign,
        turnCount: nextTurns,
        maxHelpLevelUsedInEpisode: nextMaxHelp,
        reconstructionRequired: machine.reconstructionRequired || needsReconstruct,
        caseCompletionBlocked: machine.reconstructionPassed === true ? false : needsReconstruct,
        metaSocraticPrompt: getMetaSocraticPrompt(machine.guidanceLevel, nextTurns, nextState),
      };
    }

    case 'ENGINE_COMMIT': {
      if (machine.reconstructionRequired && machine.reconstructionPassed !== true) {
        return {
          ...machine,
          state: 'RECONSTRUCT',
          designStage: 'RECONSTRUCT_REQUIRED',
          maskTutorResponses: true,
          caseCompletionBlocked: true,
          metaSocraticPrompt: getMetaSocraticPrompt(
            machine.guidanceLevel,
            machine.turnCount,
            'RECONSTRUCT'
          ),
        };
      }
      return {
        ...machine,
        state: 'REVEAL',
        designStage: 'ENGINE_REVEAL',
        caseCompletionBlocked: false,
      };
    }

    case 'START_RECONSTRUCT':
      return {
        ...machine,
        state: 'RECONSTRUCT',
        designStage: 'RECONSTRUCT_REQUIRED',
        maskTutorResponses: true,
        reconstructionRequired: true,
        caseCompletionBlocked: true,
        reconstructionError: null,
        metaSocraticPrompt: getMetaSocraticPrompt(
          machine.guidanceLevel,
          machine.turnCount,
          'RECONSTRUCT'
        ),
      };

    case 'SUBMIT_RECONSTRUCTION': {
      const check = validateCausalReconstruction(event.text);
      if (!check.valid) {
        return {
          ...machine,
          state: 'RECONSTRUCT',
          designStage: 'RECONSTRUCT_REQUIRED',
          maskTutorResponses: true,
          reconstructionPassed: false,
          reconstructionError: check.reason ?? 'Invalid causal reconstruction.',
          caseCompletionBlocked: true,
        };
      }
      const nowMs = event.nowMs ?? Date.now();
      const dueAt = nowMs + DELAYED_RETEST_INTERVAL_HOURS * 60 * 60 * 1000;
      const cardId = `retest:${machine.problemId}:${machine.competencyIds[0] ?? 'general'}`;
      return {
        ...machine,
        state: 'DELAYED_RETEST',
        designStage: 'COMPLETED',
        maskTutorResponses: true,
        reconstructionRequired: true,
        reconstructionPassed: true,
        reconstructionError: null,
        caseCompletionBlocked: false,
        delayedRetestDueAt: dueAt,
        retestCardId: cardId,
        metaSocraticPrompt: null,
      };
    }
  }
}

export interface ScheduleDelayedRetestParams {
  competencyIds: string[];
  caseId: string;
  variantId?: string;
  nowMs?: number;
  getPracticeCardStates?: () => Promise<Record<string, unknown>>;
  savePracticeCardStates?: (states: Record<string, unknown>) => Promise<void>;
}

/**
 * Schedules the mandatory +48h delayed retest after Level 2/3 assistance & reconstruction
 * both in the tutor IndexedDB retest store and in the Practice spaced-repetition card map.
 */
export async function scheduleTutorDelayedRetest(
  params: ScheduleDelayedRetestParams
): Promise<{ dueAt: number; retestIds: string[]; cardStates: Record<string, CardState> }> {
  const nowMs = params.nowMs ?? Date.now();
  const dueAt = nowMs + DELAYED_RETEST_INTERVAL_HOURS * 60 * 60 * 1000;
  const targetComps = params.competencyIds.length > 0 ? params.competencyIds : ['general'];
  const retestIds: string[] = [];

  for (const competencyId of targetComps) {
    const id = `retest_${params.caseId}_${competencyId}`;
    retestIds.push(id);
    await scheduleDelayedRetest({
      id,
      competencyId,
      caseId: params.caseId,
      variantId: params.variantId,
      dueAt,
      createdAt: nowMs,
      completedAt: null,
      passed: null,
      source: 'assisted_reveal',
    });
  }

  // Bridge into src/practice spaced-repetition scheduler (48h interval / dueDate)
  const existingMap =
    params.getPracticeCardStates ? await params.getPracticeCardStates().catch(() => ({})) : {};
  const cardStates: Record<string, CardState> = { ...(existingMap as Record<string, CardState>) };
  const dueDateIso = formatDateIso(new Date(dueAt));

  for (const competencyId of targetComps) {
    const cardKey = `delayed-retest:${params.caseId}:${competencyId}`;
    const currentCard = cardStates[cardKey] ?? createInitialCardState(cardKey, dueDateIso);
    const updatedCard = scheduleNextReview(currentCard, 'hard', new Date(nowMs));
    cardStates[cardKey] = {
      ...updatedCard,
      intervalDays: 2, // +48h exact retest horizon
      dueDate: dueDateIso,
    };
  }

  if (params.savePracticeCardStates) {
    await params.savePracticeCardStates(cardStates);
  }

  return { dueAt, retestIds, cardStates };
}
