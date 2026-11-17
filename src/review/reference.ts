/**
 * Reference Run engine: runs authored attending/expert decisions headlessly through the real engine.
 * Labeled "One reasonable approach", never "the correct answer" (docs/overnight/02-product-architecture.md).
 */
import type { CaseFile } from '../shared/caseSchema';
import { engine as defaultEngine } from '../engine/index';
import { replayRun } from './replay';
import type {
  DecisionInput,
  MetricPoint,
  ReferenceRunDefinition,
  ReplayOptions,
  ReplayResult,
} from './types';

import ardsRefJson from './reference/ards-vent-01.json';
import hfncRefJson from './reference/pneumonia-hfnc-01.json';

const REFERENCE_DEFINITIONS: Record<string, ReferenceRunDefinition> = {
  'ards-vent-01': ardsRefJson as unknown as ReferenceRunDefinition,
  'pneumonia-hfnc-01': hfncRefJson as unknown as ReferenceRunDefinition,
};

export const DEFAULT_KEY_METRICS: (keyof MetricPoint)[] = [
  'spo2',
  'paco2',
  'ph',
  'pplat',
  'drivingPressure',
  'fio2',
];

export interface MetricComparisonSeries {
  metric: keyof MetricPoint;
  label: string;
  unit: string;
  learnerSeries: { simTimeSec: number; value: number | null }[];
  referenceSeries: { simTimeSec: number; value: number | null }[];
  minVal: number;
  maxVal: number;
}

export interface TrajectoryComparison {
  caseId: string;
  referenceLabel: string;
  referenceSource: string;
  referenceTitle: string;
  metrics: MetricComparisonSeries[];
  referenceDecisions: ReferenceRunDefinition['decisions'];
}

export function getReferenceDefinition(caseId: string): ReferenceRunDefinition | null {
  return REFERENCE_DEFINITIONS[caseId] ?? null;
}

const referenceCache = new Map<string, Promise<ReplayResult | null>>();

export function clearReferenceReplayCache(): void {
  referenceCache.clear();
}

/**
 * Execute an authored reference run through headless replay using the real engine.
 */
export async function runReferenceReplay(
  caseFile: CaseFile,
  options: ReplayOptions = {}
): Promise<ReplayResult | null> {
  const refDef = getReferenceDefinition(caseFile.id);
  if (!refDef) return null;

  const interval = options.sampleIntervalSec ?? 20;
  const maxSec = options.maxSimSec ?? caseFile.maxSimMin * 60;
  const cacheKey = `${caseFile.id}-${interval}-${maxSec}`;

  const isDefaultEngine = !options.engine || options.engine === defaultEngine;
  if (isDefaultEngine && referenceCache.has(cacheKey)) {
    return referenceCache.get(cacheKey)!;
  }

  const decisions: DecisionInput[] = refDef.decisions.map(d => ({
    simTimeSec: d.simTimeSec,
    kind: d.kind,
    order: d.order,
    detail: d.detail,
    settings: d.settings as DecisionInput['settings'],
    rationale: d.rationale,
  }));

  const promise = replayRun(caseFile, decisions, {
    ...options,
    sampleIntervalSec: interval,
    maxSimSec: maxSec,
  });

  if (isDefaultEngine) {
    referenceCache.set(cacheKey, promise);
  }

  return promise;
}

const METRIC_CONFIG: Record<string, { label: string; unit: string }> = {
  spo2: { label: 'SpO2', unit: '%' },
  paco2: { label: 'PaCO2', unit: 'mmHg' },
  pao2: { label: 'PaO2', unit: 'mmHg' },
  ph: { label: 'Arterial pH', unit: '' },
  pplat: { label: 'Plateau Pressure', unit: 'cmH2O' },
  drivingPressure: { label: 'Driving Pressure (ΔP)', unit: 'cmH2O' },
  ppeak: { label: 'Peak Pressure', unit: 'cmH2O' },
  peep: { label: 'PEEP', unit: 'cmH2O' },
  vte: { label: 'Exhaled Vt', unit: 'mL' },
  vteMlKgPbw: { label: 'Vt per PBW', unit: 'mL/kg' },
  fio2: { label: 'FiO2', unit: '' },
  map: { label: 'Mean Arterial Pressure', unit: 'mmHg' },
};

/**
 * Compare learner metric series against the attending reference run series.
 */
export function compareTrajectories(
  caseFile: CaseFile,
  learnerMetrics: MetricPoint[],
  referenceMetrics: MetricPoint[],
  metricsToCompare: (keyof MetricPoint)[] = DEFAULT_KEY_METRICS
): TrajectoryComparison | null {
  const refDef = getReferenceDefinition(caseFile.id);
  if (!refDef) return null;

  const comparisonMetrics: MetricComparisonSeries[] = metricsToCompare.map(m => {
    const cfg = METRIC_CONFIG[String(m)] ?? { label: String(m), unit: '' };

    const learnerSeries = learnerMetrics.map(p => ({
      simTimeSec: p.simTimeSec,
      value: p[m] as number | null,
    }));

    const referenceSeries = referenceMetrics.map(p => ({
      simTimeSec: p.simTimeSec,
      value: p[m] as number | null,
    }));

    const allValues = [
      ...learnerSeries.map(s => s.value),
      ...referenceSeries.map(s => s.value),
    ].filter((v): v is number => v !== null && Number.isFinite(v));

    const minVal = allValues.length ? Math.min(...allValues) : 0;
    const maxVal = allValues.length ? Math.max(...allValues) : 100;

    return {
      metric: m,
      label: cfg.label,
      unit: cfg.unit,
      learnerSeries,
      referenceSeries,
      minVal,
      maxVal,
    };
  });

  return {
    caseId: caseFile.id,
    referenceLabel: refDef.label,
    referenceSource: refDef.source,
    referenceTitle: refDef.title,
    metrics: comparisonMetrics,
    referenceDecisions: refDef.decisions,
  };
}

export interface ReferenceDivergence {
  simTimeSec: number;
  metric: keyof MetricPoint;
  label: string;
  unit: string;
  learnerValue: number;
  referenceValue: number;
  relativeDiffPct: number;
  referenceDecisionNote?: string;
}

const DIVERGENCE_ABS_THRESHOLDS: Partial<Record<keyof MetricPoint, number>> = {
  spo2: 3,
  ph: 0.05,
  paco2: 5,
  pplat: 3,
  drivingPressure: 3,
  ppeak: 4,
  vteMlKgPbw: 1.0,
  fio2: 0.1,
  map: 10,
};

/**
 * Finds the earliest simulation timestamp at which learner trajectory diverges materially
 * from the attending reference run without modifying ProcessClass classifications.
 */
export function findReferenceDivergence(
  comparison: TrajectoryComparison
): ReferenceDivergence | null {
  let earliest: ReferenceDivergence | null = null;

  for (const series of comparison.metrics) {
    const refByTime = new Map<number, number>();
    for (const pt of series.referenceSeries) {
      if (pt.value !== null && Number.isFinite(pt.value)) {
        refByTime.set(pt.simTimeSec, pt.value);
      }
    }

    const absThreshold = DIVERGENCE_ABS_THRESHOLDS[series.metric] ?? 0;

    for (const lPt of series.learnerSeries) {
      if (lPt.simTimeSec <= 0 || lPt.value === null || !Number.isFinite(lPt.value)) continue;
      const refVal = refByTime.get(lPt.simTimeSec);
      if (refVal === undefined) continue;

      const absDiff = Math.abs(lPt.value - refVal);
      const relDiff = Math.abs(refVal) > 1e-6 ? absDiff / Math.abs(refVal) : 0;
      const diverged =
        absThreshold > 0 ? absDiff >= absThreshold || relDiff >= 0.15 : relDiff >= 0.12;

      if (!diverged) continue;

      const candidateBetter =
        !earliest ||
        lPt.simTimeSec < earliest.simTimeSec ||
        (lPt.simTimeSec === earliest.simTimeSec && relDiff * 100 > earliest.relativeDiffPct);

      if (candidateBetter) {
        const nearestDec = [...comparison.referenceDecisions]
          .filter(d => d.simTimeSec <= lPt.simTimeSec + 60)
          .sort((a, b) => Math.abs(a.simTimeSec - lPt.simTimeSec) - Math.abs(b.simTimeSec - lPt.simTimeSec))[0];

        earliest = {
          simTimeSec: lPt.simTimeSec,
          metric: series.metric,
          label: series.label,
          unit: series.unit,
          learnerValue: Math.round(lPt.value * 100) / 100,
          referenceValue: Math.round(refVal * 100) / 100,
          relativeDiffPct: Math.round(relDiff * 1000) / 10,
          referenceDecisionNote: nearestDec?.rationale,
        };
      }
      break;
    }
  }

  return earliest;
}
