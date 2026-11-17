import type { GuidanceLevel } from '../shared/events';

export interface ScaffoldVisibility {
  /**
   * Computed driving pressure (Pplat - PEEP):
   * - guided: Always computed and labelled explicitly on hold results
   * - prompted: Displayed only after a valid inspiratory hold
   * - independent: Raw values only (shows Pplat and PEEP; does not compute the subtraction for the clinician)
   */
  showComputedDrivingPressure: boolean;

  /**
   * Computed auto-PEEP (Total PEEP - Set PEEP):
   * - guided: Explicit auto-PEEP calculation labelled
   * - prompted: Shown on expiratory hold result
   * - independent: Raw total PEEP only; no subtracted auto-PEEP computation
   */
  showComputedAutoPeep: boolean;

  /**
   * Waveform annotations and didactic zero-baselines:
   * - guided: Full zero-reference lines, channel labels, and units
   * - prompted: Standard waveform traces with baseline
   * - independent: Raw clean monitor waveforms
   */
  showWaveformPhaseGuidance: boolean;

  /**
   * Colour-coded warning tones on monitor tiles (e.g. amber for over-oxygenation, red for hypotension):
   * - guided: Full prominent warning tones
   * - prompted: Standard warning tones
   * - independent: Neutral / standard clinical monitor tones
   */
  showMonitorWarningTones: boolean;

  /**
   * Irreversible action safety confirmations (intubate, extubate, needle-decompression, paralysis):
   * - guided: Explanatory confirmation modal with consequences warning
   * - prompted: Standard confirmation prompt
   * - independent: Direct execution (no hand-holding confirmation)
   */
  requireIrreversibleConfirmation: boolean;

  /**
   * Blood gas pedagogical explanation footnote:
   * - guided: Instructional helper note visible
   * - prompted: Minimal status note
   * - independent: Clean table without instructional hints
   */
  showPedagogicalNotes: boolean;

  /**
   * Immediate prediction explanation feedback:
   * - guided: Always display full explanation immediately
   * - prompted: Display explanation only on incorrect predictions
   * - independent: Physiological consequence only; minimal text explanation
   */
  showImmediatePredictionExplanations: boolean;
}

export const SCAFFOLD_CONFIG_BY_LEVEL: Record<GuidanceLevel, ScaffoldVisibility> = {
  guided: {
    showComputedDrivingPressure: true,
    showComputedAutoPeep: true,
    showWaveformPhaseGuidance: true,
    showMonitorWarningTones: true,
    requireIrreversibleConfirmation: true,
    showPedagogicalNotes: true,
    showImmediatePredictionExplanations: true,
  },
  prompted: {
    showComputedDrivingPressure: true, // Shown after hold
    showComputedAutoPeep: true,       // Shown after hold
    showWaveformPhaseGuidance: true,
    showMonitorWarningTones: true,
    requireIrreversibleConfirmation: true,
    showPedagogicalNotes: false,
    showImmediatePredictionExplanations: false, // Only after error
  },
  independent: {
    showComputedDrivingPressure: false, // Raw numbers only
    showComputedAutoPeep: false,       // Raw numbers only
    showWaveformPhaseGuidance: false,
    showMonitorWarningTones: false,
    requireIrreversibleConfirmation: false,
    showPedagogicalNotes: false,
    showImmediatePredictionExplanations: false,
  },
};

/**
 * Resolves effective guidance level from a map of competencies to guidance levels.
 * Priority: 'guided' if any relevant competency is guided;
 * else 'prompted' if any is prompted;
 * else 'independent' if all are independent.
 */
export function resolveEffectiveGuidance(
  guidanceMap: Record<string, GuidanceLevel> | undefined,
  relevantCompetencies?: string[]
): GuidanceLevel {
  if (!guidanceMap) return 'prompted';

  const targets = relevantCompetencies && relevantCompetencies.length > 0
    ? relevantCompetencies
    : Object.keys(guidanceMap);

  if (targets.length === 0) return 'prompted';

  const levels = targets.map(c => guidanceMap[c] ?? 'prompted');

  if (levels.includes('guided')) return 'guided';
  if (levels.includes('prompted')) return 'prompted';
  return 'independent';
}

/**
 * Returns the scaffold configuration for the active run state.
 */
export function getScaffoldsForGuidance(level: GuidanceLevel): ScaffoldVisibility {
  return SCAFFOLD_CONFIG_BY_LEVEL[level];
}
