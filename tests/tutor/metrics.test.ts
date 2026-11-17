import { describe, it, expect } from 'vitest';
import { computeLearningMetrics, buildBlindedEgqExport } from '../../src/tutor/metrics';
import type { LearnerEvent } from '../../src/shared/events';
import type { TutorExchangeRecord } from '../../src/tutor/store';

describe('Tutor v2 N-of-1 Evaluation Metrics (src/tutor/metrics.ts)', () => {
  const mkUnaidedRun = (
    runIdx: number,
    day: number,
    correct: boolean,
    opts: {
      caseId?: string;
      comp?: string;
      conf?: 'guess' | 'fairly_sure' | 'certain';
      isTransfer?: boolean;
      isDelayedRetest?: boolean;
      assisted?: boolean;
      withOrderBefore?: boolean;
      latencyMs?: number;
    } = {}
  ): LearnerEvent[] => {
    const baseTime = Date.UTC(2026, 10, 1 + day, 10, 0, 0);
    const runId = `run-${runIdx}`;
    const caseId = opts.caseId ?? (opts.isTransfer ? 'ards-vent-01--pbw-short-female' : 'ards-vent-01');
    const comp = opts.comp ?? 'disease.ards';
    const evs: LearnerEvent[] = [
      {
        v: 1,
        id: `start-${runIdx}`,
        wallTime: new Date(baseTime).toISOString(),
        sessionId: 'sess-eval',
        runId,
        activity: 'case',
        activityId: caseId,
        type: 'run_start',
        guidanceByCompetency: { [comp]: 'independent' },
        isTransferVariant: opts.isTransfer,
      },
      {
        v: 1,
        id: `alarm-${runIdx}`,
        wallTime: new Date(baseTime + 1000).toISOString(),
        sessionId: 'sess-eval',
        runId,
        type: 'alarm',
        alarm: 'High Peak Pressure',
        raisedAtSimSec: 10,
      },
    ];
    if (opts.withOrderBefore) {
      evs.push({
        v: 1,
        id: `ord-${runIdx}`,
        wallTime: new Date(baseTime + 2000).toISOString(),
        sessionId: 'sess-eval',
        runId,
        type: 'order',
        order: 'abg',
      });
    }
    if (opts.assisted) {
      evs.push({
        v: 1,
        id: `hint-${runIdx}`,
        wallTime: new Date(baseTime + 5000).toISOString(),
        sessionId: 'sess-eval',
        runId,
        type: 'hint_shown',
        level: 2,
        competency: comp,
        source: 'ai',
      });
    }
    evs.push({
      v: 1,
      id: `pred-${runIdx}`,
      wallTime: new Date(baseTime + 10000).toISOString(),
      sessionId: 'sess-eval',
      runId,
      activity: 'case',
      activityId: caseId,
      type: 'prediction',
      predictionId: `p-${runIdx}`,
      question: 'What happens to Pplat?',
      answer: 'Lowering Vt lowers driving pressure because plateau falls.',
      expected: 'Lowering Vt lowers driving pressure',
      competency: comp,
      evidenceType: 'decision',
      correct,
      confidence: opts.conf ?? 'fairly_sure',
      guidance: 'independent',
      hidden: Boolean(opts.isDelayedRetest),
      isTransferVariant: opts.isTransfer,
      isDelayedRetest: opts.isDelayedRetest,
      assistance: {
        assistedInWindow: Boolean(opts.assisted),
        maxHelpLevelUsed: opts.assisted ? 2 : 0,
        hintCountInProblem: opts.assisted ? 1 : 0,
        tutorTurnsBeforeCommit: opts.assisted ? 1 : 0,
        reconstructionPassed: opts.assisted ? true : null,
        timeToFirstHypothesisMs: opts.latencyMs ?? 8000,
      },
    });
    return evs;
  };

  it('computes all 7 Section 10.1 N-of-1 metrics deterministically without NaN on real or empty inputs', () => {
    const empty = computeLearningMetrics({ events: [] });
    expect(empty.unaidedPerformanceTrend.slopePerRun).toBeNull();
    expect(empty.delayedRetention.overallRatePct).toBeNull();
    expect(empty.farTransfer.ftprPct).toBeNull();
    expect(empty.tutorDependence.latestTdi).toBeNull();
    expect(empty.hypothesisAndManeuver.medianTtfohMs).toBeNull();
    expect(empty.metacognitiveCalibration.brierScore).toBeNull();
    expect(empty.blindedEgqCount).toBe(0);

    const events: LearnerEvent[] = [
      // Assisted run 1 (with diagnostic check before hint)
      ...mkUnaidedRun(1, 0, true, { assisted: true, withOrderBefore: true, latencyMs: 12000 }),
      // Unaided run 2: wrong with high certainty (calibration error -> hypercorrected in run 3)
      ...mkUnaidedRun(2, 1, false, { conf: 'certain', latencyMs: 10000 }),
      // Unaided run 3: right
      ...mkUnaidedRun(3, 2, true, { conf: 'fairly_sure', latencyMs: 8000 }),
      // Transfer probe run 4: right
      ...mkUnaidedRun(4, 3, true, { isTransfer: true, conf: 'certain', latencyMs: 6000 }),
      // 7d delayed retest run 5: right
      ...mkUnaidedRun(5, 10, true, { isDelayedRetest: true, conf: 'certain', latencyMs: 7000 }),
    ];

    const delayedRetests = [
      {
        id: 'ret-21d',
        competencyId: 'disease.ards',
        caseId: 'ards-vent-01',
        dueAt: Date.UTC(2026, 10, 22),
        createdAt: Date.UTC(2026, 10, 1),
        completedAt: Date.UTC(2026, 10, 23),
        passed: true,
        source: 'assisted_reveal' as const,
      },
    ];

    const metrics = computeLearningMetrics({ events, delayedRetests });
    // UT: 4 unaided runs ([0, 1, 1, 1]) -> positive slope > 0, latest 100%
    expect(metrics.unaidedPerformanceTrend.unaidedRunsCount).toBe(4);
    expect(metrics.unaidedPerformanceTrend.slopePerRun).toBeGreaterThan(0);
    expect(metrics.unaidedPerformanceTrend.latestUnaidedAccuracyPct).toBe(100);

    // DRR: 1 7d passed + 1 21d passed = 100%
    expect(metrics.delayedRetention.overallRatePct).toBe(100);
    expect(metrics.delayedRetention.drr7dPct).toBe(100);
    expect(metrics.delayedRetention.drr21dPct).toBe(100);

    // FTPR & AUD
    expect(metrics.farTransfer.ftprPct).toBe(100);
    expect(metrics.farTransfer.transferRunsCount).toBe(1);
    expect(metrics.farTransfer.audPct).not.toBeNull();

    // TDI: 1 assisted out of 5 runs = 0.2
    expect(metrics.tutorDependence.latestTdi).toBe(0.2);

    // MFR & TTFOH: 1 of 5 alarm/help runs placed diagnostic ABG order before help
    expect(metrics.hypothesisAndManeuver.maneuverFirstRatePct).toBe(20);
    expect(metrics.hypothesisAndManeuver.medianTtfohMs).toBe(8000);

    // Brier & hypercorrection (run 2 certain error followed by run 3 pass -> 100% hypercorrection)
    expect(metrics.metacognitiveCalibration.brierScore).toBeGreaterThan(0);
    expect(metrics.metacognitiveCalibration.certainErrorHypercorrectionRatePct).toBe(100);

    // EGQ
    expect(metrics.blindedEgqCount).toBe(5);
  });

  it('strips dates and case IDs in buildBlindedEgqExport capped at 20 items', () => {
    const exchanges: TutorExchangeRecord[] = [
      {
        id: 'ex-1',
        timestamp: '2026-11-10T10:00:00.000Z',
        contextKind: 'active_case',
        provider: 'offline',
        model: 'offline',
        promptVersion: 'tutor-v2',
        rawOutput: '{}',
        validatedOutput: {
          message: 'On 2026-11-10 in ards-vent-01--pbw-short-female lowering Vt drops driving pressure.',
          help_level_used: 1,
          question: null,
          needs_clarification: false,
          reasoning_grade: 'correct_justified',
          misconception_ids: [],
          claims: [],
          confidence: 0.9,
        },
        latencyMs: 10,
        suggestions: [],
        attemptSubmittedAt: '2026-11-10T10:00:00.000Z',
        reconstructionPassed: true,
      },
    ];
    const entries = buildBlindedEgqExport([], exchanges, 20);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entryKind).toBe('causal_reconstruction');
    expect(entries[0]!.text).not.toContain('2026-11-10');
    expect(entries[0]!.text).not.toContain('ards-vent-01');
  });
});
