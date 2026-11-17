/**
 * Mechanistic dyssynchrony detection and state tracking for mechanical ventilation.
 * Owned by Sub-agent 4 (Dyssynchrony & phase machine).
 *
 * Literature citations:
 * - Double triggering: Thille AW, Rodriguez P, Cabello B, et al. Intensive Care Med 2006; 32(10):1515-1522;
 *   de Wit M, et al. Crit Care 2009; 13(4):R109.
 * - Premature & delayed cycling in PSV: Tassaux D, Gainnier M, Battisti A, Jolliet P. Crit Care Med 2005; 33(6):1263-1269;
 *   Yamada Y, Du HL. Crit Care Med 2000; 28(7):2463-2473.
 * - Flow starvation in VC-AC: Marini JJ, Rodriguez RM, Lamb VJ. Am Rev Respir Dis 1986; 134(5):902-909;
 *   MacIntyre NR. Respir Care 2011; 56(1):43-57.
 * - Auto-triggering from circuit leak: Imanaka H, Nishimura M, Takeuchi M, et al. Am J Respir Crit Care Med 2000; 161(2 Pt 1):478-483.
 * - Reverse triggering: Akoumianaki E, Lyazidi A, Rey N, et al. Chest 2013; 143(4):927-938.
 */

import type { EngineState } from '../shared/engineTypes';
import { setPeepLevel } from './devices';
import {
  type BreathKind,
  I,
  PMUS_RELAX_TAU,
} from './types';

/**
 * Evaluates whether an entrained diaphragmatic effort from reverse triggering is active.
 * Akoumianaki E, et al. Chest 2013; 143(4):927-938.
 */
export function reverseTriggerPmus(s: EngineState, t: number): number {
  const x = I(s);
  if (typeof x.reverseTriggerEffortStart !== 'number' || x.reverseTriggerEffortStart < 0) {
    return 0;
  }
  const te = t - x.reverseTriggerEffortStart;
  const ti = typeof x.reverseTriggerEffortTi === 'number' ? x.reverseTriggerEffortTi : 0.6;
  const amp = typeof x.reverseTriggerEffortAmp === 'number' ? x.reverseTriggerEffortAmp : 8.0;

  if (te < 0) return 0;
  if (te < ti) {
    return (amp * (1 - Math.cos((Math.PI * te) / ti))) / 2;
  }
  const rel = te - ti;
  if (rel < 5 * PMUS_RELAX_TAU) {
    return amp * Math.exp(-rel / PMUS_RELAX_TAU);
  }
  return 0;
}

/**
 * Checks whether persistent neural effort outlasting ventilator inspiratory time
 * double-triggers an immediate second breath upon expiration refractory elapsed.
 * Thille AW, et al. Intensive Care Med 2006; 32(10):1515-1522.
 */
export function checkDoubleTrigger(
  s: EngineState,
  t: number,
  canPatientTrigger: boolean,
  currentPmus: number
): boolean {
  const x = I(s);
  const p = s.patient;
  if (!canPatientTrigger || x.phase !== 'exp') return false;
  if (p.spontRateBpm <= 0 || p.pmusAmplitudeCmH2O < 10) return false;
  if (x.effortStart < 0) return false;
  // Prevent runaway multiple triggers on the exact same patient effort
  if (x.lastDoubleTriggerEffort === x.effortStart) return false;

  // Double triggering is an immediate second breath triggered by the SAME strong effort that triggered or occurred during the preceding inspiration.
  // If the effort started during expiration AFTER the preceding breath ended, it is an ordinary trigger attempt (or ineffective effort), NOT a double trigger.
  if (typeof x.inspEnd === 'number' && x.effortStart > x.inspEnd) return false;

  // Neural Ti must substantially outlast ventilator Ti
  if (typeof x.accTiSec === 'number' && p.pmusInspTimeSec < 1.4 * x.accTiSec) return false;

  const timeSinceBreathStart = t - x.breathStart;
  if (currentPmus >= 4.0 && timeSinceBreathStart < p.pmusInspTimeSec + 0.5) {
    return true;
  }
  return false;
}

/**
 * Checks whether unintentional invasive circuit leak exceeds flow trigger sensitivity,
 * producing runaway auto-triggering independent of patient muscular effort.
 * Imanaka H, et al. Am J Respir Crit Care Med 2000; 161(2 Pt 1):478-483.
 */
export function checkAutoTrigger(
  s: EngineState,
  canPatientTrigger: boolean
): boolean {
  const d = s.device;
  if (d.device !== 'invasive' || !canPatientTrigger) return false;
  const circuitLeak = d.circuitLeakLpm ?? 0;
  const triggerFlow = d.triggerFlowLpm ?? 2.0;
  return circuitLeak > triggerFlow;
}

/**
 * Checks whether PSV expiratory cycle-off criteria was met prematurely while
 * patient neural inspiratory effort is still ongoing (tIn < Ti_neural).
 * Tassaux D, et al. Crit Care Med 2005; 33(6):1263-1269.
 */
export function checkPrematureCycling(
  s: EngineState,
  tIn: number,
  currentPmus: number
): boolean {
  const x = I(s);
  const p = s.patient;
  if (x.control !== 'ps') return false;
  if (p.spontRateBpm <= 0 || p.pmusAmplitudeCmH2O <= 0) return false;

  // Cycle-off occurred before neural inspiratory time (and before the 3-second safety cutoff)
  if (tIn < p.pmusInspTimeSec && tIn < 2.9) {
    if (currentPmus > 1.0 || currentPmus >= 0.2 * p.pmusAmplitudeCmH2O) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether PSV expiratory cycle-off criteria excessively prolongs ventilator
 * inspiratory time beyond neural inspiratory time (tIn > Ti_neural + 0.05s) in obstructive mechanics.
 * Yamada Y, Du HL. Crit Care Med 2000; 28(7):2463-2473; Tassaux D, et al. Crit Care Med 2005; 33(6):1263-1269.
 */
export function checkDelayedCycling(
  s: EngineState,
  tIn: number
): boolean {
  const x = I(s);
  const p = s.patient;
  const d = s.device;
  if (x.control !== 'ps') return false;
  if (p.spontRateBpm <= 0 || p.pmusAmplitudeCmH2O <= 0) return false;

  const cycleOffPct = (d.device === 'invasive' ? d.cycleOffPct ?? d.cyclePctPeakFlow ?? 25 : 25);
  // Low cycle-off criteria (<= 15% of peak flow) prolongs inspiration past neural Ti in obstructive mechanics
  if (cycleOffPct <= 15 && tIn > p.pmusInspTimeSec + 0.05) {
    return true;
  }
  return false;
}

/**
 * Checks whether fixed inspiratory flow in VC-AC is insufficient to meet patient demand,
 * leading to downward scooping of airway pressure and flow starvation.
 * Marini JJ, et al. Am Rev Respir Dis 1986; 134(5):902-909.
 */
export function checkFlowStarvation(
  s: EngineState
): boolean {
  const x = I(s);
  const p = s.patient;
  const d = s.device;
  if (x.control !== 'vc') return false;
  if (p.pmusAmplitudeCmH2O < 12) return false;

  const setFlow = (d.device === 'invasive' ? d.inspFlowLpm : undefined) ?? 60;
  const demandLpm = ((p.pmusAmplitudeCmH2O * p.complianceMlPerCmH2O * 0.001) / p.pmusInspTimeSec) * 60;
  const starvationThreshold = demandLpm * 0.75;
  if (setFlow >= starvationThreshold) return false;

  const peep = setPeepLevel(d) ?? 0;
  // Paw dips near or below PEEP baseline during inspiration
  const minPaw = typeof x.minInspPaw === 'number' ? x.minInspPaw : peep - 1;
  return minPaw <= peep + 0.5;
}

/**
 * Evaluates rule-based neuromechanical coupling (reverse triggering) in a passive/sedated patient.
 * Akoumianaki E, et al. Chest 2013; 143(4):927-938.
 */
export function checkReverseTrigger(
  s: EngineState,
  t: number,
  kind: BreathKind
): boolean {
  const p = s.patient;
  const prob = p.reverseTriggerProbability ?? 0;
  if (kind !== 'mandatory' || p.spontRateBpm > 0 || prob <= 0) {
    return false;
  }
  const x = I(s);
  const breathIdx = (typeof x.mandatoryBreathCount === 'number' ? x.mandatoryBreathCount : 0) + 1;
  x.mandatoryBreathCount = breathIdx;

  // Pure deterministic Weyl sequence for uniform low-discrepancy trigger distribution
  const frac = (breathIdx * 0.618033988749895) % 1;
  if (frac < prob) {
    x.reverseTriggerCount = (x.reverseTriggerCount ?? 0) + 1;
    // Entrained diaphragmatic contraction onset 200 ms (100-300 ms) after mechanical breath onset
    x.reverseTriggerEffortStart = t + 0.20;
    x.reverseTriggerEffortTi = Math.min(0.6, p.pmusInspTimeSec > 0 ? p.pmusInspTimeSec : 0.6);
    x.reverseTriggerEffortAmp = Math.max(p.pmusAmplitudeCmH2O, 8.0);
    return true;
  }
  return false;
}
