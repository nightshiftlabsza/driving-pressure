/**
 * Pure derivation functions for the learner model.
 * Offline, deterministic, no I/O, fully testable with synthetic event histories.
 */
import type { LearnerEvent, Confidence, GuidanceLevel, EvidenceFields } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';
import type {
  AssistanceTelemetry,
  CompetencyReasoningGrade,
  CompetencyStatus,
  CompetencyState,
  CompetencyStateV2,
  CalibrationStats,
  RunSummary,
  ActivityCandidate,
  Recommendation,
} from '../shared/learnerApi';
import type { TutorExchangeRecord, DelayedRetestRecord } from '../tutor/store';
import competenciesJson from '../shared/competencies.json';

export interface CompetencyDefinition {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
}

export interface DomainDefinition {
  id: string;
  name: string;
  competencies: CompetencyDefinition[];
}

export const COMPETENCY_DOMAINS: DomainDefinition[] = competenciesJson.domains.map(d => ({
  id: d.id,
  name: d.name,
  competencies: d.competencies.map(c => ({
    id: c.id,
    name: c.name,
    domainId: d.id,
    domainName: d.name,
  })),
}));

export const ALL_COMPETENCIES: CompetencyDefinition[] = COMPETENCY_DOMAINS.flatMap(d => d.competencies);

export const COMPETENCY_MAP = new Map<string, CompetencyDefinition>(
  ALL_COMPETENCIES.map(c => [c.id, c])
);

export const COMPETENCY_FRIENDLY_NAMES: Record<string, string> = {
  'mech.eom': 'Equation of motion',
  'mech.res-vs-comp': 'Resistance vs compliance',
  'mech.driving-pressure': 'Driving pressure',
  'mech.time-constants': 'Time constants',
  'mech.auto-peep': 'Auto-PEEP',
  'gas.oxy-vs-vent': 'Oxygenation vs ventilation',
  'gas.hypoxaemia-mechanism': 'Hypoxaemia mechanisms',
  'gas.dead-space': 'Dead space & EtCO2',
  'gas.alveolar-ventilation': 'Alveolar ventilation & PaCO2',
  'gas.acid-base': 'Acid-base balance',
  'modes.vc-vs-pc': 'VC vs PC',
  'modes.ps-spont': 'Pressure support',
  'modes.trigger-cycle': 'Trigger and cycle',
  'modes.peep-fio2': 'PEEP & FiO2 titration',
  'modes.ie-flow-ti': 'I:E & flow timing',
  'wave.normal': 'Normal waveforms',
  'wave.incomplete-exhalation': 'Incomplete exhalation',
  'wave.flow-limitation': 'Flow limitation',
  'wave.dyssynchrony': 'Patient-ventilator dyssynchrony',
  'wave.leak': 'Circuit leak',
  'disease.ards': 'ARDS lung-protective ventilation',
  'disease.obstructive': 'Obstructive lung strategy',
  'disease.restrictive-nm': 'Restrictive & neuromuscular disease',
  'disease.metabolic-acidosis': 'Metabolic acidosis response',
  'niv.selection': 'NIV/HFNC patient selection',
  'niv.titration': 'NIV pressure titration',
  'niv.interface-leak': 'NIV interface & leak',
  'niv.hfnc': 'High-flow nasal cannula',
  'niv.failure': 'NIV/HFNC failure recognition',
  'circ.ppv-preload': 'Positive pressure hemodynamics',
  'circ.auto-peep-hypotension': 'Auto-PEEP hypotension',
  'circ.rv-peep': 'PEEP & right ventricle',
  'safety.alarm-response': 'Ventilator alarm response',
  'safety.crisis': 'Deteriorating ventilated patient (DOPE)',
  'safety.reassess': 'Post-intervention reassessment',
  'safety.liberation': 'Ventilator liberation (SBT)',
  'safety.extubation': 'Extubation Readiness & Post-Extubation Care',
  'modes.dyssynchrony-management': 'Bedside Dyssynchrony Resolution',
};

export function getFriendlyCompetencyName(id: string): string {
  if (COMPETENCY_FRIENDLY_NAMES[id]) {
    return COMPETENCY_FRIENDLY_NAMES[id];
  }
  const def = COMPETENCY_MAP.get(id);
  return def ? def.name : id;
}

export const INTERVAL_LADDER = [1, 3, 7, 21, 60] as const;

export function getEventContext(e: LearnerEvent): string {
  // Drills: item-level context or drill-level context
  if (e.activity === 'drill' || e.type === 'drill_answer') {
    const drillId = ('drillId' in e && typeof e.drillId === 'string' ? e.drillId : undefined) || e.activityId;
    const itemId =
      ('itemId' in e && typeof e.itemId === 'string' ? e.itemId : undefined) ||
      (e.contextTags && e.contextTags.length > 2 ? e.contextTags[e.contextTags.length - 1] : undefined);
    if (drillId && itemId) {
      return `drill:${drillId}:${itemId}`;
    }
    if (drillId) {
      return `drill:${drillId}`;
    }
  }

  // Labs: distinguish individual lab experiments rather than collapsing into generic 'mechanics' tag
  if (e.activity === 'lab' && e.activityId && !e.activityId.startsWith('act-')) {
    return `lab:${e.activityId}`;
  }

  if (e.contextTags && e.contextTags.length > 0 && e.contextTags[0]) {
    // If context tag is generic 'mechanics' or 'drill' and a specific activityId exists, use activityId
    if ((e.contextTags[0] === 'mechanics' || e.contextTags[0] === 'drill') && e.activityId && !e.activityId.startsWith('act-')) {
      return `${e.activity || 'act'}:${e.activityId}`;
    }
    return e.contextTags[0];
  }

  return e.activityId || 'default';
}

export const CONFIDENCE_PROBABILITY: Record<Confidence, number> = {
  guess: 0.33,
  fairly_sure: 0.67,
  certain: 0.95,
};

/**
 * Practice (spaced-review card) evidence is self-marked by the learner, not graded by the
 * engine or system. It counts as weaker evidence and can never be the only basis for 'independent'.
 */
export const SELF_MARKED_SESSION_ID = 'practice-session';
export const SELF_MARKED_WEIGHT = 0.5;

export function isSelfMarkedEvidence(e: { sessionId?: string }): boolean {
  return e.sessionId === SELF_MARKED_SESSION_ID;
}

export const RETEST_DELAY_MS_48H = 48 * 60 * 60 * 1000;
export const TRANSFER_RETEST_DELAY_MS_5D = 5 * 24 * 60 * 60 * 1000;

export function computeAssistanceMultiplier(
  assistance?: AssistanceTelemetry,
  fallbackGuidance?: GuidanceLevel
): number {
  if (assistance) {
    if (!assistance.assistedInWindow) return 1.0;
    if (assistance.maxHelpLevelUsed === 0) return 0.5;
    if (assistance.maxHelpLevelUsed === 1) return 0.15;
    return 0.0;
  }
  if (fallbackGuidance === 'independent') return 1.0;
  if (fallbackGuidance === 'prompted') return 0.5;
  return 0.15;
}

export function computeQualityMultiplier(
  confidence?: Confidence,
  reasoningGrade?: CompetencyReasoningGrade | string
): number {
  if (
    reasoningGrade === 'correct_conclusion_wrong_reasoning' ||
    reasoningGrade === 'right_action_wrong_reason'
  ) {
    return 0.0;
  }
  if (confidence === 'guess') return 0.25;
  return 1.0;
}

export function computeLlmReasoningModifier(
  reasoningGrade?: CompetencyReasoningGrade | string,
  causalNodesVerified?: boolean
): number {
  if (reasoningGrade === 'correct_justified' && causalNodesVerified !== false) {
    return 0.1;
  }
  if (reasoningGrade === 'correct_superficial') {
    return -0.15;
  }
  return 0.0;
}

export function computeEvidenceEntrustmentContribution(params: {
  correct: boolean;
  confidence?: Confidence;
  assistance?: AssistanceTelemetry;
  fallbackGuidance?: GuidanceLevel;
  reasoningGrade?: CompetencyReasoningGrade | string;
  causalNodesVerified?: boolean;
}): number {
  if (!params.correct) return 0;
  const alphaHelp = computeAssistanceMultiplier(params.assistance, params.fallbackGuidance);
  const betaQual = computeQualityMultiplier(params.confidence, params.reasoningGrade);
  const base = alphaHelp * betaQual;
  if (base === 0) return 0;
  const rawGamma = computeLlmReasoningModifier(params.reasoningGrade, params.causalNodesVerified);
  const boundedGamma = Math.max(-0.15, Math.min(0.15, rawGamma));
  return Math.round(base * (1 + boundedGamma) * 10000) / 10000;
}

export function computeBrierScore(
  events: readonly { correct: boolean; confidence?: Confidence }[]
): number {
  let sumSq = 0;
  let count = 0;
  for (const ev of events) {
    if (!ev.confidence || !(ev.confidence in CONFIDENCE_PROBABILITY)) continue;
    const p = CONFIDENCE_PROBABILITY[ev.confidence];
    const y = ev.correct ? 1 : 0;
    sumSq += (p - y) * (p - y);
    count++;
  }
  if (count === 0) return 0;
  return Math.round((sumSq / count) * 10000) / 10000;
}

export interface DeriveCompetencyOptions {
  tutorExchanges?: TutorExchangeRecord[];
  delayedRetests?: DelayedRetestRecord[];
  requireBlindProbe?: boolean;
}

/**
 * Pure function deriving CompetencyStateV2[] for every competency in competencies.json.
 */
export function deriveCompetencyStates(
  events: LearnerEvent[],
  now?: Date,
  guidanceOverrides: Record<string, GuidanceLevel> = {},
  options?: DeriveCompetencyOptions
): CompetencyStateV2[] {
  const result: CompetencyStateV2[] = [];
  const tutorExchanges = options?.tutorExchanges ?? [];
  const delayedRetests = options?.delayedRetests ?? [];
  const hintEvents = events.filter(
    (e): e is Extract<LearnerEvent, { type: 'hint_shown' }> => e.type === 'hint_shown'
  );

  for (const compDef of ALL_COMPETENCIES) {
    const compId = compDef.id;
    const guidanceOverride = guidanceOverrides[compId] ?? null;

    // Filter and sort evidence events for this competency chronologically
    const compEventsWithIndex: { event: Extract<LearnerEvent, EvidenceFields>; index: number }[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (isEvidenceEvent(e) && e.competency === compId) {
        compEventsWithIndex.push({ event: e, index: i });
      }
    }

    compEventsWithIndex.sort((a, b) => {
      const diff = new Date(a.event.wallTime).getTime() - new Date(b.event.wallTime).getTime();
      return diff !== 0 ? diff : a.index - b.index;
    });

    const compEvents = compEventsWithIndex.map(item => item.event);

    // Filter mistake events for this competency
    const compMistakes = events.filter(
      (e): e is Extract<LearnerEvent, { type: 'mistake' }> =>
        e.type === 'mistake' && e.competency === compId
    );

    const openStoreRetests = delayedRetests
      .filter(r => r.competencyId === compId && r.completedAt === null)
      .sort((a, b) => a.dueAt - b.dueAt);

    // Compute calibration
    const calibration: CalibrationStats = {
      byConfidence: {
        guess: { answered: 0, correct: 0 },
        fairly_sure: { answered: 0, correct: 0 },
        certain: { answered: 0, correct: 0 },
      },
    };

    for (const ev of compEvents) {
      if (ev.confidence && (ev.confidence === 'guess' || ev.confidence === 'fairly_sure' || ev.confidence === 'certain')) {
        calibration.byConfidence[ev.confidence].answered++;
        if (ev.correct) {
          calibration.byConfidence[ev.confidence].correct++;
        }
      }
    }
    const brierCalibrationScore = computeBrierScore(compEvents);

    // Compute top mistakes
    const mistakeCounts = new Map<string, number>();
    for (const me of compMistakes) {
      mistakeCounts.set(me.mistake, (mistakeCounts.get(me.mistake) ?? 0) + 1);
    }
    const topMistakes = Array.from(mistakeCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([mistake, count]) => ({ mistake, count }));

    // If no evidence, state is not_seen
    if (compEvents.length === 0) {
      result.push({
        competency: compId,
        status: 'not_seen',
        guidance: guidanceOverride ?? 'guided',
        guidanceOverride,
        dueAt: null,
        intervalDays: null,
        evidenceCount: 0,
        correctCount: 0,
        contextsCorrect: [],
        lastEvidenceAt: null,
        calibration,
        topMistakes,
        unaidedEntrustmentScore: 0,
        assistedSuccessCount: 0,
        unaidedSuccessContexts: [],
        pendingDelayedRetestDueAt: openStoreRetests[0]?.dueAt ?? null,
        pendingTransferVariantId: openStoreRetests.find(r => r.variantId)?.variantId ?? null,
        brierCalibrationScore: 0,
      });
      continue;
    }

    const hasV2Telemetry =
      options?.requireBlindProbe === true ||
      compEvents.some(
        e =>
          e.assistance !== undefined ||
          e.isDelayedRetest !== undefined ||
          e.isTransferVariant !== undefined ||
          e.reasoningGrade !== undefined ||
          e.tutorMode !== undefined
      );

    // Process evidence chronologically through status & interval ladder
    let ladderIndex = 0; // Starts at index 0 (1 day)
    let status: CompetencyStatus = 'practising';
    let masteredAt: string | null = null;
    let retained7DayEventTime: string | null = null;
    const allIndependentContexts = new Set<string>();
    const unaidedSuccessContexts = new Set<string>();
    const currentIndependentContexts = new Set<string>();
    const currentSystemGradedContexts = new Set<string>();
    const currentScoredContexts = new Set<string>();
    const seenContexts = new Set<string>();
    let currentCycleScore = 0;
    let assistedSuccessCount = 0;
    let hasBlindOrTransferSuccessInCycle = false;
    let derivedPendingRetestDueAt: number | null = null;
    let derivedPendingTransferVariantId: string | null = null;

    const safetyBreachKeys = new Set<string>();
    for (const me of compMistakes) {
      if (me.severity === 'critical' || me.mistake === 'unsafe_action') {
        safetyBreachKeys.add(me.runId ?? me.id);
      }
    }
    for (const ce of compEvents) {
      if (ce.type === 'rubric_result' && !ce.met && ce.critical) {
        safetyBreachKeys.add(ce.runId ?? ce.id);
      }
    }
    const recentRunKeys: string[] = [];

    for (let i = 0; i < compEvents.length; i++) {
      const e = compEvents[i];
      const ctx = getEventContext(e);
      const isNovel = !seenContexts.has(ctx);
      seenContexts.add(ctx);

      const runKey = e.runId ?? e.id;
      if (!recentRunKeys.includes(runKey)) {
        recentRunKeys.push(runKey);
      }
      const lastThreeRuns = recentRunKeys.slice(-3);
      const hasCriticalSafetyInLast3Runs = lastThreeRuns.some(k => safetyBreachKeys.has(k));

      let effectiveAssistance: AssistanceTelemetry | undefined = e.assistance;
      if (!effectiveAssistance && (e.runId || hintEvents.length > 0)) {
        const matchingExchanges = e.runId
          ? tutorExchanges.filter(
              ex =>
                ex.runId === e.runId &&
                ex.assisted !== false &&
                (!ex.competencyIds?.length || ex.competencyIds.includes(compId))
            )
          : [];
        const evTimeMs = new Date(e.wallTime).getTime();
        const matchingHints = hintEvents.filter(h => {
          if (h.competency && h.competency !== compId) return false;
          if (new Date(h.wallTime).getTime() > evTimeMs) return false;
          if (e.runId && h.runId) return h.runId === e.runId;
          return !e.runId && !h.runId && h.sessionId === e.sessionId;
        });

        if (matchingExchanges.length > 0 || matchingHints.length > 0) {
          let maxLvl: 0 | 1 | 2 | 3 = 0;
          for (const ex of matchingExchanges) {
            const lvl = (ex.levelUsed ?? ex.cap ?? 1) as 0 | 1 | 2 | 3;
            if (lvl > maxLvl) maxLvl = lvl;
          }
          for (const h of matchingHints) {
            if (h.level > maxLvl) maxLvl = h.level;
          }
          effectiveAssistance = {
            assistedInWindow: true,
            maxHelpLevelUsed: maxLvl,
            hintCountInProblem: matchingExchanges.length + matchingHints.length,
            tutorTurnsBeforeCommit: matchingExchanges.length,
            reconstructionPassed:
              matchingExchanges.find(ex => typeof ex.reconstructionPassed === 'boolean')
                ?.reconstructionPassed ?? null,
            timeToFirstHypothesisMs: 0,
          };
        }
      }

      const alphaHelp = computeAssistanceMultiplier(effectiveAssistance, e.guidance);
      const betaQual = computeQualityMultiplier(e.confidence, e.reasoningGrade);
      const selfMarked = isSelfMarkedEvidence(e);
      const s_raw = computeEvidenceEntrustmentContribution({
        correct: e.correct,
        confidence: e.confidence,
        assistance: effectiveAssistance,
        fallbackGuidance: e.guidance,
        reasoningGrade: e.reasoningGrade,
        causalNodesVerified: e.causalNodesVerified,
      });
      const s_i = selfMarked ? Math.round(s_raw * SELF_MARKED_WEIGHT * 10000) / 10000 : s_raw;
      const isUnaided = alphaHelp === 1.0 && betaQual > 0 && e.guidance === 'independent';

      const isConfidentError = e.confidence === 'certain' && !e.correct;
      const isFailedUnaidedRetestOrTransfer =
        !e.correct && alphaHelp === 1.0 && Boolean(e.isDelayedRetest || e.isTransferVariant);

      // Interval ladder transition
      if (isConfidentError || isFailedUnaidedRetestOrTransfer) {
        ladderIndex = 0;
      } else if (!e.correct) {
        ladderIndex = Math.max(0, ladderIndex - 1);
      } else if (alphaHelp > 0) {
        ladderIndex = Math.min(INTERVAL_LADDER.length - 1, ladderIndex + 1);
      } else {
        ladderIndex = 0;
      }

      // Pending delayed retest / transfer bookkeeping
      if (alphaHelp === 0 && e.correct) {
        derivedPendingRetestDueAt = new Date(e.wallTime).getTime() + RETEST_DELAY_MS_48H;
      }
      if (e.isTransferVariant && !e.correct) {
        derivedPendingRetestDueAt = new Date(e.wallTime).getTime() + TRANSFER_RETEST_DELAY_MS_5D;
        if (e.transferVariantId) {
          derivedPendingTransferVariantId = e.transferVariantId;
        }
      }
      if (e.isDelayedRetest && e.correct && isUnaided) {
        derivedPendingRetestDueAt = null;
      }
      if (e.isTransferVariant && e.correct && isUnaided) {
        derivedPendingTransferVariantId = null;
        if (derivedPendingRetestDueAt !== null) {
          derivedPendingRetestDueAt = null;
        }
      }

      // Status ladder transition
      if (isConfidentError || isFailedUnaidedRetestOrTransfer) {
        if (status === 'retained') {
          status = 'mastered';
          retained7DayEventTime = null;
        } else if (status === 'mastered') {
          status = 'independent';
          masteredAt = null;
          retained7DayEventTime = null;
        } else if (status === 'independent') {
          status = 'practising';
          currentIndependentContexts.clear();
          currentSystemGradedContexts.clear();
          currentScoredContexts.clear();
          currentCycleScore = 0;
          hasBlindOrTransferSuccessInCycle = false;
        }
      } else if (e.correct) {
        if (alphaHelp < 1.0) {
          assistedSuccessCount++;
        }
        if (s_i > 0) {
          currentCycleScore = Math.round((currentCycleScore + s_i) * 10000) / 10000;
          currentScoredContexts.add(ctx);
        }
        if (isUnaided) {
          allIndependentContexts.add(ctx);
          unaidedSuccessContexts.add(ctx);
          currentIndependentContexts.add(ctx);
          if (!selfMarked) currentSystemGradedContexts.add(ctx);
          if (e.hidden || e.isTransferVariant) {
            hasBlindOrTransferSuccessInCycle = true;
          }
        }

        if (status === 'practising') {
          if (
            currentCycleScore >= 2.0 &&
            currentScoredContexts.size >= 2 &&
            currentIndependentContexts.size >= 1 &&
            currentSystemGradedContexts.size >= 1
          ) {
            status = 'independent';
          }
        } else if (status === 'independent') {
          const satisfiesBlindOrTransfer = !hasV2Telemetry || hasBlindOrTransferSuccessInCycle;
          if (
            isUnaided &&
            (isNovel || Boolean(e.isTransferVariant)) &&
            !selfMarked &&
            (e.confidence === 'fairly_sure' || e.confidence === 'certain') &&
            currentIndependentContexts.size >= 2 &&
            !hasCriticalSafetyInLast3Runs &&
            satisfiesBlindOrTransfer
          ) {
            status = 'mastered';
            masteredAt = e.wallTime;
            retained7DayEventTime = null;
          }
        } else if (status === 'mastered' && masteredAt !== null) {
          if ((e.hidden || e.isDelayedRetest) && isUnaided) {
            const daysSinceMastered =
              (new Date(e.wallTime).getTime() - new Date(masteredAt).getTime()) / (1000 * 60 * 60 * 24);
            if (retained7DayEventTime === null) {
              if (daysSinceMastered >= 7) {
                retained7DayEventTime = e.wallTime;
              }
            } else if (e.wallTime !== retained7DayEventTime) {
              if (daysSinceMastered >= 21) {
                status = 'retained';
              }
            }
          }
        }
      }
    }

    const lastEvidenceAt = compEvents[compEvents.length - 1].wallTime;
    const intervalDays = INTERVAL_LADDER[ladderIndex];
    const lastDate = new Date(lastEvidenceAt);
    const dueAt = new Date(lastDate.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

    // Guidance level
    let guidance: GuidanceLevel;
    if (guidanceOverride) {
      guidance = guidanceOverride;
    } else {
      const last3 = compEvents.slice(-3);
      const wrongCount = last3.filter(a => !a.correct).length;
      if (wrongCount >= 2) {
        guidance = 'guided';
      } else if (
        (status === 'independent' || status === 'mastered' || status === 'retained') &&
        compEvents[compEvents.length - 1].correct
      ) {
        guidance = 'independent';
      } else {
        guidance = 'prompted';
      }
    }

    const storeDueAt = openStoreRetests[0]?.dueAt ?? null;
    const storeVariantId = openStoreRetests.find(r => r.variantId)?.variantId ?? null;

    result.push({
      competency: compId,
      status,
      guidance,
      guidanceOverride,
      dueAt,
      intervalDays,
      evidenceCount: compEvents.length,
      correctCount: compEvents.filter(e => e.correct).length,
      contextsCorrect: Array.from(allIndependentContexts),
      lastEvidenceAt,
      calibration,
      topMistakes,
      unaidedEntrustmentScore: currentCycleScore,
      assistedSuccessCount,
      unaidedSuccessContexts: Array.from(unaidedSuccessContexts),
      pendingDelayedRetestDueAt: storeDueAt ?? derivedPendingRetestDueAt,
      pendingTransferVariantId: storeVariantId ?? derivedPendingTransferVariantId,
      brierCalibrationScore,
    });
  }

  return result;
}

/**
 * Pure function deriving a RunSummary for a specific runId from events.
 */
export function deriveRun(events: LearnerEvent[], runId: string): (RunSummary & { contextTags?: string[] }) | null {
  const runEvents = events.filter(e => e.runId === runId);
  if (runEvents.length === 0) {
    return null;
  }

  const runStart = runEvents.find(e => e.type === 'run_start');
  const runEnd = runEvents.find(
    (e): e is Extract<LearnerEvent, { type: 'run_end' }> => e.type === 'run_end'
  );

  const activity = runEvents.find(e => e.activity)?.activity ?? 'case';
  const activityId = runEvents.find(e => e.activityId)?.activityId ?? '';
  const activityVersion = runEvents.find(e => e.activityVersion)?.activityVersion;
  const contextTags = runEvents.find(e => e.contextTags && e.contextTags.length > 0)?.contextTags;

  const startedAt = runStart?.wallTime ?? runEvents[0].wallTime;
  const endedAt = runEnd?.wallTime ?? null;
  const outcome = runEnd?.outcome ?? null;

  const predictions = runEvents
    .filter(
      (e): e is Extract<LearnerEvent, { type: 'prediction' }> => e.type === 'prediction'
    )
    .map(e => ({
      predictionId: e.predictionId,
      question: e.question,
      answer: e.answer,
      expected: e.expected,
      correct: e.correct,
      confidence: e.confidence,
      competency: e.competency,
    }));

  const rubric = runEvents
    .filter(
      (e): e is Extract<LearnerEvent, { type: 'rubric_result' }> => e.type === 'rubric_result'
    )
    .map(e => ({
      rubricId: e.rubricId,
      met: e.met,
      critical: e.critical,
      competency: e.competency,
    }));

  const mistakes = runEvents
    .filter(
      (e): e is Extract<LearnerEvent, { type: 'mistake' }> => e.type === 'mistake'
    )
    .map(e => ({
      mistake: e.mistake,
      competency: e.competency,
      severity: e.severity,
      detail: e.detail,
    }));

  const ordersTimeline = runEvents
    .filter((e): e is Extract<LearnerEvent, { type: 'order' }> => e.type === 'order')
    .sort((a, b) => (a.simTimeSec ?? 0) - (b.simTimeSec ?? 0))
    .map(e => ({
      simTimeSec: e.simTimeSec ?? 0,
      order: typeof e.order === 'string' ? e.order : JSON.stringify(e.order),
    }));

  const score = runEnd?.score ?? (rubric.length > 0 ? rubric.filter(r => r.met).length : null);
  const maxScore = runEnd?.maxScore ?? (rubric.length > 0 ? rubric.length : null);

  return {
    runId,
    activity,
    activityId,
    activityVersion,
    startedAt,
    endedAt,
    outcome,
    score,
    maxScore,
    predictions,
    rubric,
    mistakes,
    ordersTimeline,
    ...(contextTags ? { contextTags } : {}),
  };
}

/**
 * Pure function scoring and ranking activity candidates.
 * Formula: 0.35 x due + 0.30 x weak + 0.20 x curriculum + 0.15 x novelty.
 * Hidden competencies count for scoring but are NEVER mentioned in reasons.
 */
export function recommend(
  states: CompetencyState[],
  candidates: ActivityCandidate[],
  recentRuns: RunSummary[],
  now: Date = new Date(),
  events?: LearnerEvent[]
): Recommendation[] {
  const stateMap = new Map<string, CompetencyState>(states.map(s => [s.competency, s]));

  // 1. Identify earliest domain with not-yet-independent competencies in competencies.json order
  let targetDomainId: string | null = null;
  let targetDomainName: string | null = null;
  for (const domain of COMPETENCY_DOMAINS) {
    const hasIncomplete = domain.competencies.some(comp => {
      const st = stateMap.get(comp.id);
      return !st || st.status === 'not_seen' || st.status === 'practising';
    });
    if (hasIncomplete) {
      targetDomainId = domain.id;
      targetDomainName = domain.name;
      break;
    }
  }

  // 2. Identify last run's first context tag
  let lastRunFirstContextTag: string | null = null;
  if (recentRuns.length > 0) {
    const lastRun = recentRuns[0];
    const withTags = lastRun as { contextTags?: string[] };
    if (withTags.contextTags && withTags.contextTags.length > 0) {
      lastRunFirstContextTag = withTags.contextTags[0];
    } else if (events) {
      const match = events.find(e => e.runId === lastRun.runId && e.contextTags && e.contextTags.length > 0);
      if (match && match.contextTags && match.contextTags.length > 0) {
        lastRunFirstContextTag = match.contextTags[0];
      }
    }
  }

  // 3. Track competencies with recent confident errors (from recent runs or last evidence event)
  const confidentErrorComps = new Set<string>();
  for (const run of recentRuns) {
    if (run && Array.isArray(run.predictions)) {
      for (const pred of run.predictions) {
        if (!pred.correct && pred.confidence === 'certain') {
          confidentErrorComps.add(pred.competency);
        }
      }
    }
  }
  if (events) {
    for (const compDef of ALL_COMPETENCIES) {
      const compEvs = events.filter(isEvidenceEvent).filter(e => e.competency === compDef.id);
      if (compEvs.length > 0) {
        compEvs.sort((a, b) => new Date(a.wallTime).getTime() - new Date(b.wallTime).getTime());
        const lastEv = compEvs[compEvs.length - 1];
        if (!lastEv.correct && lastEv.confidence === 'certain') {
          confidentErrorComps.add(compDef.id);
        }
      }
    }
  }

  // 4. Comfort-trap detection: >2 consecutive runs on already-independent/mastered/retained competencies
  let consecutiveComfortRuns = 0;
  for (const run of recentRuns) {
    const touchedComps = new Set<string>();
    for (const p of run.predictions ?? []) touchedComps.add(p.competency);
    for (const r of run.rubric ?? []) touchedComps.add(r.competency);
    for (const m of run.mistakes ?? []) touchedComps.add(m.competency);
    if (touchedComps.size === 0) break;
    const allAlreadyMasteredOrIndepAndNotDue = Array.from(touchedComps).every(id => {
      const s = stateMap.get(id);
      if (!s) return false;
      const strong = s.status === 'independent' || s.status === 'mastered' || s.status === 'retained';
      const isDue = s.dueAt !== null && new Date(s.dueAt).getTime() <= now.getTime();
      return strong && !isDue && !confidentErrorComps.has(id);
    });
    if (allAlreadyMasteredOrIndepAndNotDue) {
      consecutiveComfortRuns++;
    } else {
      break;
    }
  }

  const comfortTrapActive = consecutiveComfortRuns >= 3;
  const weights = comfortTrapActive
    ? { due: 0.40, weak: 0.40, curriculum: 0.10, novelty: 0.10 }
    : { due: 0.35, weak: 0.30, curriculum: 0.20, novelty: 0.15 };

  // Score each candidate
  const recommendations: Recommendation[] = candidates.map(candidate => {
    const allComps = Array.from(new Set([...candidate.competencies, ...(candidate.hiddenCompetencies || [])]));
    const hiddenSet = new Set(candidate.hiddenCompetencies || []);
    const visibleComps = candidate.competencies.filter(id => !hiddenSet.has(id));

    let dueShare = 0;
    let weakShare = 0;
    let curriculumShare = 0;

    if (allComps.length > 0) {
      const dueCount = allComps.filter(id => {
        const s = stateMap.get(id);
        return s && s.dueAt !== null && new Date(s.dueAt).getTime() <= now.getTime();
      }).length;
      dueShare = dueCount / allComps.length;

      const weakCount = allComps.filter(id => {
        const s = stateMap.get(id);
        return (s && s.status === 'practising') || confidentErrorComps.has(id);
      }).length;
      weakShare = weakCount / allComps.length;

      if (targetDomainId) {
        const currCount = allComps.filter(id => {
          const def = COMPETENCY_MAP.get(id);
          return def && def.domainId === targetDomainId;
        }).length;
        curriculumShare = currCount / allComps.length;
      } else {
        curriculumShare = 1;
      }
    }

    const candidateFirstTag = candidate.contextTags && candidate.contextTags.length > 0 ? candidate.contextTags[0] : null;
    const noveltyShare =
      !lastRunFirstContextTag || !candidateFirstTag || candidateFirstTag !== lastRunFirstContextTag ? 1 : 0;

    let rawScore =
      weights.due * dueShare +
      weights.weak * weakShare +
      weights.curriculum * curriculumShare +
      weights.novelty * noveltyShare;

    if (
      comfortTrapActive &&
      dueShare === 0 &&
      weakShare === 0 &&
      allComps.some(id => {
        const st = stateMap.get(id)?.status;
        return st === 'independent' || st === 'mastered' || st === 'retained';
      })
    ) {
      rawScore = Math.max(0, rawScore - 0.05);
    }

    const score = Math.round(rawScore * 1000) / 1000;

    // Plain-language reasons (strictly for visible competencies, NEVER hidden)
    const reasons: string[] = [];

    // Due reasons
    for (const compId of visibleComps) {
      const s = stateMap.get(compId);
      if (s && s.dueAt !== null && new Date(s.dueAt).getTime() <= now.getTime()) {
        const friendly = getFriendlyCompetencyName(compId);
        reasons.push(`${friendly} is due for review`);
      }
    }

    // Weak reasons
    for (const compId of visibleComps) {
      const s = stateMap.get(compId);
      if ((s && s.status === 'practising') || confidentErrorComps.has(compId)) {
        const friendly = getFriendlyCompetencyName(compId);
        reasons.push(`${friendly} needs practice`);
      }
    }

    // Curriculum reasons
    if (targetDomainId && targetDomainName) {
      const hasDomainComp = visibleComps.some(id => COMPETENCY_MAP.get(id)?.domainId === targetDomainId);
      if (hasDomainComp) {
        reasons.push(`Advances core curriculum in ${targetDomainName}`);
      }
    }

    // Novelty reason
    if (noveltyShare === 1 && candidateFirstTag) {
      reasons.push(`New clinical context (${candidateFirstTag})`);
    }

    // Deduplicate and filter reasons against any hidden competency name or ID
    const uniqueReasons = Array.from(new Set(reasons));
    const safeReasons = uniqueReasons.filter(reason => {
      const lowerReason = reason.toLowerCase();
      for (const hid of hiddenSet) {
        if (lowerReason.includes(hid.toLowerCase())) return false;
        const compDef = COMPETENCY_MAP.get(hid);
        if (compDef && lowerReason.includes(compDef.name.toLowerCase())) return false;
        const friendly = COMPETENCY_FRIENDLY_NAMES[hid];
        if (friendly && lowerReason.includes(friendly.toLowerCase())) return false;
      }
      return true;
    });

    return {
      id: candidate.id,
      score,
      reasons: safeReasons,
    };
  });

  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}
