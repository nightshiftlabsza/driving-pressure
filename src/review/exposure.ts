/**
 * Exposure Ledger: computes cumulative sim-minutes spent above or below evidence-based injury thresholds.
 * Reporting only; strictly does not alter physiology or patient parameters.
 */
import type { ExposureLedgerEntry, ExposureThresholdRule, MetricPoint } from './types';
import defaultRulesJson from './rules/exposure.json';

export const DEFAULT_EXPOSURE_RULES = defaultRulesJson as ExposureThresholdRule[];

function checkOp(val: number, op: '>' | '>=' | '<' | '<=', threshold: number): boolean {
  switch (op) {
    case '>': return val > threshold;
    case '>=': return val >= threshold;
    case '<': return val < threshold;
    case '<=': return val <= threshold;
    default: return false;
  }
}

function matchesRule(point: MetricPoint, rule: ExposureThresholdRule): boolean {
  const primaryVal = point[rule.metric];
  if (primaryVal === null || primaryVal === undefined || !Number.isFinite(primaryVal)) {
    return false;
  }
  if (!checkOp(primaryVal, rule.op, rule.threshold)) {
    return false;
  }

  if (rule.secondary) {
    const secVal = point[rule.secondary.metric];
    if (secVal === null || secVal === undefined || !Number.isFinite(secVal)) {
      return false;
    }
    if (!checkOp(secVal, rule.secondary.op, rule.secondary.threshold)) {
      return false;
    }
  }

  return true;
}

/**
 * Compute the exposure ledger from a recorded or replayed metric time series.
 * Evaluates duration by integrating time intervals between consecutive metric samples.
 */
export function computeExposureLedger(
  metrics: MetricPoint[],
  rules: ExposureThresholdRule[] = DEFAULT_EXPOSURE_RULES
): ExposureLedgerEntry[] {
  if (!metrics || metrics.length < 2) {
    return rules.map(rule => ({
      ruleId: rule.id,
      name: rule.name,
      metric: String(rule.metric),
      conditionDescription: `${rule.metric} ${rule.op} ${rule.threshold}`,
      durationSimMinutes: 0,
      maxObservedValue: null,
      minObservedValue: null,
      source: rule.source,
    }));
  }

  // Ensure metrics are sorted chronologically
  const sorted = [...metrics].sort((a, b) => a.simTimeSec - b.simTimeSec);

  return rules.map(rule => {
    let cumulativeSec = 0;
    let maxVal: number | null = null;
    let minVal: number | null = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      const dtSec = Math.max(0, p2.simTimeSec - p1.simTimeSec);

      const m1 = matchesRule(p1, rule);
      const m2 = matchesRule(p2, rule);

      if (m1 || m2) {
        // If at least one boundary matches, integrate duration (trapezoidal interval weighting)
        const weight = (m1 ? 0.5 : 0) + (m2 ? 0.5 : 0);
        cumulativeSec += dtSec * weight;

        const val1 = p1[rule.metric];
        const val2 = p2[rule.metric];

        if (m1 && val1 !== null && val1 !== undefined && Number.isFinite(val1)) {
          maxVal = maxVal === null ? val1 : Math.max(maxVal, val1);
          minVal = minVal === null ? val1 : Math.min(minVal, val1);
        }
        if (m2 && val2 !== null && val2 !== undefined && Number.isFinite(val2)) {
          maxVal = maxVal === null ? val2 : Math.max(maxVal, val2);
          minVal = minVal === null ? val2 : Math.min(minVal, val2);
        }
      }
    }

    const durationSimMinutes = Math.round((cumulativeSec / 60) * 10) / 10;

    return {
      ruleId: rule.id,
      name: rule.name,
      metric: String(rule.metric),
      conditionDescription: rule.secondary
        ? `${rule.metric} ${rule.op} ${rule.threshold} and ${rule.secondary.metric} ${rule.secondary.op} ${rule.secondary.threshold}`
        : `${rule.metric} ${rule.op} ${rule.threshold}`,
      durationSimMinutes,
      maxObservedValue: maxVal !== null ? Math.round(maxVal * 10) / 10 : null,
      minObservedValue: minVal !== null ? Math.round(minVal * 10) / 10 : null,
      source: rule.source,
    };
  });
}
