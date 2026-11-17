/**
 * Spaced re-test scheduler using Leitner box progression.
 *
 * Rationales:
 * - Spacing & retrieval: Karpicke & Roediger (2008), Cook et al. (2013).
 * - Box intervals:
 *   Box 1: 1 day  - acute error hypercorrection (Metcalfe 2017)
 *   Box 2: 3 days - short-term consolidation & working memory transfer
 *   Box 3: 7 days - medium-term retention matching weekly clinical duty cycle
 *   Box 4: 21 days - long-term retention & clinical durability
 *   Box 5: 60 days - graduated / mastered maintenance
 *
 * Rules:
 * - A new mistake enters Box 1.
 * - A clean re-test (competency exercised in a case without repeating the mistake) moves up one box.
 * - A repeat of the mistake immediately drops it back to Box 1.
 * - Pure functions with injected `now: Date`, deterministic, fully testable.
 */

import type { LearnerEvent } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';

export const LEITNER_BOXES = [1, 2, 3, 4, 5] as const;
export type LeitnerBox = typeof LEITNER_BOXES[number];

/** Spaced review intervals in days per Leitner box */
export const LEITNER_INTERVALS: Record<LeitnerBox, number> = {
  1: 1,  // 1 day: initial error correction
  2: 3,  // 3 days: short-term consolidation
  3: 7,  // 7 days: weekly retention across shift patterns
  4: 21, // 21 days: durable clinical retention
  5: 60, // 60 days: graduated mastery check
};

export const TRANSFER_FAILURE_INTERVAL_DAYS = 5;

export interface ReTestHistoryEntry {
  wallTime: string;
  action: 'initial_mistake' | 'repeat_mistake' | 'clean_retest' | 'transfer_failure';
  boxBefore: number;
  boxAfter: number;
  caseId?: string;
  runId?: string;
}

export interface ReTestScheduleItem {
  key: string; // `${mistakeId}::${competencyId}`
  mistakeId: string;
  competencyId: string;
  box: LeitnerBox;
  intervalDays: number;
  lastTestedAt: string;
  dueAt: string;
  isDue: boolean;
  overdueDays: number;
  graduated: boolean;
  isTransferRetest?: boolean;
  history: ReTestHistoryEntry[];
}

/**
 * Pure function deriving the spaced re-test schedule for all tracked mistakes from events.
 */
export function deriveReTestSchedule(
  events: LearnerEvent[],
  now: Date = new Date()
): ReTestScheduleItem[] {
  if (!events || events.length === 0) {
    return [];
  }

  // 1. Group events chronologically by runId
  interface RunSummaryInternal {
    runId: string;
    caseId: string;
    startTime: string;
    endTime: string;
    outcome: string;
    competenciesTested: Set<string>;
    mistakesRecorded: Array<{ mistakeId: string; competencyId: string; wallTime: string }>;
    hasCriticalRubricFail: boolean;
    isTransferProbe: boolean;
  }

  const runMap = new Map<string, RunSummaryInternal>();
  const runOrder: string[] = [];

  for (const e of events) {
    const runId = e.runId;
    if (!runId) continue;

    let r = runMap.get(runId);
    if (!r) {
      r = {
        runId,
        caseId: e.activityId || '',
        startTime: e.wallTime,
        endTime: e.wallTime,
        outcome: 'in_progress',
        competenciesTested: new Set<string>(),
        mistakesRecorded: [],
        hasCriticalRubricFail: false,
        isTransferProbe: false,
      };
      runMap.set(runId, r);
      runOrder.push(runId);
    }

    if (e.activityId && !r.caseId) {
      r.caseId = e.activityId;
    }
    r.endTime = e.wallTime;

    if (e.type === 'run_start') {
      if (e.isTransferVariant) {
        r.isTransferProbe = true;
      }
    }

    if (e.type === 'run_end') {
      r.outcome = e.outcome;
    }

    if (isEvidenceEvent(e)) {
      r.competenciesTested.add(e.competency);
      if (e.isTransferVariant) {
        r.isTransferProbe = true;
      }
      if (e.type === 'rubric_result' && !e.met && e.critical) {
        r.hasCriticalRubricFail = true;
      }
    }

    if (e.type === 'mistake') {
      r.mistakesRecorded.push({
        mistakeId: e.mistake,
        competencyId: e.competency,
        wallTime: e.wallTime,
      });
    } else if (e.type === 'prediction' && !e.correct && e.confidence === 'certain') {
      r.mistakesRecorded.push({
        mistakeId: 'calibration_error',
        competencyId: e.competency,
        wallTime: e.wallTime,
      });
    } else if (e.type === 'rubric_result' && !e.met && (e.critical || e.isTransferVariant)) {
      r.mistakesRecorded.push({
        mistakeId: e.isTransferVariant ? 'transfer_failure' : 'unsafe_action',
        competencyId: e.competency,
        wallTime: e.wallTime,
      });
    }
  }

  // Sort runs by startTime
  runOrder.sort((a, b) => {
    const ra = runMap.get(a)!;
    const rb = runMap.get(b)!;
    return new Date(ra.startTime).getTime() - new Date(rb.startTime).getTime();
  });

  // 2. Track Leitner state per (mistakeId x competencyId)
  interface ItemState {
    mistakeId: string;
    competencyId: string;
    box: LeitnerBox;
    lastTestedAt: string;
    overrideIntervalDays?: number;
    history: ReTestHistoryEntry[];
  }

  const items = new Map<string, ItemState>();

  for (const rId of runOrder) {
    const run = runMap.get(rId)!;
    const isTransferRun = run.isTransferProbe;

    // A) Process mistakes occurring in this run
    for (const m of run.mistakesRecorded) {
      const key = `${m.mistakeId}::${m.competencyId}`;
      const existing = items.get(key);
      const isTransferFail = isTransferRun || m.mistakeId === 'transfer_failure';

      if (!existing) {
        // Enters Box 1 (or 5-day transfer retest interval on failed transfer variant)
        items.set(key, {
          mistakeId: m.mistakeId,
          competencyId: m.competencyId,
          box: 1,
          lastTestedAt: m.wallTime,
          overrideIntervalDays: isTransferFail ? TRANSFER_FAILURE_INTERVAL_DAYS : undefined,
          history: [
            {
              wallTime: m.wallTime,
              action: isTransferFail ? 'transfer_failure' : 'initial_mistake',
              boxBefore: 0,
              boxAfter: 1,
              caseId: run.caseId,
              runId: run.runId,
            },
          ],
        });
      } else {
        // Repeat mistake drops back to Box 1
        const boxBefore = existing.box;
        existing.box = 1;
        existing.lastTestedAt = m.wallTime;
        if (isTransferFail) {
          existing.overrideIntervalDays = TRANSFER_FAILURE_INTERVAL_DAYS;
        } else {
          existing.overrideIntervalDays = undefined;
        }
        existing.history.push({
          wallTime: m.wallTime,
          action: isTransferFail ? 'transfer_failure' : 'repeat_mistake',
          boxBefore,
          boxAfter: 1,
          caseId: run.caseId,
          runId: run.runId,
        });
      }
    }

    // B) Check for clean re-tests on already tracked mistakes
    // If this run tested a competency, did not trigger this mistake, and did not end with deterioration/critical failure
    for (const [key, item] of items.entries()) {
      const mistakeInThisRun = run.mistakesRecorded.some(
        m => m.mistakeId === item.mistakeId && m.competencyId === item.competencyId
      );

      if (!mistakeInThisRun && run.competenciesTested.has(item.competencyId)) {
        // Only count as clean re-test if run was completed successfully without critical rubric failure
        const isSuccessful =
          (run.outcome === 'improved' || run.outcome === 'stable' || run.outcome === 'completed') &&
          !run.hasCriticalRubricFail;

        if (isSuccessful) {
          const boxBefore = item.box;
          const boxAfter: LeitnerBox = Math.min(5, boxBefore + 1) as LeitnerBox;
          item.box = boxAfter;
          item.lastTestedAt = run.endTime;
          item.history.push({
            wallTime: run.endTime,
            action: 'clean_retest',
            boxBefore,
            boxAfter,
            caseId: run.caseId,
            runId: run.runId,
          });
        }
      }
    }
  }

  // 3. Format result with computed due dates and overdue statuses
  const results: ReTestScheduleItem[] = [];
  const nowMs = now.getTime();

  for (const [key, item] of items.entries()) {
    const intervalDays = item.overrideIntervalDays ?? LEITNER_INTERVALS[item.box];
    const lastDate = new Date(item.lastTestedAt);
    const dueDate = new Date(lastDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    const dueAt = dueDate.toISOString();
    const isDue = dueDate.getTime() <= nowMs;
    const overdueDays = isDue
      ? Math.max(0, Math.floor((nowMs - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    results.push({
      key,
      mistakeId: item.mistakeId,
      competencyId: item.competencyId,
      box: item.box,
      intervalDays,
      lastTestedAt: item.lastTestedAt,
      dueAt,
      isDue,
      overdueDays,
      graduated: item.box >= 5,
      isTransferRetest: item.overrideIntervalDays === TRANSFER_FAILURE_INTERVAL_DAYS,
      history: item.history,
    });
  }

  // Sort by urgency: due first (sorted by overdueDays descending), then by dueAt ascending
  results.sort((a, b) => {
    if (a.isDue && !b.isDue) return -1;
    if (!a.isDue && b.isDue) return 1;
    if (a.isDue && b.isDue) return b.overdueDays - a.overdueDays;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  return results;
}

/**
 * Returns all re-tests that are currently due (dueAt <= now).
 */
export function getDueReTests(
  schedule: ReTestScheduleItem[],
  now: Date = new Date()
): ReTestScheduleItem[] {
  const nowMs = now.getTime();
  return schedule.filter(item => new Date(item.dueAt).getTime() <= nowMs && !item.graduated);
}

/**
 * Returns the most urgent re-test due, or null if none are due.
 */
export function getNextDueReTest(
  schedule: ReTestScheduleItem[],
  now: Date = new Date()
): ReTestScheduleItem | null {
  const due = getDueReTests(schedule, now);
  return due.length > 0 ? due[0] : null;
}
