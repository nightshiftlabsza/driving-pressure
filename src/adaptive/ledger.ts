/**
 * Pure mistake ledger derived from learner events and optional process-class sources.
 *
 * Tracks recurring mistakes per (mistake id x competency), recording:
 * - count of occurrences
 * - first and last seen timestamps
 * - cases where it occurred
 * - whether it was high-confidence (hypercorrection candidate: Metcalfe 2017)
 * - clinical details and severities
 *
 * Designed to integrate with Agent A's process classification via ProcessClassSource
 * without importing or depending on Agent A's code.
 */

import type { LearnerEvent, Confidence } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';

export type ProcessClass =
  | 'sound'
  | 'sound-unlucky'
  | 'reasonable-uncertain'
  | 'delayed'
  | 'wrong-target'
  | 'unsafe';

export interface ProcessClassRecord {
  runId: string;
  caseId?: string;
  simTimeSec?: number;
  wallTime?: string;
  processClass: ProcessClass;
  competency?: string;
  mistakeId?: string;
  detail?: string;
  confidence?: Confidence;
}

/**
 * Interface allowing Agent A's decision review engine to inject
 * process-classified decisions into the mistake ledger without hard dependencies.
 */
export interface ProcessClassSource {
  getProcessClassRecords(events: LearnerEvent[]): ProcessClassRecord[];
}

export interface MistakeLedgerEntry {
  /** Unique key: `${mistakeId}::${competencyId}` */
  key: string;
  mistakeId: string;
  competencyId: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  caseIds: string[];
  /** True if error occurred with 'certain' confidence (hypercorrection candidate) */
  hasHighConfidence: boolean;
  details: string[];
  severities: Array<'minor' | 'major' | 'critical'>;
  /** True if a subsequent run exercised this competency with clean performance */
  resolved: boolean;
}

export interface DeriveLedgerOptions {
  processSource?: ProcessClassSource;
  /** Custom current time for resolution evaluation (defaults to latest event time or now) */
  now?: Date;
}

/**
 * Pure function deriving the mistake ledger from an array of learner events.
 */
export function deriveMistakeLedger(
  events: LearnerEvent[],
  options?: DeriveLedgerOptions
): MistakeLedgerEntry[] {
  if (!events || events.length === 0) {
    return [];
  }

  // 1. Index runs to map runId -> caseId and track run-level confidence/outcomes
  const runCaseMap = new Map<string, string>();
  const runCertainCompetencies = new Map<string, Set<string>>(); // runId -> Set<competencyId> where certain was chosen
  const runOutcomes = new Map<string, { outcome: string; wallTime: string; caseId: string }>();
  const runCompetenciesTested = new Map<string, Set<string>>(); // runId -> Set<competencyId>
  const runCompetencyMistakes = new Map<string, Set<string>>(); // runId -> Set<competencyId> that had mistakes

  for (const e of events) {
    const runId = e.runId;
    if (!runId) continue;

    if (e.activityId && !runCaseMap.has(runId)) {
      runCaseMap.set(runId, e.activityId);
    }

    if (e.type === 'run_end') {
      runOutcomes.set(runId, {
        outcome: e.outcome,
        wallTime: e.wallTime,
        caseId: runCaseMap.get(runId) ?? e.activityId ?? 'unknown',
      });
    }

    if (isEvidenceEvent(e)) {
      if (!runCompetenciesTested.has(runId)) {
        runCompetenciesTested.set(runId, new Set());
      }
      runCompetenciesTested.get(runId)!.add(e.competency);

      if (e.confidence === 'certain') {
        if (!runCertainCompetencies.has(runId)) {
          runCertainCompetencies.set(runId, new Set());
        }
        runCertainCompetencies.get(runId)!.add(e.competency);
      }
    }
  }

  // 2. Accumulate mistakes into entry builders
  interface EntryBuilder {
    mistakeId: string;
    competencyId: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    caseIds: Set<string>;
    hasHighConfidence: boolean;
    details: Set<string>;
    severities: Set<'minor' | 'major' | 'critical'>;
    lastSeenWallMs: number;
  }

  const entries = new Map<string, EntryBuilder>();

  const getOrCreate = (mistakeId: string, competencyId: string): EntryBuilder => {
    const key = `${mistakeId}::${competencyId}`;
    let b = entries.get(key);
    if (!b) {
      b = {
        mistakeId,
        competencyId,
        count: 0,
        firstSeen: '',
        lastSeen: '',
        caseIds: new Set<string>(),
        hasHighConfidence: false,
        details: new Set<string>(),
        severities: new Set<'minor' | 'major' | 'critical'>(),
        lastSeenWallMs: 0,
      };
      entries.set(key, b);
    }
    return b;
  };

  const registerMistake = (
    mistakeId: string,
    competencyId: string,
    wallTime: string,
    caseId: string,
    detail: string,
    severity: 'minor' | 'major' | 'critical',
    isHighConfidence: boolean
  ) => {
    const b = getOrCreate(mistakeId, competencyId);
    b.count++;
    if (!b.firstSeen || new Date(wallTime).getTime() < new Date(b.firstSeen).getTime()) {
      b.firstSeen = wallTime;
    }
    const ms = new Date(wallTime).getTime();
    if (!b.lastSeen || ms > b.lastSeenWallMs) {
      b.lastSeen = wallTime;
      b.lastSeenWallMs = ms;
    }
    if (caseId) b.caseIds.add(caseId);
    if (detail) b.details.add(detail);
    b.severities.add(severity);
    if (isHighConfidence) {
      b.hasHighConfidence = true;
    }
  };

  // Process explicit mistake events
  for (const e of events) {
    if (e.type === 'mistake') {
      const runId = e.runId ?? '';
      const caseId = runCaseMap.get(runId) ?? e.activityId ?? '';
      const certainComps = runCertainCompetencies.get(runId);
      const isCertain =
        certainComps?.has(e.competency) ||
        e.mistake === 'calibration_error' ||
        e.detail.toLowerCase().includes('certain');

      if (runId) {
        if (!runCompetencyMistakes.has(runId)) {
          runCompetencyMistakes.set(runId, new Set());
        }
        runCompetencyMistakes.get(runId)!.add(e.competency);
      }

      registerMistake(
        e.mistake,
        e.competency,
        e.wallTime,
        caseId,
        e.detail,
        e.severity,
        Boolean(isCertain)
      );
    } else if (e.type === 'prediction' && !e.correct && e.confidence === 'certain') {
      // High confidence prediction error (hypercorrection candidate)
      const runId = e.runId ?? '';
      const caseId = runCaseMap.get(runId) ?? e.activityId ?? '';
      registerMistake(
        'calibration_error',
        e.competency,
        e.wallTime,
        caseId,
        `High-confidence error on: ${e.question}`,
        'minor',
        true
      );
    } else if (e.type === 'rubric_result' && !e.met && e.critical) {
      // Critical rubric breach
      const runId = e.runId ?? '';
      const caseId = runCaseMap.get(runId) ?? e.activityId ?? '';
      registerMistake(
        'unsafe_action',
        e.competency,
        e.wallTime,
        caseId,
        `Critical rubric breach: ${e.rubricId}`,
        'critical',
        false
      );
    }
  }

  // 3. Process records from ProcessClassSource if injected
  if (options?.processSource) {
    try {
      const records = options.processSource.getProcessClassRecords(events);
      for (const rec of records) {
        if (rec.processClass === 'sound' || rec.processClass === 'sound-unlucky' || rec.processClass === 'reasonable-uncertain') {
          continue; // defensible or sound
        }

        const comp = rec.competency || 'general';
        const mId =
          rec.mistakeId ||
          (rec.processClass === 'unsafe'
            ? 'unsafe_action'
            : rec.processClass === 'wrong-target'
            ? 'faulty_model'
            : 'failure_to_reassess');
        const wall = rec.wallTime || new Date().toISOString();
        const caseId = rec.caseId || runCaseMap.get(rec.runId) || '';
        const isCertain = rec.confidence === 'certain';
        const severity: 'minor' | 'major' | 'critical' =
          rec.processClass === 'unsafe' ? 'critical' : 'major';

        registerMistake(
          mId,
          comp,
          wall,
          caseId,
          rec.detail || `Process class: ${rec.processClass}`,
          severity,
          isCertain
        );
      }
    } catch {
      // Defensive: ProcessClassSource failures must never crash the adaptive engine
    }
  }

  // 4. Determine resolution status for each mistake
  // A mistake is resolved if a run occurring AFTER the mistake's lastSeen timestamp
  // tested this competency, ended with improved/stable outcome, and produced no mistakes for it.
  const result: MistakeLedgerEntry[] = [];

  for (const [key, b] of entries.entries()) {
    let resolved = false;

    // Check all runs that finished after this mistake was last seen
    for (const [runId, info] of runOutcomes.entries()) {
      const runEndMs = new Date(info.wallTime).getTime();
      if (runEndMs > b.lastSeenWallMs) {
        const compsTested = runCompetenciesTested.get(runId);
        const compsWithMistakes = runCompetencyMistakes.get(runId);

        if (compsTested && compsTested.has(b.competencyId)) {
          const hadMistake = compsWithMistakes && compsWithMistakes.has(b.competencyId);
          if (!hadMistake && (info.outcome === 'improved' || info.outcome === 'stable' || info.outcome === 'completed')) {
            resolved = true;
            break;
          }
        }
      }
    }

    result.push({
      key,
      mistakeId: b.mistakeId,
      competencyId: b.competencyId,
      count: b.count,
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
      caseIds: Array.from(b.caseIds),
      hasHighConfidence: b.hasHighConfidence,
      details: Array.from(b.details),
      severities: Array.from(b.severities),
      resolved,
    });
  }

  // Sort by count descending, then lastSeen descending
  result.sort((a, b) => b.count - a.count || new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
  return result;
}

/**
 * Returns recurring mistakes (mistakes that have occurred 2 or more times).
 */
export function getRecurringMistakes(ledger: MistakeLedgerEntry[]): MistakeLedgerEntry[] {
  return ledger.filter(e => e.count >= 2);
}

/**
 * Returns mistakes that were committed with high confidence ('certain').
 * According to Metcalfe (2017), high-confidence errors show the largest hypercorrection effect
 * when feedback and spaced re-testing are provided.
 */
export function getHypercorrectionCandidates(ledger: MistakeLedgerEntry[]): MistakeLedgerEntry[] {
  return ledger.filter(e => e.hasHighConfidence);
}

/**
 * Returns unresolved mistakes, optionally filtered by a specific set of competencies.
 */
export function getUnresolvedMistakes(
  ledger: MistakeLedgerEntry[],
  competencies?: string[]
): MistakeLedgerEntry[] {
  const set = competencies ? new Set(competencies) : null;
  return ledger.filter(e => !e.resolved && (!set || set.has(e.competencyId)));
}
