/**
 * Adaptive next-case selection.
 *
 * Chooses between:
 * 1. A due re-test (disguised case variant or base case targeting an active Leitner box mistake),
 * 2. New learning / curriculum advancement with interleaving across clinical domains.
 *
 * CRITICAL RULE:
 * The one-line reason shown to the learner before the run must NOT give away what is being tested.
 * The full pedagogical reason is stored for post-run debriefing.
 */

import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';
import { deriveMistakeLedger, getHypercorrectionCandidates } from './ledger';
import { deriveReTestSchedule, getDueReTests, type ReTestScheduleItem } from './schedule';
import type { CaseVariantMetadata } from '../cases/variants/loader';

export interface NextCaseRecommendation {
  caseId: string;
  kind: 'retest' | 'new_learning';
  /** Clinical learner-facing line: never reveals diagnosis, hidden targets, or mistake */
  learnerReason: string;
  /** Full educational audit line: recorded for debrief */
  debriefReason: string;
  priorityScore: number;
  targetMistake?: {
    mistakeId: string;
    competencyId: string;
    box: number;
    overdueDays: number;
  };
}

const NEUTRAL_RETEST_REASONS = [
  'Chosen to revisit clinical patterns from earlier runs.',
  'Selected to reinforce practical decision-making in acute respiratory care.',
  'Follow-up case scheduled to consolidate bedside titration decisions.',
  'Practice scenario selected to solidify clinical management under changing physiology.',
];

/**
 * Pure function selecting the optimal next case or variant for the learner.
 */
export function selectNextCase(
  candidates: CaseFile[],
  events: LearnerEvent[] = [],
  options: {
    now?: Date;
    variantsMeta?: Record<string, CaseVariantMetadata>;
  } = {}
): NextCaseRecommendation | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const now = options.now ?? new Date();
  const variantsMeta = options.variantsMeta ?? {};

  // 1. Analyze learner history
  const ledger = deriveMistakeLedger(events);
  const schedule = deriveReTestSchedule(events, now);
  const dueReTests = getDueReTests(schedule, now);

  const runsSeen = new Set<string>();
  const runOutcomes: Array<{ runId: string; caseId: string; wallTime: string; contextTags?: string[] }> = [];

  for (const e of events) {
    if (e.activityId) {
      runsSeen.add(e.activityId);
    }
    if (e.type === 'run_end' && e.runId) {
      runOutcomes.push({
        runId: e.runId,
        caseId: e.activityId || '',
        wallTime: e.wallTime,
        contextTags: e.contextTags,
      });
    }
  }

  runOutcomes.sort((a, b) => new Date(b.wallTime).getTime() - new Date(a.wallTime).getTime());
  const lastRun = runOutcomes.length > 0 ? runOutcomes[0] : null;

  // 2. Priority 1: Due Re-tests
  if (dueReTests.length > 0) {
    // Prioritize high-confidence errors (hypercorrection) and more overdue re-tests
    const hypercorrectionKeys = new Set(getHypercorrectionCandidates(ledger).map(h => h.key));

    const sortedDue = [...dueReTests].sort((a, b) => {
      const aHyper = hypercorrectionKeys.has(a.key) ? 1 : 0;
      const bHyper = hypercorrectionKeys.has(b.key) ? 1 : 0;
      if (aHyper !== bHyper) return bHyper - aHyper;
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
      return a.box - b.box; // lower box = higher urgency
    });

    for (const targetReTest of sortedDue) {
      // Find candidate cases/variants that match this competency or re-test target
      const matchingCandidates = candidates.filter(c => {
        // Direct variant retest match
        const vMeta = variantsMeta[c.id];
        if (vMeta) {
          if (
            vMeta.retestsMistake.competencyId === targetReTest.competencyId &&
            vMeta.retestsMistake.mistakeId === targetReTest.mistakeId
          ) {
            return true;
          }
        }
        // Competency match
        return c.competencies.includes(targetReTest.competencyId);
      });

      if (matchingCandidates.length > 0) {
        // Prefer an unseen disguised variant first
        const unseenVariants = matchingCandidates.filter(c => variantsMeta[c.id] && !runsSeen.has(c.id));
        const unseenBase = matchingCandidates.filter(c => !variantsMeta[c.id] && !runsSeen.has(c.id));
        const seenCandidates = matchingCandidates.filter(c => runsSeen.has(c.id));

        const chosen =
          unseenVariants.length > 0
            ? unseenVariants[0]
            : unseenBase.length > 0
            ? unseenBase[0]
            : seenCandidates[0];

        const isDisguisedVariant = Boolean(variantsMeta[chosen.id]);
        const reasonIndex = Math.abs(chosen.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % NEUTRAL_RETEST_REASONS.length;
        const learnerReason = NEUTRAL_RETEST_REASONS[reasonIndex];

        const debriefReason = isDisguisedVariant
          ? `Spaced re-test (Box ${targetReTest.box}, ${targetReTest.overdueDays}d overdue) for ${targetReTest.mistakeId} on ${targetReTest.competencyId} disguised via variant "${chosen.id}".`
          : `Spaced re-test (Box ${targetReTest.box}, ${targetReTest.overdueDays}d overdue) for ${targetReTest.mistakeId} on ${targetReTest.competencyId} in "${chosen.id}".`;

        return {
          caseId: chosen.id,
          kind: 'retest',
          learnerReason,
          debriefReason,
          priorityScore: 100 + targetReTest.overdueDays + (hypercorrectionKeys.has(targetReTest.key) ? 20 : 0),
          targetMistake: {
            mistakeId: targetReTest.mistakeId,
            competencyId: targetReTest.competencyId,
            box: targetReTest.box,
            overdueDays: targetReTest.overdueDays,
          },
        };
      }
    }
  }

  // 3. Priority 2: New Learning & Interleaving across case pathologies
  // Filter for cases not yet completed, preferring base library cases first
  const baseCandidates = candidates.filter(c => !variantsMeta[c.id]);
  const unseenBase = baseCandidates.filter(c => !runsSeen.has(c.id));

  let pool = unseenBase.length > 0 ? unseenBase : candidates.filter(c => !runsSeen.has(c.id));
  if (pool.length === 0) {
    pool = candidates; // all seen, cycle through
  }

  // Interleave pathology: penalize cases that share primary tags/setting with the most recent run
  const scored = pool.map(c => {
    let score = 50;
    if (!runsSeen.has(c.id)) score += 30; // novelty bonus
    if (!variantsMeta[c.id]) score += 10; // prefer base case for new curriculum

    if (lastRun && lastRun.contextTags && c.contextTags) {
      const sharesTag = c.contextTags.some(t => lastRun.contextTags!.includes(t));
      if (sharesTag) {
        score -= 20; // interleave: switch to different pathology
      }
    }

    return { candidate: c, score };
  });

  scored.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const chosen = scored[0].candidate;

  return {
    caseId: chosen.id,
    kind: 'new_learning',
    learnerReason: 'Recommended to expand clinical experience in acute respiratory failure.',
    debriefReason: `Curriculum progression: introduces case "${chosen.id}" with interleaved pathology.`,
    priorityScore: scored[0].score,
  };
}
