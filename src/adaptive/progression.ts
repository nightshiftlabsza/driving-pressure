/**
 * Coherent bridge unifying Phase 7 Pathway Levels (1-4) + LearnerModel.recommend()
 * with Phase 9 Clinical Case Tiers (1-3), EPA Entrustment Levels, Mistake Ledger,
 * and Leitner Spaced Re-tests.
 *
 * Single progression contract:
 * 1. Pathway Levels (1-4) sequence curriculum breadth (Labs -> Drills -> Common Cases -> Complex ICU).
 * 2. Case Tier Entrustment (Observed -> Supervised -> Indirect -> Independent) measures
 *    clinical autonomy once inside cases and directly feeds Level 4 readiness & case ranking:
 *    - Level 4 unlock honours Pathway Level 3 competency mastery while also allowing Tier 1
 *      Indirect/Independent entrustment to surface readiness and blocking unaddressed Tier 1
 *      critical mistakes unless Browse mode is enabled.
 *    - Unified Recommendation ranks due Leitner re-tests (preferring unseen disguised variants)
 *      first, then combines LearnerModel.recommend() scores with target-tier entrustment alignment.
 */

import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import type { Recommendation } from '../shared/learnerApi';
import type { CaseVariantMetadata } from '../cases/variants/loader';
import {
  deriveEntrustmentLevels,
  getTierForCase,
  type CaseTierNumber,
  type TierEntrustmentStatus,
} from './entrustment';
import { deriveMistakeLedger } from './ledger';
import { selectNextCase } from './nextCase';
import { deriveReTestSchedule } from './schedule';

export interface UnifiedCaseRecommendation {
  caseFile: CaseFile;
  kind: 'retest' | 'recommended';
  learnerReason: string;
  debriefReason?: string;
  reasons: string[];
  tier: CaseTierNumber | null;
}

export interface UnifiedCaseRankingResult {
  entrustment: Record<CaseTierNumber, TierEntrustmentStatus>;
  targetTier: CaseTierNumber;
  topCase: UnifiedCaseRecommendation | null;
  rankedRecommendations: Recommendation[];
}

export function getTargetTier(
  entrustment: Record<CaseTierNumber, TierEntrustmentStatus>
): CaseTierNumber {
  for (const tier of [1, 2, 3] as const) {
    if (entrustment[tier].level !== 'Independent') {
      return tier;
    }
  }
  return 3;
}

export function hasTierCriticalBlocker(
  events: LearnerEvent[],
  tier: CaseTierNumber
): boolean {
  if (!events.length) return false;
  const entrustment = deriveEntrustmentLevels(events);
  if (entrustment[tier].unresolvedMistakesCount === 0) return false;
  const ledger = deriveMistakeLedger(events);
  const tierComps = new Set(entrustment[tier].keyCompetencies);
  return ledger.some(
    entry =>
      !entry.resolved &&
      tierComps.has(entry.competencyId) &&
      entry.severities.includes('critical')
  );
}

/**
 * Unifies learner.recommend() scores with EPA Tier Entrustment and due Leitner re-tests.
 * Used identically by Home (Pathway) and CaseLibrary so there is only ONE ranking rule.
 */
export function rankCasesUnified(params: {
  cases: CaseFile[];
  events: LearnerEvent[];
  learnerRecommendations: Recommendation[];
  variantsMeta?: Record<string, CaseVariantMetadata>;
  browseMode?: boolean;
  now?: Date;
}): UnifiedCaseRankingResult {
  const {
    cases,
    events,
    learnerRecommendations,
    variantsMeta = {},
    browseMode = false,
    now = new Date(),
  } = params;

  const ledger = deriveMistakeLedger(events);
  const schedule = deriveReTestSchedule(events, now);
  const entrustment = deriveEntrustmentLevels(events, { ledger, schedule, now });
  const targetTier = getTargetTier(entrustment);

  if (cases.length === 0) {
    return {
      entrustment,
      targetTier,
      topCase: null,
      rankedRecommendations: [],
    };
  }

  const completedBaseIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'run_end' && e.outcome !== 'abandoned' && e.activityId) {
      const base = e.activityId.includes('--') ? e.activityId.split('--')[0]! : e.activityId;
      completedBaseIds.add(e.activityId);
      completedBaseIds.add(base);
    }
  }

  // 1. Check due spaced re-test (disguised case variants win when due)
  const adaptiveNext = selectNextCase(cases, events, { now, variantsMeta });
  if (adaptiveNext && adaptiveNext.kind === 'retest') {
    const matched = cases.find(c => c.id === adaptiveNext.caseId);
    if (matched) {
      const tier = getTierForCase(matched.id);
      const topRec: Recommendation = {
        id: matched.id,
        score: 1,
        reasons: [adaptiveNext.learnerReason],
      };
      const rest = learnerRecommendations.filter(r => r.id !== matched.id);
      return {
        entrustment,
        targetTier,
        topCase: {
          caseFile: matched,
          kind: 'retest',
          learnerReason: adaptiveNext.learnerReason,
          debriefReason: adaptiveNext.debriefReason,
          reasons: [adaptiveNext.learnerReason],
          tier,
        },
        rankedRecommendations: [topRec, ...rest],
      };
    }
  }

  // 2. Preserve single explicit recommendation (e.g., focused test override)
  if (learnerRecommendations.length === 1) {
    const only = learnerRecommendations[0]!;
    const found = cases.find(c => c.id === only.id);
    if (found) {
      const reasons = only.reasons.length > 0
        ? only.reasons
        : [adaptiveNext?.learnerReason ?? 'Recommended for your current stage of training.'];
      return {
        entrustment,
        targetTier,
        topCase: {
          caseFile: found,
          kind: 'recommended',
          learnerReason: reasons[0]!,
          reasons,
          tier: getTierForCase(found.id),
        },
        rankedRecommendations: learnerRecommendations,
      };
    }
  }

  // 3. Re-rank learnerRecommendations using Tier Entrustment alignment & base-case preference
  const caseById = new Map(cases.map(c => [c.id, c]));
  const baseScores = new Map<string, Recommendation>(
    learnerRecommendations.map(r => [r.id, r])
  );

  const combined: Recommendation[] = cases.map(c => {
    const base = baseScores.get(c.id);
    const tier = getTierForCase(c.id);
    const isVariant = Boolean(variantsMeta[c.id]) || c.id.includes('--');
    const seen = completedBaseIds.has(c.id);

    let score = base?.score ?? 0.25;
    const reasons = [...(base?.reasons ?? [])];

    if (isVariant) {
      score -= 0.5;
    } else {
      if (tier !== null) {
        if (tier === targetTier) {
          score += seen ? 0.08 : 0.16;
          if (!browseMode && reasons.length === 0) {
            reasons.push(`Aligned with Tier ${targetTier} (${entrustment[targetTier].level}) bedside progression`);
          }
        } else if (tier > targetTier && !browseMode) {
          score -= 0.1;
        }
      }
    }

    const clamped = Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
    return {
      id: c.id,
      score: clamped,
      reasons,
    };
  });

  combined.sort((a, b) => b.score - a.score);

  const chosenRec = combined[0];
  const chosenCase = chosenRec ? caseById.get(chosenRec.id) : undefined;
  const fallbackCase = chosenCase ?? (adaptiveNext ? caseById.get(adaptiveNext.caseId) : undefined) ?? cases[0]!;
  const chosenReasons = chosenRec?.reasons.length
    ? chosenRec.reasons
    : [adaptiveNext?.learnerReason ?? `Recommended at Tier ${getTierForCase(fallbackCase.id) ?? 1}.`];

  return {
    entrustment,
    targetTier,
    topCase: {
      caseFile: fallbackCase,
      kind: 'recommended',
      learnerReason: chosenReasons[0]!,
      reasons: chosenReasons,
      tier: getTierForCase(fallbackCase.id),
    },
    rankedRecommendations: combined,
  };
}
