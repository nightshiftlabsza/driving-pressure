/**
 * Process classification engine: evaluates decisions by clinical process rather than outcome alone.
 * Implements the 6 process tiers from docs/overnight/02-product-architecture.md:
 * sound, sound-unlucky, reasonable-uncertain, delayed, wrong-target, unsafe, unclassified.
 */
import type { CaseFile } from '../shared/caseSchema';
import type { DeviceSettings } from '../shared/engineTypes';
import { metric, type RunState } from '../runtime/caseRuntime';
import { pbwKg } from '../engine/devices';
import type {
  ContextAtDecision,
  DecisionClassification,
  DecisionInput,
  MetricPoint,
  PhysiologyResponse,
  ProcessClass,
} from './types';

import genericRulesJson from './rules/generic.json';
import ardsRulesJson from './rules/ards-vent-01.json';
import hfncRulesJson from './rules/pneumonia-hfnc-01.json';

interface AuthoredRule {
  id: string;
  name: string;
  processClass: ProcessClass;
  explanation: string;
  source: string;
  /** Delayed-action rules: the flagged condition must still hold this many simulated seconds after the checkpoint (or at run end if sooner). */
  persistSimSec?: number;
  /** Delayed-action rules: the stated consequence must actually appear in the run record after the checkpoint. */
  requiresOutcome?: { metric: keyof MetricPoint; op: '<' | '<=' | '>' | '>='; value: number };
}

/** True when the rule's optional persistence and outcome requirements are met. Rules without them always pass. */
export function delayedRuleConfirmed(
  rule: AuthoredRule,
  checkpointSec: number,
  future: MetricPoint[],
  conditionHoldsAt: (simTimeSec: number) => boolean,
): boolean {
  if (rule.persistSimSec !== undefined) {
    const lastSec = future.length ? future[future.length - 1]!.simTimeSec : checkpointSec;
    const judgeAt = Math.min(checkpointSec + rule.persistSimSec, Math.max(lastSec, checkpointSec));
    if (!conditionHoldsAt(judgeAt)) return false;
  }
  if (rule.requiresOutcome) {
    const { metric: key, op, value } = rule.requiresOutcome;
    const hit = future.some(m => {
      const v = m[key];
      if (typeof v !== 'number' || m.simTimeSec <= checkpointSec) return false;
      return op === '<' ? v < value : op === '<=' ? v <= value : op === '>' ? v > value : v >= value;
    });
    if (!hit) return false;
  }
  return true;
}

const GENERIC_RULES = genericRulesJson as AuthoredRule[];
const ARDS_RULES = ardsRulesJson as AuthoredRule[];
const HFNC_RULES = hfncRulesJson as AuthoredRule[];

function getSettingFio2(settings: Partial<DeviceSettings> | undefined): number | undefined {
  if (!settings) return undefined;
  if ('fio2' in settings && typeof (settings as { fio2?: number }).fio2 === 'number') {
    return (settings as { fio2?: number }).fio2;
  }
  return undefined;
}

function getSettingFlowLpm(settings: Partial<DeviceSettings> | undefined): number | undefined {
  if (!settings) return undefined;
  if ('flowLpm' in settings && typeof (settings as { flowLpm?: number }).flowLpm === 'number') {
    return (settings as { flowLpm?: number }).flowLpm;
  }
  return undefined;
}

export function isRescueAction(decision: DecisionInput, stateBefore: RunState): boolean {
  if (decision.order === 'call-senior' || decision.order === 'suction' || decision.order === 'needle-decompression') {
    return true;
  }
  if (decision.order === 'disconnect-ventilator') {
    return true;
  }
  // FiO2 1.0 emergency titration when patient is severely hypoxaemic
  if (decision.kind === 'settings_change') {
    const rawSet = (decision.settings ?? (decision.detail?.settings as Partial<DeviceSettings> | undefined));
    const nextFio2 = getSettingFio2(rawSet);
    const curSpo2 = metric(stateBefore, 'spo2');
    if (nextFio2 === 1.0 && curSpo2 !== null && curSpo2 < 88) {
      return true;
    }
  }
  return false;
}

export function extractContextAtDecision(
  decision: DecisionInput,
  stateBefore: RunState
): ContextAtDecision {
  const t = Math.round(stateBefore.engine.simTimeSec);
  const abgs = stateBefore.abgs ?? [];
  const readyAbgs = abgs.filter((_, idx) => {
    // In caseRuntime, abgs array contains returned results
    return idx < abgs.length;
  });

  const lastAbg = readyAbgs.length > 0 ? readyAbgs[readyAbgs.length - 1] : null;

  const dataViewed: string[] = [];
  if (stateBefore.findings.examine) dataViewed.push('exam');
  if (stateBefore.findings.cxr) dataViewed.push('cxr');
  if (readyAbgs.length > 0) dataViewed.push('abg');

  const activeAlarms: string[] = [];
  const curSpo2 = metric(stateBefore, 'spo2');
  if (curSpo2 !== null && curSpo2 < 88) activeAlarms.push('Low SpO2');
  const curPpeak = metric(stateBefore, 'ppeak');
  if (curPpeak !== null && curPpeak > 35) activeAlarms.push('High Peak Pressure');

  return {
    simTimeSec: t,
    device: structuredClone(stateBefore.engine.device),
    monitored: {
      spo2: metric(stateBefore, 'spo2'),
      paco2: metric(stateBefore, 'paco2'),
      pao2: metric(stateBefore, 'pao2'),
      ph: metric(stateBefore, 'ph'),
      pplat: metric(stateBefore, 'pplat'),
      drivingPressure: metric(stateBefore, 'drivingPressure'),
      ppeak: metric(stateBefore, 'ppeak'),
      map: metric(stateBefore, 'map'),
      hr: metric(stateBefore, 'hr'),
      rrTotal: metric(stateBefore, 'rrTotal'),
    },
    lastAbg: lastAbg
      ? {
          drawnAtSec: Math.max(0, t - 180),
          ph: lastAbg.ph,
          paco2: lastAbg.paco2MmHg,
          pao2: lastAbg.pao2MmHg,
          sao2: lastAbg.sao2Pct,
        }
      : null,
    dataViewed,
    activeAlarms,
    committedAssessment: decision.assessment,
    confidence: decision.confidence,
    rationale: decision.rationale,
  };
}

export function computePhysiologyResponse(
  curMetrics: MetricPoint,
  futureMetrics: MetricPoint[],
  windowSimMin = 15
): PhysiologyResponse {
  if (!futureMetrics.length) {
    return {
      windowSimMin,
      deltaSpo2: null,
      deltaPaco2: null,
      deltaPh: null,
      deltaDrivingPressure: null,
      deltaPplat: null,
      summary: 'No subsequent simulation data in window.',
    };
  }

  const endSec = curMetrics.simTimeSec + windowSimMin * 60;
  const inWindow = futureMetrics.filter(m => m.simTimeSec > curMetrics.simTimeSec && m.simTimeSec <= endSec);
  const target = inWindow.length ? inWindow[inWindow.length - 1] : futureMetrics[0];

  const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 10) / 10 : null);
  const diffPh = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null);

  const deltaSpo2 = diff(target.spo2, curMetrics.spo2);
  const deltaPaco2 = diff(target.paco2, curMetrics.paco2);
  const deltaPh = diffPh(target.ph, curMetrics.ph);
  const deltaDrivingPressure = diff(target.drivingPressure, curMetrics.drivingPressure);
  const deltaPplat = diff(target.pplat, curMetrics.pplat);

  const parts: string[] = [];
  if (deltaSpo2 !== null) parts.push(`SpO2 ${deltaSpo2 >= 0 ? '+' : ''}${deltaSpo2}%`);
  if (deltaPaco2 !== null) parts.push(`PaCO2 ${deltaPaco2 >= 0 ? '+' : ''}${deltaPaco2} mmHg`);
  if (deltaPh !== null) parts.push(`pH ${deltaPh >= 0 ? '+' : ''}${deltaPh}`);
  if (deltaDrivingPressure !== null) parts.push(`ΔP ${deltaDrivingPressure >= 0 ? '+' : ''}${deltaDrivingPressure} cmH2O`);

  const summary = parts.length
    ? `In next ${Math.round((target.simTimeSec - curMetrics.simTimeSec) / 60)} min: ${parts.join(', ')}.`
    : 'No measurable physiological shift.';

  return {
    windowSimMin,
    deltaSpo2,
    deltaPaco2,
    deltaPh,
    deltaDrivingPressure,
    deltaPplat,
    summary,
  };
}

/**
 * Classify a decision using authored case rules, generic safety rules, clinical context, and physiological response.
 */
export function classifyDecision(
  decision: DecisionInput,
  decisionIndex: number,
  stateBefore: RunState,
  caseFile: CaseFile,
  futureMetrics: MetricPoint[],
  laterDecisions: DecisionInput[] = [],
): DecisionClassification {
  const context = extractContextAtDecision(decision, stateBefore);
  const curMetrics: MetricPoint = {
    simTimeSec: context.simTimeSec,
    spo2: context.monitored.spo2,
    paco2: context.monitored.paco2,
    pao2: context.monitored.pao2,
    ph: context.monitored.ph,
    pplat: context.monitored.pplat,
    drivingPressure: context.monitored.drivingPressure,
    ppeak: context.monitored.ppeak,
    peep: metric(stateBefore, 'peep'),
    vte: metric(stateBefore, 'vte'),
    vteMlKgPbw: metric(stateBefore, 'vteMlKgPbw'),
    fio2: metric(stateBefore, 'fio2'),
    map: context.monitored.map,
    hr: context.monitored.hr,
    rrTotal: context.monitored.rrTotal,
    pfRatio: metric(stateBefore, 'pfRatio'),
  };

  const response = computePhysiologyResponse(curMetrics, futureMetrics);
  const rescue = isRescueAction(decision, stateBefore);

  const pbw = pbwKg(stateBefore.engine.patient);
  const dev = stateBefore.engine.device;
  const isArds = caseFile.id === 'ards-vent-01';
  const isHfnc = caseFile.id === 'pneumonia-hfnc-01';

  // Rule match helper
  const makeResult = (rule: AuthoredRule): DecisionClassification => ({
    decisionIndex,
    decision,
    processClass: rule.processClass,
    ruleId: rule.id,
    ruleExplanation: rule.explanation,
    source: rule.source,
    context,
    response,
    isRescueAction: rescue,
  });

  // Extract settings changes if applicable
  const newSettings = (decision.settings ?? (decision.detail?.settings as Partial<DeviceSettings> | undefined)) ?? {};
  const nextVt = (newSettings as { vtSetMl?: number }).vtSetMl;
  const nextRr = (newSettings as { rrSetBpm?: number }).rrSetBpm;
  const nextPeep = (newSettings as { peep?: number }).peep;

  // --- ARDS-VENT-01 RULES ---
  if (isArds) {
    // 1. Tidal volume reduction
    if (decision.kind === 'settings_change' && nextVt !== undefined) {
      const curVt = (dev as { vtSetMl?: number }).vtSetMl ?? 650;
      if (nextVt <= 420 && curVt > 500) {
        // If learner did not increase RR and acute acidosis develops, flag as delayed RR compensation
        const rrGiven = nextRr ?? (dev as { rrSetBpm?: number }).rrSetBpm ?? 16;
        const delayedRule = ARDS_RULES.find(r => r.id === 'ARDS-01-RR-COMPENSATION-DELAYED')!;
        const rateAt = (sec: number): number => {
          let rr = rrGiven;
          for (const d of laterDecisions) {
            if (d.simTimeSec > sec) break;
            const set = (d.settings ?? (d.detail?.settings as Partial<DeviceSettings> | undefined)) as { rrSetBpm?: number } | undefined;
            if (d.kind === 'settings_change' && set?.rrSetBpm !== undefined) rr = set.rrSetBpm;
          }
          return rr;
        };
        if (rrGiven <= 18 && delayedRuleConfirmed(delayedRule, context.simTimeSec, futureMetrics, sec => rateAt(sec) <= 18)) {
          return makeResult(delayedRule);
        } else {
          const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-VT-REDUCTION-SOUND')!;
          return makeResult(rule);
        }
      }
      if (nextVt >= 650) {
        const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-HIGH-VT-MAINTAINED-UNSAFE')!;
        return makeResult(rule);
      }
    }

    // 2. Decision made before first ABG has returned (< 180s)
    if (context.simTimeSec < 180 && context.lastAbg === null) {
      if (decision.kind === 'settings_change') {
        const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-EMPIRIC-TITRATION-BEFORE-ABG')!;
        return makeResult(rule);
      }
    }

    // 3. PEEP titration
    if (decision.kind === 'settings_change' && nextPeep !== undefined && nextPeep >= 10 && nextPeep <= 16) {
      const lowestFutureMap = futureMetrics.length
        ? Math.min(...futureMetrics.map(m => m.map ?? 80))
        : (curMetrics.map ?? 80);
      if (lowestFutureMap < 65) {
        const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-PEEP-TITRATION-SOUND-UNLUCKY')!;
        return makeResult(rule);
      }
      // If learner chose moderate PEEP (10-12 cmH2O) with borderline baseline MAP (65-72 mmHg), classify as conservative reasonable-uncertain
      if (nextPeep >= 10 && nextPeep <= 12 && (curMetrics.map ?? 80) <= 72) {
        const conservativeRule = ARDS_RULES.find(r => r.id === 'ARDS-01-CONSERVATIVE-PEEP-REASONABLE');
        if (conservativeRule) return makeResult(conservativeRule);
      }
      const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-PEEP-TITRATION-SOUND')!;
      return makeResult(rule);
    }

    // 4. Prone positioning
    if (decision.kind === 'order' && decision.order === 'prone') {
      if (context.simTimeSec <= 1500) {
        const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-PRONE-SOUND')!;
        return makeResult(rule);
      } else {
        const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-PRONE-DELAYED')!;
        return makeResult(rule);
      }
    }

    // 5. Wrong target bronchodilator
    if (decision.kind === 'order' && decision.order === 'bronchodilator') {
      const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-WRONG-TARGET-BRONCHODILATOR')!;
      return makeResult(rule);
    }

    // 6. Blood gas reassessment
    if (decision.kind === 'order' && decision.order === 'abg') {
      const rule = ARDS_RULES.find(r => r.id === 'ARDS-01-ABG-REASSESSMENT-SOUND')!;
      return makeResult(rule);
    }
  }

  // --- PNEUMONIA-HFNC-01 RULES ---
  if (isHfnc) {
    // 1. Initial flow escalation on HFNC (or switching to HFNC)
    if (decision.kind === 'settings_change') {
      const devDetail = (decision.detail?.device ?? decision.settings) as DeviceSettings | undefined;
      const setDetail = (decision.detail?.settings ?? decision.settings) as Partial<DeviceSettings> | undefined;
      const hasFlow = getSettingFlowLpm(setDetail) !== undefined;
      const isHfncAction = dev.device === 'hfnc' || devDetail?.device === 'hfnc' || hasFlow;
      if (isHfncAction) {
        const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-FLOW-ESCALATION-REASONABLE-UNCERTAIN')!;
        return makeResult(rule);
      }
    }

    // 2. Intubation timing
    if (decision.kind === 'order' && decision.order === 'intubate') {
      if (context.simTimeSec <= 1800) {
        const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-INTUBATE-TIMELY-SOUND')!;
        return makeResult(rule);
      } else {
        const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-INTUBATE-DELAYED')!;
        return makeResult(rule);
      }
    }

    // 3. Post-intubation ventilator adjustment
    if (decision.kind === 'settings_change' && dev.device === 'invasive') {
      if (nextVt !== undefined) {
        const vtPerKg = nextVt / pbw;
        if (vtPerKg <= 6.5) {
          const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-POST-INTUBATION-LUNG-PROTECTIVE-SOUND')!;
          return makeResult(rule);
        } else if (vtPerKg >= 8.0) {
          const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-POST-INTUBATION-HIGH-VT-UNSAFE')!;
          return makeResult(rule);
        }
      }
    }

    // 4. Wrong target diuretic
    if (decision.kind === 'order' && decision.order === 'diuretic') {
      const rule = HFNC_RULES.find(r => r.id === 'HFNC-01-WRONG-TARGET-DIURETIC')!;
      return makeResult(rule);
    }
  }

  // --- GENERIC SAFETY RULES ---
  if (rescue) {
    const rule = GENERIC_RULES.find(r => r.id === 'GEN-RESCUE-ACTION')!;
    return makeResult(rule);
  }

  if (decision.kind === 'settings_change' && nextVt !== undefined) {
    const vtPerKg = nextVt / pbw;
    if (vtPerKg > 10.0) {
      const rule = GENERIC_RULES.find(r => r.id === 'GEN-UNSAFE-VT-EXTREME')!;
      return makeResult(rule);
    }
  }

  if (decision.kind === 'settings_change' && nextPeep !== undefined) {
    const curPeep = (dev as { peep?: number }).peep ?? 5;
    if (curPeep >= 8 && nextPeep <= 2) {
      const rule = GENERIC_RULES.find(r => r.id === 'GEN-UNSAFE-PEEP-ABRUPT-REDUCTION')!;
      return makeResult(rule);
    }
  }

  // Fallback: unclassified
  return {
    decisionIndex,
    decision,
    processClass: 'unclassified',
    ruleId: 'UNCLASSIFIED',
    ruleExplanation: 'No specific authored clinical review rule matched this action. Clinical context and outcomes are shown for reflective debriefing.',
    source: 'teaching-convention',
    context,
    response,
    isRescueAction: rescue,
  };
}

/**
 * Classify all decisions in a replayed run.
 */
export function classifyAllDecisions(
  caseFile: CaseFile,
  decisions: DecisionInput[],
  stateSnapshots: RunState[],
  metrics: MetricPoint[]
): DecisionClassification[] {
  return decisions.map((dec, idx) => {
    const stateBefore = stateSnapshots[idx] ?? stateSnapshots[0];
    const future = metrics.filter(m => m.simTimeSec >= dec.simTimeSec);
    const later = decisions.filter(d => d.simTimeSec > dec.simTimeSec).sort((a, b) => a.simTimeSec - b.simTimeSec);
    return classifyDecision(dec, idx, stateBefore, caseFile, future, later);
  });
}
