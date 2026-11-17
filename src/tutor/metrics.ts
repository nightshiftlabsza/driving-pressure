import type { LearnerEvent } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';
import type { CompetencyState } from '../shared/learnerApi';
import { computeBrierScore, CONFIDENCE_PROBABILITY } from '../learner/derivation';
import type { DelayedRetestRecord, TutorExchangeRecord } from './store';

export interface UnaidedTrendMetric {
  unaidedRunsCount: number;
  slopePerRun: number | null;
  latestUnaidedAccuracyPct: number | null;
}

export interface DelayedRetentionMetric {
  passedCount: number;
  totalCount: number;
  overallRatePct: number | null;
  drr7dPct: number | null;
  drr21dPct: number | null;
}

export interface FarTransferMetric {
  transferRunsCount: number;
  ftprPct: number | null;
  baselineAccuracyPct: number | null;
  audPct: number | null;
}

export interface TutorDependenceMetric {
  windowSize: number;
  latestTdi: number | null;
  rollingWindows: number[];
}

export interface HypothesisManeuverMetric {
  attemptCount: number;
  medianTtfohMs: number | null;
  maneuverFirstRatePct: number | null;
}

export interface CalibrationMetric {
  brierScore: number | null;
  calibrationSlope: number | null;
  certainErrorHypercorrectionRatePct: number | null;
  calibratedItemsCount: number;
}

export interface BlindedEgqEntry {
  blindId: string;
  entryKind: 'mechanism_hypothesis' | 'causal_reconstruction';
  text: string;
}

export interface Nof1LearningMetrics {
  unaidedPerformanceTrend: UnaidedTrendMetric;
  delayedRetention: DelayedRetentionMetric;
  farTransfer: FarTransferMetric;
  tutorDependence: TutorDependenceMetric;
  hypothesisAndManeuver: HypothesisManeuverMetric;
  metacognitiveCalibration: CalibrationMetric;
  blindedEgqCount: number;
}

function roundPct(num: number): number {
  return Math.round(num * 1000) / 10;
}

function isAssistedRun(
  runEvents: LearnerEvent[],
  exchangesByRun: Map<string, TutorExchangeRecord[]>
): boolean {
  const hasHint = runEvents.some(e => e.type === 'hint_shown');
  if (hasHint) return true;
  for (const ev of runEvents) {
    if (isEvidenceEvent(ev) && ev.assistance?.assistedInWindow) {
      return true;
    }
    if (ev.runId) {
      const exs = exchangesByRun.get(ev.runId) ?? [];
      if (exs.some(x => x.assisted !== false)) return true;
    }
  }
  return false;
}

function computeOlsSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  if (den <= 1e-9) return 0;
  return Math.round((num / den) * 10000) / 10000;
}

export function computeLearningMetrics(params: {
  events: readonly LearnerEvent[];
  states?: readonly CompetencyState[];
  tutorExchanges?: readonly TutorExchangeRecord[];
  delayedRetests?: readonly DelayedRetestRecord[];
}): Nof1LearningMetrics {
  const events = [...params.events].sort(
    (a, b) => new Date(a.wallTime).getTime() - new Date(b.wallTime).getTime()
  );
  const exchanges = params.tutorExchanges ?? [];
  const retests = params.delayedRetests ?? [];

  const exchangesByRun = new Map<string, TutorExchangeRecord[]>();
  for (const ex of exchanges) {
    if (!ex.runId) continue;
    const list = exchangesByRun.get(ex.runId) ?? [];
    list.push(ex);
    exchangesByRun.set(ex.runId, list);
  }

  // Group chronological runs
  const runMap = new Map<string, LearnerEvent[]>();
  const runOrder: string[] = [];
  for (const e of events) {
    if (!e.runId) continue;
    let arr = runMap.get(e.runId);
    if (!arr) {
      arr = [];
      runMap.set(e.runId, arr);
      runOrder.push(e.runId);
    }
    arr.push(e);
  }

  // Metric 1 & 3 & 4 per-run telemetry
  const unaidedAccuracies: number[] = [];
  const familiarAccuracies: number[] = [];
  const transferAccuracies: number[] = [];
  const runAssistedFlags: number[] = [];

  // Metric 5 per-run telemetry
  const ttfohSamples: number[] = [];
  let maneuverFirstNumerator = 0;
  let maneuverFirstDenominator = 0;

  for (const runId of runOrder) {
    const rEvs = runMap.get(runId)!;
    const assisted = isAssistedRun(rEvs, exchangesByRun);
    runAssistedFlags.push(assisted ? 1 : 0);

    const evs = rEvs.filter(isEvidenceEvent);
    if (evs.length > 0) {
      const acc = evs.filter(e => e.correct).length / evs.length;
      const isTransfer =
        evs.some(e => Boolean(e.isTransferVariant)) ||
        rEvs.some(e => e.activityId?.includes('--'));

      if (!assisted) {
        unaidedAccuracies.push(acc);
        if (isTransfer) {
          transferAccuracies.push(acc);
        } else {
          familiarAccuracies.push(acc);
        }
      }

      for (const ev of evs) {
        if (ev.assistance?.timeToFirstHypothesisMs && ev.assistance.timeToFirstHypothesisMs > 0) {
          ttfohSamples.push(ev.assistance.timeToFirstHypothesisMs);
        } else if (ev.latencyMs && ev.latencyMs > 0) {
          ttfohSamples.push(ev.latencyMs);
        }
      }
    }

    // Maneuver-first rate: hold/diagnostic order before hint_shown or tutor exchange
    const firstHint = rEvs.find(e => e.type === 'hint_shown');
    const firstExchange = (exchangesByRun.get(runId) ?? [])[0];
    const firstHelpTime = Math.min(
      firstHint ? new Date(firstHint.wallTime).getTime() : Infinity,
      firstExchange ? new Date(firstExchange.timestamp).getTime() : Infinity
    );
    const hasTriggerOrOrder = rEvs.some(
      e => e.type === 'alarm' || e.type === 'order' || e.type === 'abg_result' || isEvidenceEvent(e)
    );
    if (hasTriggerOrOrder) {
      maneuverFirstDenominator++;
      const holdOrder = rEvs.find(
        e =>
          e.type === 'order' &&
          (String(e.order) === 'abg' ||
            String(e.order) === 'cxr' ||
            Boolean(
              e.detail &&
                (e.detail.maneuver === 'inspiratory_hold' || e.detail.maneuver === 'expiratory_hold')
            ))
      );
      if (holdOrder && new Date(holdOrder.wallTime).getTime() <= firstHelpTime) {
        maneuverFirstNumerator++;
      } else if (!firstHint && !firstExchange && evs.length > 0) {
        // Check tutorExchanges telemetry timestamps if no hint requested in unaided run with maneuvers
        maneuverFirstDenominator--; // Only denominator where hold/tutor sequence is observable or hold performed
      }
    }
  }

  for (const ex of exchanges) {
    if (typeof ex.timeToFirstHypothesisMs === 'number' && ex.timeToFirstHypothesisMs > 0) {
      ttfohSamples.push(ex.timeToFirstHypothesisMs);
    }
  }

  // Recompute MFR cleanly across abnormal alarms / tutor engagements + clinical hold attempts
  let mfrEligible = 0;
  let mfrFirst = 0;
  for (const runId of runOrder) {
    const rEvs = runMap.get(runId)!;
    const hasAlarmOrHelp =
      rEvs.some(e => e.type === 'alarm' || e.type === 'hint_shown') ||
      (exchangesByRun.get(runId)?.length ?? 0) > 0;
    if (!hasAlarmOrHelp) continue;
    mfrEligible++;
    const firstHelpTs = Math.min(
      ...rEvs.filter(e => e.type === 'hint_shown').map(e => new Date(e.wallTime).getTime()),
      ...(exchangesByRun.get(runId) ?? []).map(x => new Date(x.timestamp).getTime()),
      Infinity
    );
    const diagnosticPreHelp = rEvs.find(
      e =>
        (e.type === 'data_viewed' ||
          (e.type === 'order' &&
            ['abg', 'cxr', 'examine'].includes(String(e.order)))) &&
        new Date(e.wallTime).getTime() <= firstHelpTs
    );
    if (diagnosticPreHelp) mfrFirst++;
  }
  void maneuverFirstNumerator;
  void maneuverFirstDenominator;

  // Metric 1: UT
  const unaidedXs = unaidedAccuracies.map((_, i) => i);
  const slopePerRun = computeOlsSlope(unaidedXs, unaidedAccuracies);
  const latestUnaidedAccuracyPct =
    unaidedAccuracies.length > 0
      ? roundPct(unaidedAccuracies[unaidedAccuracies.length - 1]!)
      : null;

  // Metric 2: DRR
  const allEvidence = events.filter(isEvidenceEvent);
  const delayedEvents = allEvidence.filter(e => e.isDelayedRetest && !e.assistance?.assistedInWindow);
  const completedStoreRetests = retests.filter(r => r.completedAt !== null && typeof r.passed === 'boolean');

  const retestOutcomes: Array<{ passed: boolean; ageDays: number }> = [];
  for (const ev of delayedEvents) {
    retestOutcomes.push({ passed: ev.correct, ageDays: 7 });
  }
  for (const r of completedStoreRetests) {
    const ageDays = Math.max(0, (r.completedAt! - r.createdAt) / (1000 * 60 * 60 * 24));
    retestOutcomes.push({ passed: Boolean(r.passed), ageDays });
  }
  const drrPassed = retestOutcomes.filter(x => x.passed).length;
  const drr7 = retestOutcomes.filter(x => x.ageDays >= 6 && x.ageDays < 21);
  const drr21 = retestOutcomes.filter(x => x.ageDays >= 21);

  // Metric 3: FTPR & AUD
  const ftprPct =
    transferAccuracies.length > 0
      ? roundPct(transferAccuracies.reduce((a, b) => a + b, 0) / transferAccuracies.length)
      : null;
  const baselineAccuracyPct =
    familiarAccuracies.length > 0
      ? roundPct(familiarAccuracies.reduce((a, b) => a + b, 0) / familiarAccuracies.length)
      : null;
  const audPct =
    ftprPct !== null && baselineAccuracyPct !== null
      ? Math.round((baselineAccuracyPct - ftprPct) * 10) / 10
      : null;

  // Metric 4: TDI rolling 5-case windows
  const windowSize = 5;
  const rollingWindows: number[] = [];
  if (runAssistedFlags.length > 0) {
    for (let i = 0; i < runAssistedFlags.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = runAssistedFlags.slice(start, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      rollingWindows.push(Math.round(avg * 1000) / 1000);
    }
  }

  // Metric 5: Median TTFOH & MFR
  let medianTtfohMs: number | null = null;
  if (ttfohSamples.length > 0) {
    const sorted = [...ttfohSamples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianTtfohMs =
      sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }

  // Metric 6: Brier calibration, slope & hypercorrection
  const calibratedEvs = allEvidence.filter(
    (e): e is typeof e & { confidence: keyof typeof CONFIDENCE_PROBABILITY } =>
      Boolean(e.confidence && e.confidence in CONFIDENCE_PROBABILITY)
  );
  const brierScore = calibratedEvs.length > 0 ? computeBrierScore(calibratedEvs) : null;
  const calXs = calibratedEvs.map(e => CONFIDENCE_PROBABILITY[e.confidence]);
  const calYs = calibratedEvs.map(e => (e.correct ? 1 : 0));
  const calibrationSlope = calibratedEvs.length >= 2 ? computeOlsSlope(calXs, calYs) : null;

  let certainErrorCount = 0;
  let hypercorrectedCount = 0;
  const byComp = new Map<string, typeof allEvidence>();
  for (const ev of allEvidence) {
    const arr = byComp.get(ev.competency) ?? [];
    arr.push(ev);
    byComp.set(ev.competency, arr);
  }
  for (const list of byComp.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i]!.confidence === 'certain' && !list[i]!.correct) {
        certainErrorCount++;
        if (list[i + 1]!.correct) hypercorrectedCount++;
      }
    }
  }

  const egqEntries = buildBlindedEgqExport(events, exchanges);

  return {
    unaidedPerformanceTrend: {
      unaidedRunsCount: unaidedAccuracies.length,
      slopePerRun,
      latestUnaidedAccuracyPct,
    },
    delayedRetention: {
      passedCount: drrPassed,
      totalCount: retestOutcomes.length,
      overallRatePct:
        retestOutcomes.length > 0 ? roundPct(drrPassed / retestOutcomes.length) : null,
      drr7dPct:
        drr7.length > 0
          ? roundPct(drr7.filter(x => x.passed).length / drr7.length)
          : null,
      drr21dPct:
        drr21.length > 0
          ? roundPct(drr21.filter(x => x.passed).length / drr21.length)
          : null,
    },
    farTransfer: {
      transferRunsCount: transferAccuracies.length,
      ftprPct,
      baselineAccuracyPct,
      audPct,
    },
    tutorDependence: {
      windowSize,
      latestTdi:
        rollingWindows.length > 0 ? rollingWindows[rollingWindows.length - 1]! : null,
      rollingWindows,
    },
    hypothesisAndManeuver: {
      attemptCount: ttfohSamples.length,
      medianTtfohMs,
      maneuverFirstRatePct: mfrEligible > 0 ? roundPct(mfrFirst / mfrEligible) : null,
    },
    metacognitiveCalibration: {
      brierScore,
      calibrationSlope,
      certainErrorHypercorrectionRatePct:
        certainErrorCount > 0 ? roundPct(hypercorrectedCount / certainErrorCount) : null,
      calibratedItemsCount: calibratedEvs.length,
    },
    blindedEgqCount: egqEntries.length,
  };
}

/**
 * Exports up to 20 anonymized mechanism / causal reconstruction texts stripped of timestamps,
 * case IDs, and provider info for 14-day blind clinician EGQ self-scoring (0-2).
 */
export function buildBlindedEgqExport(
  events: readonly LearnerEvent[],
  exchanges: readonly TutorExchangeRecord[],
  maxItems: number = 20
): BlindedEgqEntry[] {
  const collected: BlindedEgqEntry[] = [];

  const stripIdentifiers = (raw: string): string =>
    raw
      .replace(/\b\d{4}-\d{2}-\d{2}[T\s\d:.Z+-]*\b/g, '[DATE]')
      .replace(/\b(ards-vent-01|asthma-vent-01|copd-niv-01|pneumonia-hfnc-01|apo-cpap-01|dka-intubated-01|dyssynchrony-01|sbt-pass-01|sbt-fail-01|vent-high-pressure-01|copd-psv-trigger-01)(--[a-z0-9-]+)?\b/gi, '[CASE]')
      .trim();

  for (const ev of events) {
    if (ev.type === 'prediction' && typeof ev.answer === 'string' && ev.answer.trim().length >= 8) {
      collected.push({
        blindId: `EGQ-${String(collected.length + 1).padStart(2, '0')}`,
        entryKind: 'mechanism_hypothesis',
        text: stripIdentifiers(ev.answer),
      });
    }
    if (collected.length >= maxItems) return collected;
  }

  for (const ex of exchanges) {
    if (ex.validatedOutput.message && ex.attemptSubmittedAt) {
      collected.push({
        blindId: `EGQ-${String(collected.length + 1).padStart(2, '0')}`,
        entryKind: ex.reconstructionPassed ? 'causal_reconstruction' : 'mechanism_hypothesis',
        text: stripIdentifiers(ex.validatedOutput.message),
      });
    }
    if (collected.length >= maxItems) return collected;
  }

  return collected;
}
