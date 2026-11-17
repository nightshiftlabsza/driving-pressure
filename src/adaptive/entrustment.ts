/**
 * Entrustment levels and case tier progression.
 *
 * Grounded in the Entrustable Professional Activities (EPA) framework (Ten Cate et al. 2015, 2021):
 * - Level 1: Observed (Direct bedside guidance/prompting needed)
 * - Level 2: Supervised (Acts under direct supervisor oversight)
 * - Level 3: Indirect (Acts autonomously with supervisor available on call)
 * - Level 4: Independent (Autonomous clinical practice without supervision)
 *
 * Case Tiers:
 * - Tier 1: Single problem / core presentation
 * - Tier 2: Two interacting problems / secondary complication
 * - Tier 3: Dynamic, unstable or deteriorating crisis
 *
 * NON-NEGOTIABLE RULE:
 * Entrustment NEVER rises from time spent or number of runs alone.
 * Promotion requires strict mastery criteria:
 * Independent at a tier requires:
 * 1. Last two consecutive runs at that tier with guidance `independent` for key competencies,
 * 2. Satisfactory outcome ('improved' | 'stable' | appropriate 'escalated'),
 * 3. Zero critical rubric breaches,
 * 4. Zero unresolved recurring mistakes in that tier's competencies,
 * 5. At least one passed spaced re-test in that tier's competencies.
 */

import type { LearnerEvent, GuidanceLevel } from '../shared/events';
import { isEvidenceEvent } from '../shared/events';
import { deriveMistakeLedger, getUnresolvedMistakes, type MistakeLedgerEntry } from './ledger';
import { deriveReTestSchedule, type ReTestScheduleItem } from './schedule';

export type CaseTierNumber = 1 | 2 | 3;
export type EntrustmentLevel = 'Observed' | 'Supervised' | 'Indirect' | 'Independent';

export interface CaseTierAssignment {
  caseId: string;
  title: string;
  justification: string;
  keyCompetencies: string[];
}

export interface CaseTierDefinition {
  tier: CaseTierNumber;
  name: string;
  description: string;
  cases: CaseTierAssignment[];
}

/**
 * Case tier classifications for the 8 core library cases.
 * Sourced from clinical complexity and cognitive load theory (Sweller 2011; Cook 2013).
 */
export const CASE_TIERS: Record<CaseTierNumber, CaseTierDefinition> = {
  1: {
    tier: 1,
    name: 'Tier 1: Single problem',
    description: 'Single pathophysiological mechanism requiring focused guideline-directed ventilation.',
    cases: [
      {
        caseId: 'copd-niv-01',
        title: 'Breathless at 3 a.m. on the respiratory ward',
        justification: 'Single problem: acute-on-chronic hypercapnic respiratory failure in COPD requiring NIV initiation and pressure titration. Evidence: BTS/ICS guidelines (Davidson 2016).',
        keyCompetencies: ['niv.selection', 'niv.titration', 'gas.acid-base'],
      },
      {
        caseId: 'apo-cpap-01',
        title: 'Severe orthopnoea and hypertension in the emergency department',
        justification: 'Single problem: acute cardiogenic pulmonary oedema responding to CPAP and vasodilator/diuretic preload reduction. Evidence: ESC Heart Failure guidelines.',
        keyCompetencies: ['circ.ppv-preload', 'niv.selection', 'modes.peep-fio2'],
      },
      {
        caseId: 'pneumonia-hfnc-01',
        title: 'Pneumonia on a non-rebreather in the ED',
        justification: 'Interacting problems: non-invasive HFNC trial in acute hypoxaemic failure, ROX failure threshold tracking, and transition to invasive lung-protective ventilation. Evidence: FLORALI (2015), Roca (2019).',
        keyCompetencies: ['niv.hfnc', 'niv.failure', 'disease.ards'],
      },
    ],
  },
  2: {
    tier: 2,
    name: 'Tier 2: Two interacting problems',
    description: 'Competing physiological trade-offs (e.g. oxygenation vs volutrauma, respiratory load vs metabolic compensation).',
    cases: [
      {
        caseId: 'ards-vent-01',
        title: 'Just arrived in ICU on the ED ventilator settings',
        justification: 'Interacting problems: severe shunt requiring PEEP titration and prone positioning vs low compliance requiring strict tidal volume/driving pressure limits. Evidence: ARDSNet ARMA (2000), PROSEVA (2013).',
        keyCompetencies: ['disease.ards', 'mech.driving-pressure', 'modes.peep-fio2'],
      },
      {
        caseId: 'dka-intubated-01',
        title: 'Intubated for coma: the first blood gas afterwards',
        justification: 'Interacting problems: severe metabolic ketoacidosis requiring massive compensatory minute ventilation vs hemodynamic vulnerability during induction. Evidence: teaching-convention.',
        keyCompetencies: ['disease.metabolic-acidosis', 'gas.alveolar-ventilation', 'safety.crisis'],
      },
      {
        caseId: 'dyssynchrony-01',
        title: 'Patient-ventilator dyssynchrony at 2 a.m.',
        justification: 'Interacting problems: high neural respiratory drive vs fixed ventilator flow/inspiratory time causing double triggering; requires mode/flow matching rather than masking with sedation. Evidence: Thille (2006), Beitler (2016).',
        keyCompetencies: ['wave.dyssynchrony', 'modes.dyssynchrony-management', 'modes.ie-flow-ti'],
      },
      {
        caseId: 'copd-psv-trigger-01',
        title: 'Agitated on pressure support ventilation',
        justification: 'Interacting problems: obstructive air trapping creating intrinsic PEEP (trigger dyssynchrony) combined with delayed cycle-off percentage. Evidence: Tobin (2006).',
        keyCompetencies: ['wave.dyssynchrony', 'modes.trigger-cycle', 'mech.auto-peep'],
      },
      {
        caseId: 'sbt-pass-01',
        title: 'Spontaneous breathing trial after pneumonia',
        justification: 'Single decision focus: systematic assessment of spontaneous breathing trial pass criteria and liberation without over-sedation or delayed extubation. Evidence: ATS/CHEST Liberation Guidelines (Schmidt 2017).',
        keyCompetencies: ['safety.liberation', 'safety.extubation'],
      },
    ],
  },
  3: {
    tier: 3,
    name: 'Tier 3: Dynamic or deteriorating crisis',
    description: 'Time-critical emergency, acute hemodynamic collapse, or rapid mechanical decompensation.',
    cases: [
      {
        caseId: 'asthma-vent-01',
        title: 'Severe bronchospasm and falling blood pressure after intubation',
        justification: 'Dynamic crisis: profound expiratory flow limitation and dynamic hyperinflation causing severe auto-PEEP and obstructive shock, requiring ventilator disconnection and permissive hypercapnia. Evidence: The Ventilator Book (Owens 2021).',
        keyCompetencies: ['mech.auto-peep', 'circ.auto-peep-hypotension', 'disease.obstructive'],
      },
      {
        caseId: 'sbt-fail-01',
        title: 'Spontaneous breathing trial after sepsis',
        justification: 'Interacting problems: occult load-capacity imbalance causing elevated RSBI and weaning fatigue requiring support resumption while avoiding premature extubation. Evidence: ATS/CHEST Liberation Guidelines (Girard 2017).',
        keyCompetencies: ['safety.liberation', 'safety.extubation', 'safety.reassess'],
      },
      {
        caseId: 'vent-high-pressure-01',
        title: 'Sudden high-pressure alarm and hemodynamic deterioration',
        justification: 'Dynamic crisis: sudden high peak airway pressure spike requiring DOPE algorithm, distinguishing circuit obstruction from tension pneumothorax, and urgent decompression under arrest risk. Evidence: ALS/ATLS safety protocols.',
        keyCompetencies: ['safety.alarm-response', 'safety.crisis', 'circ.ppv-preload'],
      },
    ],
  },
};

export function getTierForCase(caseId: string): CaseTierNumber | null {
  const baseId = caseId.includes('--') ? caseId.split('--')[0]! : caseId;
  for (const tierNum of [1, 2, 3] as CaseTierNumber[]) {
    if (CASE_TIERS[tierNum].cases.some(c => c.caseId === baseId)) {
      return tierNum;
    }
  }
  return null;
}

export interface TierEntrustmentStatus {
  tier: CaseTierNumber;
  name: string;
  description: string;
  level: EntrustmentLevel;
  totalRuns: number;
  successfulRuns: number;
  passedReTestsCount: number;
  unresolvedMistakesCount: number;
  keyCompetencies: string[];
  justification: string;
  nextStepRequirement: string;
}

/**
 * Pure function deriving entrustment levels across all 3 clinical tiers from events.
 */
export function deriveEntrustmentLevels(
  events: LearnerEvent[],
  options?: {
    ledger?: MistakeLedgerEntry[];
    schedule?: ReTestScheduleItem[];
    tutorExchanges?: { runId?: string; levelUsed?: number; cap?: number; assisted?: boolean }[];
    now?: Date;
  }
): Record<CaseTierNumber, TierEntrustmentStatus> {
  const ledger = options?.ledger ?? deriveMistakeLedger(events);
  const schedule = options?.schedule ?? deriveReTestSchedule(events, options?.now);
  const assistedRunMap = new Map<string, { assistedInRun: boolean; assistedLevel2Or3: boolean }>();

  for (const ex of options?.tutorExchanges ?? []) {
    if (!ex.runId || ex.assisted === false) continue;
    const prev = assistedRunMap.get(ex.runId) ?? { assistedInRun: false, assistedLevel2Or3: false };
    prev.assistedInRun = true;
    const lvl = ex.levelUsed ?? ex.cap ?? 0;
    if (lvl >= 2) prev.assistedLevel2Or3 = true;
    assistedRunMap.set(ex.runId, prev);
  }

  // Group events into runs
  interface RunRecord {
    runId: string;
    caseId: string;
    startTime: string;
    endTime: string;
    outcome: string;
    guidanceByComp: Record<string, GuidanceLevel>;
    criticalRubricBreaches: number;
    mistakesCount: number;
    assistedInRun: boolean;
    assistedLevel2Or3: boolean;
  }

  const runMap = new Map<string, RunRecord>();
  const runOrder: string[] = [];

  for (const e of events) {
    const runId = e.runId;
    if (!runId) continue;

    let r = runMap.get(runId);
    if (!r) {
      const fromExchange = assistedRunMap.get(runId);
      r = {
        runId,
        caseId: e.activityId || '',
        startTime: e.wallTime,
        endTime: e.wallTime,
        outcome: 'in_progress',
        guidanceByComp: {},
        criticalRubricBreaches: 0,
        mistakesCount: 0,
        assistedInRun: fromExchange?.assistedInRun ?? false,
        assistedLevel2Or3: fromExchange?.assistedLevel2Or3 ?? false,
      };
      runMap.set(runId, r);
      runOrder.push(runId);
    }

    if (e.activityId && !r.caseId) {
      r.caseId = e.activityId;
    }
    r.endTime = e.wallTime;

    if (e.type === 'run_start') {
      r.guidanceByComp = { ...e.guidanceByCompetency };
    }

    if (e.type === 'run_end') {
      r.outcome = e.outcome;
    }

    if (e.type === 'rubric_result' && !e.met && e.critical) {
      r.criticalRubricBreaches++;
    }

    if (e.type === 'mistake') {
      r.mistakesCount++;
    }

    if (e.type === 'hint_shown') {
      r.assistedInRun = true;
      if (e.level >= 2) r.assistedLevel2Or3 = true;
    }

    if (isEvidenceEvent(e) && e.assistance?.assistedInWindow) {
      r.assistedInRun = true;
      if (e.assistance.maxHelpLevelUsed >= 2) {
        r.assistedLevel2Or3 = true;
      }
    }
  }

  // Sort runs chronologically
  runOrder.sort((a, b) => {
    const ra = runMap.get(a)!;
    const rb = runMap.get(b)!;
    return new Date(ra.startTime).getTime() - new Date(rb.startTime).getTime();
  });

  // Calculate entrustment for each tier
  const result: Partial<Record<CaseTierNumber, TierEntrustmentStatus>> = {};

  for (const tierNum of [1, 2, 3] as CaseTierNumber[]) {
    const tierDef = CASE_TIERS[tierNum];
    const tierCaseIds = new Set(tierDef.cases.map(c => c.caseId));
    const tierKeyCompetencies = Array.from(new Set(tierDef.cases.flatMap(c => c.keyCompetencies)));

    // Find runs belonging to this tier (including variants that map to these base cases)
    const tierRuns = runOrder
      .map(id => runMap.get(id)!)
      .filter(r => {
        const baseId = r.caseId.includes('--') ? r.caseId.split('--')[0] : r.caseId;
        return tierCaseIds.has(baseId);
      });

    const totalRuns = tierRuns.length;
    const completedRuns = tierRuns.filter(r => r.outcome !== 'in_progress' && r.outcome !== 'abandoned');
    const successfulRuns = completedRuns.filter(
      r => r.outcome === 'improved' || r.outcome === 'stable' || r.outcome === 'escalated'
    );

    // Unresolved mistakes affecting this tier's competencies
    const unresolvedAtTier = getUnresolvedMistakes(ledger, tierKeyCompetencies);
    const unresolvedMistakesCount = unresolvedAtTier.length;

    // Passed clean re-tests affecting this tier's competencies (at least box 2+)
    const passedReTestsAtTier = schedule.filter(
      item => tierKeyCompetencies.includes(item.competencyId) && item.box >= 2
    );
    const passedReTestsCount = passedReTestsAtTier.length;

    let level: EntrustmentLevel = 'Observed';
    let nextStepRequirement = 'Complete a simulation run at this tier without fatal outcomes.';

    if (completedRuns.length > 0 && completedRuns.some(r => r.outcome !== 'died')) {
      level = 'Supervised';
      nextStepRequirement =
        'Achieve at least 2 successful runs with no critical rubric breaches and prompted/independent guidance.';
    }

    if (level === 'Supervised' && successfulRuns.length >= 2) {
      // Check if runs had no critical rubric breaches, progressed beyond purely guided scaffolding, and did not rely on Level 2/3 tutor reveals
      const runsWithoutCriticalBreaches = successfulRuns.filter(r => {
        const comps = Object.values(r.guidanceByComp);
        const nonGuided = comps.length > 0 && comps.some(g => g !== 'guided');
        return r.criticalRubricBreaches === 0 && nonGuided && !r.assistedLevel2Or3;
      });
      const hasUnresolvedCritical = unresolvedAtTier.some(m => m.severities.includes('critical'));

      if (runsWithoutCriticalBreaches.length >= 2 && !hasUnresolvedCritical) {
        level = 'Indirect';
        nextStepRequirement =
          'Demonstrate mastery: 2 consecutive unaided runs with independent guidance, zero mistakes, and at least 1 passed spaced re-test.';
      }
    }

    if (level === 'Indirect') {
      // Check strict mastery rule for Independent:
      // 1. Last two consecutive completed runs at this tier:
      //    - successful outcome (improved/stable/escalated)
      //    - zero critical rubric breaches
      //    - zero mistakes recorded
      //    - independent guidance across all tested competencies in that run (non-empty)
      //    - completely unaided (no tutor assistance or Level 2/3 reveal in run)
      // 2. Zero unresolved recurring mistakes in this tier
      // 3. At least one passed clean re-test
      if (completedRuns.length >= 2) {
        const lastTwo = completedRuns.slice(-2);
        const lastTwoClean = lastTwo.every(r => {
          const isSuccess = r.outcome === 'improved' || r.outcome === 'stable' || r.outcome === 'escalated';
          const noCritical = r.criticalRubricBreaches === 0;
          const noMistakes = r.mistakesCount === 0;

          const guidanceValues = Object.values(r.guidanceByComp);
          const guidanceOk = guidanceValues.length > 0 && guidanceValues.every(g => g === 'independent');

          return isSuccess && noCritical && noMistakes && guidanceOk && !r.assistedInRun;
        });

        const hasNoRecurringMistakes = unresolvedAtTier.every(m => m.count < 2);
        const hasPassedReTest = passedReTestsCount >= 1;

        if (lastTwoClean && hasNoRecurringMistakes && hasPassedReTest) {
          level = 'Independent';
          nextStepRequirement = 'Mastery achieved. Maintain competence via periodic spaced retention checks.';
        }
      }
    }

    result[tierNum] = {
      tier: tierNum,
      name: tierDef.name,
      description: tierDef.description,
      level,
      totalRuns,
      successfulRuns: successfulRuns.length,
      passedReTestsCount,
      unresolvedMistakesCount,
      keyCompetencies: tierKeyCompetencies,
      justification: tierDef.cases.map(c => `${c.caseId}: ${c.justification}`).join(' '),
      nextStepRequirement,
    };
  }

  return result as Record<CaseTierNumber, TierEntrustmentStatus>;
}
