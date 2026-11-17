import { describe, it, expect } from 'vitest';
import type { CompetencyState, RunSummary } from '../shared/learnerApi';
import type { LearnerEvent } from '../shared/events';
import { deriveCompetencyStates } from '../learner/derivation';
import {
  defaultPathway,
  evaluateLevelUnlock,
  isLevelUnlocked,
  computeLevelProgress,
  buildActivityCandidatesForLevel,
  filterRecommendationsForLevel,
  getActiveLevel,
} from './unlock';
import type { PathwayLevel } from './types';
import type { CaseFile } from '../shared/caseSchema';
import type { DrillSet } from '../drills/types';
import type { LabExperiment } from '../lab/schema';

function makeState(competency: string, status: 'not_seen' | 'practising' | 'independent' | 'mastered' | 'retained'): CompetencyState {
  return {
    competency,
    status,
    guidance: 'guided',
    guidanceOverride: null,
    dueAt: null,
    intervalDays: null,
    evidenceCount: status === 'not_seen' ? 0 : 5,
    correctCount: status === 'not_seen' ? 0 : 5,
    contextsCorrect: [],
    lastEvidenceAt: null,
    calibration: {
      byConfidence: {
        guess: { answered: 0, correct: 0 },
        fairly_sure: { answered: 0, correct: 0 },
        certain: { answered: 0, correct: 0 },
      },
    },
    topMistakes: [],
  };
}

describe('Learning Pathway Unlock & Progress Logic', () => {
  const l1 = defaultPathway.levels.find(l => l.level === 1)!;
  const l2 = defaultPathway.levels.find(l => l.level === 2)!;
  const l3 = defaultPathway.levels.find(l => l.level === 3)!;
  const l4 = defaultPathway.levels.find(l => l.level === 4)!;

  it('new learner with empty profile has Level 1 unlocked and Levels 2-4 locked', () => {
    const emptyStates: CompetencyState[] = [];

    expect(isLevelUnlocked(1, emptyStates)).toBe(true);
    expect(isLevelUnlocked(2, emptyStates)).toBe(false);
    expect(isLevelUnlocked(3, emptyStates)).toBe(false);
    expect(isLevelUnlocked(4, emptyStates)).toBe(false);

    const unlock1 = evaluateLevelUnlock(l1, emptyStates);
    expect(unlock1.unlocked).toBe(true);

    const unlock2 = evaluateLevelUnlock(l2, emptyStates);
    expect(unlock2.unlocked).toBe(false);
    expect(unlock2.metCount).toBe(0);
    expect(unlock2.requiredCount).toBe(3);
    expect(unlock2.missingCompetencies).toEqual(l1.keyCompetencies);
  });

  it('unlocks Level 2 when Level 1 key competencies are mastered or independent', () => {
    // Level 1 key competencies: 'mech.eom', 'modes.vc-vs-pc', 'mech.res-vs-comp', 'wave.normal'
    // Requires min 3
    const twoMastered = [
      makeState('mech.eom', 'mastered'),
      makeState('modes.vc-vs-pc', 'independent'),
    ];
    expect(isLevelUnlocked(2, twoMastered)).toBe(false);

    const threeMastered = [
      ...twoMastered,
      makeState('mech.res-vs-comp', 'mastered'),
    ];
    expect(isLevelUnlocked(2, threeMastered)).toBe(true);
    expect(isLevelUnlocked(3, threeMastered)).toBe(false);

    const allL1Mastered = [
      ...threeMastered,
      makeState('wave.normal', 'retained'),
    ];
    expect(isLevelUnlocked(2, allL1Mastered)).toBe(true);
    expect(isLevelUnlocked(3, allL1Mastered)).toBe(false);
  });

  it('unlocks Level 3 when Level 2 key competencies are mastered', () => {
    // Level 2 key competencies: 'mech.time-constants', 'mech.auto-peep', 'gas.dead-space',
    // 'gas.hypoxaemia-mechanism', 'gas.acid-base', 'modes.peep-fio2'
    // Unlock rule for Level 3 requires min 4
    const l1States = l1.keyCompetencies.map(c => makeState(c, 'mastered'));
    const partialL2 = [
      ...l1States,
      makeState('mech.time-constants', 'mastered'),
      makeState('mech.auto-peep', 'mastered'),
      makeState('gas.dead-space', 'independent'),
    ];
    expect(isLevelUnlocked(3, partialL2)).toBe(false);

    const sufficientL2 = [
      ...partialL2,
      makeState('gas.hypoxaemia-mechanism', 'mastered'),
    ];
    expect(isLevelUnlocked(3, sufficientL2)).toBe(true);
    expect(isLevelUnlocked(4, sufficientL2)).toBe(false);
  });

  it('unlocks Level 4 when Level 3 key competencies are mastered', () => {
    // Level 3 key competencies: 'niv.selection', 'niv.titration', 'niv.hfnc', 'niv.failure', 'safety.alarm-response'
    // Unlock rule for Level 4 requires min 3
    const states = [
      makeState('niv.selection', 'mastered'),
      makeState('niv.titration', 'independent'),
      makeState('niv.hfnc', 'mastered'),
    ];
    expect(isLevelUnlocked(4, states)).toBe(true);
  });

  it('unlocks all levels regardless of competency states when overrideAll is true', () => {
    const emptyStates: CompetencyState[] = [];

    expect(isLevelUnlocked(1, emptyStates, true)).toBe(true);
    expect(isLevelUnlocked(2, emptyStates, true)).toBe(true);
    expect(isLevelUnlocked(3, emptyStates, true)).toBe(true);
    expect(isLevelUnlocked(4, emptyStates, true)).toBe(true);

    const unlock4 = evaluateLevelUnlock(4, emptyStates, true);
    expect(unlock4.unlocked).toBe(true);
    expect(unlock4.reason).toContain('Browse mode');
  });

  it('computes level progress accurately from competency states and run summaries', () => {
    const states = [
      makeState('mech.eom', 'mastered'),
      makeState('modes.vc-vs-pc', 'independent'),
    ];
    const runs: RunSummary[] = [
      {
        runId: 'r1',
        activity: 'lab',
        activityId: '01-rc-time-constant-exhalation',
        startedAt: '2026-11-09T00:00:00Z',
        endedAt: '2026-11-09T00:10:00Z',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      },
      {
        runId: 'r2',
        activity: 'lab',
        activityId: '02-vc-vs-pc-compliance',
        startedAt: '2026-11-09T00:15:00Z',
        endedAt: '2026-11-09T00:25:00Z',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      },
      // Abandoned run should not count towards completion
      {
        runId: 'r3',
        activity: 'drill',
        activityId: 'waveforms',
        startedAt: '2026-11-09T00:30:00Z',
        endedAt: null,
        outcome: 'abandoned',
        score: null,
        maxScore: null,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      },
    ];

    const progress = computeLevelProgress(1, states, runs);
    // Level 1 has 4 labs + 1 drill + 2 cases = 7 activities
    expect(progress.totalActivities).toBe(7);
    expect(progress.completedActivities).toBe(2);
    expect(progress.activityPercentage).toBe(29); // round(2/7) = 29%

    // Level 1 has 4 key competencies: mech.eom, modes.vc-vs-pc, modes.ps-spont, wave.normal
    expect(progress.totalCompetencies).toBe(4);
    expect(progress.masteredCompetencies).toBe(2);
    expect(progress.competencyPercentage).toBe(50); // 2/4 = 50%

    expect(progress.overallPercentage).toBe(40); // round((29 + 50) / 2) = 40%
  });

  it('determines the active level based on unlock and completion status', () => {
    // New learner -> Level 1
    expect(getActiveLevel([], [])?.level).toBe(1);

    // Level 1 completed (all 4 competencies mastered, activities done)
    const l1DoneStates = l1.keyCompetencies.map(c => makeState(c, 'mastered'));
    const l1DoneRuns: RunSummary[] = [
      ...l1.activities.labs.map(id => ({
        runId: `run-${id}`,
        activity: 'lab' as const,
        activityId: id,
        startedAt: '2026-11-09T00:00:00Z',
        endedAt: '2026-11-09T00:10:00Z',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      })),
      ...l1.activities.drills.map(id => ({
        runId: `run-${id}`,
        activity: 'drill' as const,
        activityId: id,
        startedAt: '2026-11-09T00:00:00Z',
        endedAt: '2026-11-09T00:10:00Z',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      })),
      ...l1.activities.cases.map(id => ({
        runId: `run-${id}`,
        activity: 'case' as const,
        activityId: id,
        startedAt: '2026-11-09T00:00:00Z',
        endedAt: '2026-11-09T00:10:00Z',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      })),
    ];

    // Since Level 1 is 100% complete and Level 2 is unlocked, active level becomes Level 2
    expect(getActiveLevel(l1DoneStates, l1DoneRuns)?.level).toBe(2);
  });

  it('builds activity candidates and filters recommendations for a level', () => {
    const mockCases: CaseFile[] = [
      {
        id: 'copd-niv-01',
        title: 'COPD NIV',
        difficulty: 1,
        competencies: ['niv.selection'],
        hiddenCompetencies: [],
        contextTags: ['copd'],
      } as unknown as CaseFile,
    ];

    const mockDrills: DrillSet[] = [
      {
        id: 'waveforms',
        title: 'Waveforms Drill',
        description: 'Practice waveforms',
        competencies: ['wave.normal'],
        items: [],
      },
    ];

    const mockLabs: LabExperiment[] = [
      {
        id: '01-rc-time-constant-exhalation',
        title: 'RC Time Constant',
        subtitle: 'RC constant and exhalation',
        difficulty: 1,
        competencies: ['mech.eom'],
        contextTags: ['rc-constant'],
      } as unknown as LabExperiment,
    ];


    const candidates = buildActivityCandidatesForLevel(1, mockCases, mockDrills, mockLabs);
    expect(candidates).toHaveLength(2); // 1 lab matched + 1 drill matched
    expect(candidates.map(c => c.id)).toContain('01-rc-time-constant-exhalation');
    expect(candidates.map(c => c.id)).toContain('waveforms');

    const recs = [
      { id: '01-rc-time-constant-exhalation', score: 0.9, reasons: ['Foundational'] },
      { id: 'copd-niv-01', score: 0.8, reasons: ['COPD case'] },
    ];
    const filtered = filterRecommendationsForLevel(recs, 1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('01-rc-time-constant-exhalation');
  });

  it('every required competency in Level 1, Level 2, and Level 3 can reach independent using only the activities within its level and prior unlocked levels', () => {
    const events: LearnerEvent[] = [];
    let idCounter = 1;

    function addEvidence(opts: {
      activity: 'lab' | 'drill' | 'case';
      activityId: string;
      competency: string;
      contextTags: string[];
      itemId?: string;
      correct?: boolean;
    }) {
      const type = opts.activity === 'drill' ? 'drill_answer' : 'prediction';
      events.push({
        v: 1,
        id: `ev-${idCounter++}`,
        wallTime: new Date(Date.now() + idCounter * 1000).toISOString(),
        sessionId: 'test-session',
        runId: `run-${opts.activityId}`,
        activity: opts.activity,
        activityId: opts.activityId,
        type,
        itemId: opts.itemId,
        competency: opts.competency,
        evidenceType: opts.activity === 'drill' ? 'question' : 'prediction',
        correct: opts.correct ?? true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: opts.contextTags,
      } as unknown as LearnerEvent);
    }

    // Level 1: 03-peep-vs-pplat, 02-vc-vs-pc-compliance, 10-ps-level-vs-vt-rr, waveforms drill
    addEvidence({ activity: 'lab', activityId: '03-peep-vs-pplat', competency: 'mech.eom', contextTags: ['peep'] });
    addEvidence({ activity: 'lab', activityId: '02-vc-vs-pc-compliance', competency: 'modes.vc-vs-pc', contextTags: ['compliance'] });
    addEvidence({ activity: 'lab', activityId: '02-vc-vs-pc-compliance', competency: 'mech.res-vs-comp', contextTags: ['compliance'] });
    addEvidence({ activity: 'lab', activityId: '10-ps-level-vs-vt-rr', competency: 'modes.ps-spont', contextTags: ['pressure-support'] });

    // waveforms drill items
    addEvidence({ activity: 'drill', activityId: 'waveforms', competency: 'wave.normal', contextTags: ['drill', 'waveforms', 'wave-06'] });
    addEvidence({ activity: 'drill', activityId: 'waveforms', competency: 'wave.normal', contextTags: ['drill', 'waveforms', 'wave-07'] });
    addEvidence({ activity: 'drill', activityId: 'waveforms', competency: 'mech.res-vs-comp', contextTags: ['drill', 'waveforms', 'wave-09'] });
    addEvidence({ activity: 'drill', activityId: 'waveforms', competency: 'modes.vc-vs-pc', contextTags: ['drill', 'waveforms', 'wave-10'] });

    const l1States = deriveCompetencyStates(events);
    expect(isLevelUnlocked(2, l1States)).toBe(true);

    // Level 2 activities
    addEvidence({ activity: 'lab', activityId: '04-rr-vs-auto-peep', competency: 'mech.time-constants', contextTags: ['auto-peep'] });
    addEvidence({ activity: 'lab', activityId: '01-rc-time-constant-exhalation', competency: 'mech.time-constants', contextTags: ['time-constant'] });
    addEvidence({ activity: 'lab', activityId: '04-rr-vs-auto-peep', competency: 'mech.auto-peep', contextTags: ['auto-peep'] });
    addEvidence({ activity: 'lab', activityId: '05-insp-flow-vs-auto-peep', competency: 'mech.auto-peep', contextTags: ['auto-peep'] });
    addEvidence({ activity: 'lab', activityId: '06-dead-space-vs-paco2', competency: 'gas.dead-space', contextTags: ['dead-space'] });
    addEvidence({ activity: 'lab', activityId: '07-vt-vs-rr-minute-ventilation', competency: 'gas.dead-space', contextTags: ['dead-space'] });
    addEvidence({ activity: 'lab', activityId: '08-fio2-vs-pao2-high-shunt', competency: 'gas.hypoxaemia-mechanism', contextTags: ['shunt'] });
    addEvidence({ activity: 'lab', activityId: '09-peep-vs-shunt-recruitment', competency: 'gas.hypoxaemia-mechanism', contextTags: ['shunt'] });
    addEvidence({ activity: 'lab', activityId: '08-fio2-vs-pao2-high-shunt', competency: 'modes.peep-fio2', contextTags: ['peep'] });
    addEvidence({ activity: 'lab', activityId: '09-peep-vs-shunt-recruitment', competency: 'modes.peep-fio2', contextTags: ['peep'] });
    addEvidence({ activity: 'drill', activityId: 'abg', competency: 'gas.acid-base', contextTags: ['drill', 'abg', 'abg-01'] });
    addEvidence({ activity: 'drill', activityId: 'abg', competency: 'gas.acid-base', contextTags: ['drill', 'abg', 'abg-02'] });

    const l2States = deriveCompetencyStates(events);
    expect(isLevelUnlocked(3, l2States)).toBe(true);
  });
});
