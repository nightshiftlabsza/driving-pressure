import { useMemo } from 'react';
import type { GuidanceLevel } from '../shared/events';
import {
  resolveEffectiveGuidance,
  getScaffoldsForGuidance,
  type ScaffoldVisibility,
} from './scaffolds';

export interface UseScaffoldsResult {
  effectiveGuidance: GuidanceLevel;
  scaffolds: ScaffoldVisibility;
  formatInspHold: (pplat: number | null | undefined, peep: number | null | undefined) => string;
  formatExpHold: (totalPeep: number | null | undefined, autoPeep: number | null | undefined) => string;
}

function f(v: number | null | undefined, d = 1) {
  return v === null || v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(d);
}

export function useScaffolds(
  guidanceMap?: Record<string, GuidanceLevel>,
  relevantCompetencies?: string[]
): UseScaffoldsResult {
  const effectiveGuidance = useMemo(() => {
    return resolveEffectiveGuidance(guidanceMap, relevantCompetencies);
  }, [guidanceMap, relevantCompetencies]);

  const scaffolds = useMemo(() => {
    return getScaffoldsForGuidance(effectiveGuidance);
  }, [effectiveGuidance]);

  const formatInspHold = (pplat: number | null | undefined, peep: number | null | undefined): string => {
    const pplatStr = `Pplat ${f(pplat, 1)} cmH2O`;
    if (!scaffolds.showComputedDrivingPressure) {
      // Independent: Raw Pplat only (clinician calculates driving pressure)
      return pplatStr;
    }
    const dp = (pplat ?? NaN) - (peep ?? NaN);
    return `${pplatStr} · driving pressure ${f(dp, 1)}`;
  };

  const formatExpHold = (totalPeep: number | null | undefined, autoPeep: number | null | undefined): string => {
    const totalStr = `Total PEEP ${f(totalPeep, 1)}`;
    if (!scaffolds.showComputedAutoPeep) {
      // Independent: Raw total PEEP only
      return totalStr;
    }
    return `${totalStr} · auto-PEEP ${f(autoPeep, 1)} cmH2O`;
  };

  return {
    effectiveGuidance,
    scaffolds,
    formatInspHold,
    formatExpHold,
  };
}
