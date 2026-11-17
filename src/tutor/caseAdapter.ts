import type { CaseFile } from '../shared/caseSchema';
import { currentPrediction, type RunState } from '../runtime/caseRuntime';
import type {
  HelpLevel,
  LearnerRequestKind,
  StructuredLearnerAttempt,
  TutorMode,
} from './types';
import { computeHelpLevelCap } from './policy';
import { buildActiveCaseContext } from './context';
import { getForbiddenTermsForCompetencies } from './forbiddenTerms';

export interface CaseTutorAdapter {
  getContext: (attempt?: StructuredLearnerAttempt) => string;
  getCap: (
    requestKind?: LearnerRequestKind,
    learnerText?: string,
    attempt?: StructuredLearnerAttempt,
    tutorMode?: TutorMode
  ) => HelpLevel;
  forbiddenPhrases: string[];
  getForbiddenPhrases: () => string[];
  getVerifiedEngineNumbers: () => Record<string, number>;
  getActiveAbnormalities: () => string[];
  competencyIds: string[];
}

/**
 * Creates the tutor adapter for an active simulation run.
 * Provides dynamic context generation on button press and dynamic help-level cap computation.
 */
export function createCaseTutorAdapter(
  run: RunState,
  caseFile: CaseFile = run.caseFile
): CaseTutorAdapter {
  const c = caseFile;
  const baseForbiddenPhrases = getForbiddenTermsForCompetencies(c.hiddenCompetencies || []);

  const getForbiddenPhrases = (): string[] => {
    const phrases = new Set<string>(baseForbiddenPhrases);
    const pendingPred = currentPrediction(run);
    if (pendingPred) {
      if (pendingPred.explanation) phrases.add(pendingPred.explanation);
      if (typeof pendingPred.answerKey === 'string' && pendingPred.answerKey.trim().length >= 3) {
        phrases.add(pendingPred.answerKey);
      }
    }
    return Array.from(phrases);
  };

  const getContext = (attempt?: StructuredLearnerAttempt): string => {
    return buildActiveCaseContext(run, attempt).contextText;
  };

  const getVerifiedEngineNumbers = (): Record<string, number> => {
    return buildActiveCaseContext(run).verifiedEngineNumbers ?? {};
  };

  const getActiveAbnormalities = (): string[] => {
    return buildActiveCaseContext(run).activeAbnormalities ?? [];
  };

  const getCap = (
    requestKind?: LearnerRequestKind,
    learnerText?: string,
    attempt?: StructuredLearnerAttempt,
    tutorMode?: TutorMode
  ): HelpLevel => {
    // 1. Guidance level across case competencies (lowest level wins: guided < prompted < independent)
    const compList = c.competencies || [];
    let guidanceLevel: 'guided' | 'prompted' | 'independent' = 'prompted';

    if (compList.length > 0) {
      let hasGuided = false;
      let hasPrompted = false;
      for (const comp of compList) {
        const g = run.guidance?.[comp] ?? 'prompted';
        if (g === 'guided') hasGuided = true;
        else if (g === 'prompted') hasPrompted = true;
      }
      if (hasGuided) {
        guidanceLevel = 'guided';
      } else if (hasPrompted) {
        guidanceLevel = 'prompted';
      } else {
        guidanceLevel = 'independent';
      }
    }

    // 2. Probe active & committed check (also lock whenever a prediction modal is pending commitment)
    const pendingPred = currentPrediction(run);
    const isProbe = (c.hiddenCompetencies || []).length > 0 || pendingPred !== null;
    const hasTreatmentOrder = run.orders.some(
      o => !['abg', 'cxr', 'examine', 'call-senior'].includes(o.order)
    );
    const hasAnsweredPrediction = (run.predictionResults || []).length > 0;
    const hasCommittedDecision = pendingPred !== null ? false : (hasTreatmentOrder || hasAnsweredPrediction);

    // 3. Failed attempts, confident errors, and correct guess from predictionResults
    const preds = run.predictionResults || [];
    const failedAttemptsCount = preds.filter(p => !p.correct).length;
    const hasConfidentError = preds.some(
      p => !p.correct && p.confidence === 'certain'
    );
    const latestPred = preds.length > 0 ? preds[preds.length - 1] : null;
    const isCorrectGuess = Boolean(latestPred && latestPred.correct && latestPred.confidence === 'guess');

    // 4. Immediate danger / Exception A vitals: SpO2 < 85%, MAP < 55 mmHg, pH < 7.10, Pplat > 35 cmH2O
    const m = run.engine.monitored;
    const latestAbg = run.abgs.length > 0 ? run.abgs[run.abgs.length - 1] : null;
    const pplat =
      run.lastManoeuvre?.kind === 'insp-hold' && run.lastManoeuvre.valid
        ? run.lastManoeuvre.pplatCmH2O
        : undefined;
    const isImmediateDanger =
      m.spo2Pct < 85 ||
      m.mapMmHg < 55 ||
      (latestAbg ? latestAbg.ph < 7.1 : false) ||
      (typeof pplat === 'number' && pplat > 35);

    const isStuck = Boolean(learnerText && learnerText.toLowerCase().includes('stuck'));

    return computeHelpLevelCap({
      guidanceLevel,
      isProbe,
      hasCommittedDecision,
      failedAttemptsCount,
      hasConfidentError,
      isCorrectGuess,
      isStuck,
      isImmediateDanger,
      vitals: {
        spo2Pct: m.spo2Pct,
        mapMmHg: m.mapMmHg,
        ph: latestAbg?.ph,
        pplatCmH2O: pplat,
      },
      attemptNumberInProblem: attempt?.attemptNumberInProblem ?? 1,
      tutorMode,
      learnerRequest: requestKind,
      learnerMessage: learnerText,
      contextKind: 'active_case',
    });
  };

  return {
    getContext,
    getCap,
    forbiddenPhrases: getForbiddenPhrases(),
    getForbiddenPhrases,
    getVerifiedEngineNumbers,
    getActiveAbnormalities,
    competencyIds: [...(c.competencies || []), ...(c.hiddenCompetencies || [])],
  };
}
