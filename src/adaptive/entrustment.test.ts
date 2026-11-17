import { describe, it, expect } from 'vitest';
import type { LearnerEvent } from '../shared/events';
import { deriveEntrustmentLevels, CASE_TIERS } from './entrustment';

describe('Entrustment Levels & Case Tiers (src/adaptive/entrustment.ts)', () => {
  it('assigns all 11 core library cases to tiers with clinical justifications', () => {
    const tier1Cases = CASE_TIERS[1].cases.map(c => c.caseId);
    const tier2Cases = CASE_TIERS[2].cases.map(c => c.caseId);
    const tier3Cases = CASE_TIERS[3].cases.map(c => c.caseId);

    expect(tier1Cases).toEqual(expect.arrayContaining(['copd-niv-01', 'apo-cpap-01', 'pneumonia-hfnc-01']));
    expect(tier2Cases).toEqual(
      expect.arrayContaining([
        'ards-vent-01',
        'copd-psv-trigger-01',
        'dka-intubated-01',
        'dyssynchrony-01',
        'sbt-pass-01',
      ])
    );
    expect(tier3Cases).toEqual(
      expect.arrayContaining(['asthma-vent-01', 'sbt-fail-01', 'vent-high-pressure-01'])
    );

    // Total of 11 distinct cases
    const totalAssigned = new Set([...tier1Cases, ...tier2Cases, ...tier3Cases]);
    expect(totalAssigned.size).toBe(11);

    // Every case has a justification citing guidelines or clinical mechanisms
    for (const tier of [1, 2, 3] as const) {
      for (const c of CASE_TIERS[tier].cases) {
        expect(c.justification.length).toBeGreaterThan(20);
        expect(c.keyCompetencies.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('starts at Observed when no events exist', () => {
    const status = deriveEntrustmentLevels([]);
    expect(status[1].level).toBe('Observed');
    expect(status[2].level).toBe('Observed');
    expect(status[3].level).toBe('Observed');
    expect(status[1].totalRuns).toBe(0);
  });

  it('PROVES ENTRUSTMENT CANNOT RISE FROM RUN COUNT ALONE (many runs with persistent mistakes never promote to Independent)', () => {
    // Synthetic history: Learner performs 30 runs of Tier 1 cases (copd-niv-01)
    // but in every run commits an unsafe action (over-oxygenation) and fails the critical rubric
    const events: LearnerEvent[] = [];

    for (let i = 1; i <= 30; i++) {
      const runId = `run-${i}`;
      const day = i < 10 ? `0${i}` : `${i}`;
      const time = `2026-10-${day}T10:00:00Z`;

      events.push(
        {
          v: 1,
          id: `start-${i}`,
          wallTime: time,
          sessionId: `sess-${i}`,
          runId,
          activity: 'case',
          activityId: 'copd-niv-01',
          type: 'run_start',
          guidanceByCompetency: {
            'niv.selection': 'guided',
            'niv.titration': 'guided',
            'gas.acid-base': 'guided',
          },
        },
        {
          v: 1,
          id: `mistake-${i}`,
          wallTime: `2026-10-${day}T10:15:00Z`,
          sessionId: `sess-${i}`,
          runId,
          activity: 'case',
          activityId: 'copd-niv-01',
          type: 'mistake',
          mistake: 'unsafe_action',
          competency: 'modes.peep-fio2',
          severity: 'major',
          detail: 'Over-oxygenation in hypercapnia',
        },
        {
          v: 1,
          id: `rubric-${i}`,
          wallTime: `2026-10-${day}T10:20:00Z`,
          sessionId: `sess-${i}`,
          runId,
          activity: 'case',
          activityId: 'copd-niv-01',
          type: 'rubric_result',
          rubricId: 'r-niv-start',
          met: false,
          critical: true,
          competency: 'niv.selection',
          evidenceType: 'decision',
          correct: false,
          guidance: 'guided',
          hidden: false,
        },
        {
          v: 1,
          id: `end-${i}`,
          wallTime: `2026-10-${day}T10:30:00Z`,
          sessionId: `sess-${i}`,
          runId,
          type: 'run_end',
          outcome: 'deteriorated',
        }
      );
    }

    const status = deriveEntrustmentLevels(events);

    // 30 runs completed!
    expect(status[1].totalRuns).toBe(30);

    // MUST NOT be Independent or Indirect!
    // Stays at Supervised because mastery criteria were never demonstrated.
    expect(status[1].level).not.toBe('Independent');
    expect(status[1].level).not.toBe('Indirect');
    expect(status[1].level).toBe('Supervised');
  });

  it('promotes to Independent only upon full mastery (consecutive clean runs, independent guidance, passed re-test)', () => {
    const events: LearnerEvent[] = [
      // Run 1: Tier 1 initial mistake (enters Leitner Box 1)
      {
        v: 1,
        id: 'start-1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'run_start',
        guidanceByCompetency: {
          'niv.selection': 'prompted',
          'niv.titration': 'prompted',
          'gas.acid-base': 'prompted',
        },
      },
      {
        v: 1,
        id: 'm-1',
        wallTime: '2026-11-01T10:15:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'faulty_model',
        competency: 'niv.titration',
        severity: 'major',
        detail: 'Under-titrated IPAP',
      },
      {
        v: 1,
        id: 'end-1',
        wallTime: '2026-11-01T10:30:00Z',
        sessionId: 's1',
        runId: 'r1',
        type: 'run_end',
        outcome: 'improved',
      },

      // Run 2: Successful re-test on variant copd-niv-01--exhaustion-failure (advances to Box 2)
      {
        v: 1,
        id: 'start-2',
        wallTime: '2026-11-02T10:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'copd-niv-01--exhaustion-failure',
        type: 'run_start',
        guidanceByCompetency: {
          'niv.selection': 'independent',
          'niv.titration': 'independent',
          'gas.acid-base': 'independent',
        },
      },
      {
        v: 1,
        id: 'rub-2',
        wallTime: '2026-11-02T10:20:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'copd-niv-01--exhaustion-failure',
        type: 'rubric_result',
        rubricId: 'r-ph-improving',
        met: true,
        critical: false,
        competency: 'niv.titration',
        evidenceType: 'decision',
        correct: true,
        guidance: 'independent',
        hidden: false,
      },
      {
        v: 1,
        id: 'end-2',
        wallTime: '2026-11-02T10:30:00Z',
        sessionId: 's2',
        runId: 'r2',
        type: 'run_end',
        outcome: 'improved',
      },

      // Run 3: Second consecutive flawless run at Tier 1 with independent guidance
      {
        v: 1,
        id: 'start-3',
        wallTime: '2026-11-03T10:00:00Z',
        sessionId: 's3',
        runId: 'r3',
        activity: 'case',
        activityId: 'apo-cpap-01',
        type: 'run_start',
        guidanceByCompetency: {
          'circ.ppv-preload': 'independent',
          'niv.selection': 'independent',
          'modes.peep-fio2': 'independent',
        },
      },
      {
        v: 1,
        id: 'rub-3',
        wallTime: '2026-11-03T10:20:00Z',
        sessionId: 's3',
        runId: 'r3',
        activity: 'case',
        activityId: 'apo-cpap-01',
        type: 'rubric_result',
        rubricId: 'r-cpap',
        met: true,
        critical: false,
        competency: 'circ.ppv-preload',
        evidenceType: 'decision',
        correct: true,
        guidance: 'independent',
        hidden: false,
      },
      {
        v: 1,
        id: 'end-3',
        wallTime: '2026-11-03T10:30:00Z',
        sessionId: 's3',
        runId: 'r3',
        type: 'run_end',
        outcome: 'improved',
      },
    ];

    const status = deriveEntrustmentLevels(events);
    expect(status[1].level).toBe('Independent');
    expect(status[1].passedReTestsCount).toBeGreaterThanOrEqual(1);
    expect(status[1].unresolvedMistakesCount).toBe(0);
  });

  it('does not promote all-guided or empty-guidance runs to Indirect or Independent', () => {
    const guidedCleanRuns: LearnerEvent[] = [1, 2, 3].flatMap(i => [
      {
        v: 1,
        id: `g-start-${i}`,
        wallTime: `2026-11-0${i}T10:00:00Z`,
        sessionId: `gs-${i}`,
        runId: `gr-${i}`,
        activity: 'case' as const,
        activityId: 'copd-niv-01',
        type: 'run_start' as const,
        guidanceByCompetency: { 'niv.selection': 'guided' as const },
      },
      {
        v: 1,
        id: `g-end-${i}`,
        wallTime: `2026-11-0${i}T10:20:00Z`,
        sessionId: `gs-${i}`,
        runId: `gr-${i}`,
        type: 'run_end' as const,
        outcome: 'improved' as const,
      },
    ]);
    expect(deriveEntrustmentLevels(guidedCleanRuns)[1].level).toBe('Supervised');

    const emptyGuidanceRuns: LearnerEvent[] = [
      ...guidedCleanRuns,
      {
        v: 1,
        id: 'm1',
        wallTime: '2026-11-04T09:00:00Z',
        sessionId: 'se',
        runId: 'er-0',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'knowledge_gap',
        competency: 'niv.selection',
        severity: 'minor',
        detail: 'Minor',
      },
      {
        v: 1,
        id: 'e-start-1',
        wallTime: '2026-11-05T10:00:00Z',
        sessionId: 'se1',
        runId: 'er-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'e-end-1',
        wallTime: '2026-11-05T10:20:00Z',
        sessionId: 'se1',
        runId: 'er-1',
        type: 'run_end',
        outcome: 'improved',
      },
    ];
    expect(deriveEntrustmentLevels(emptyGuidanceRuns)[1].level).not.toBe('Independent');
  });

  it('never promotes runs assisted at Level 2/3 or with tutor help to Indirect or Independent entrustment', () => {
    const baseEvents: LearnerEvent[] = [1, 2, 3].flatMap(i => [
      {
        v: 1,
        id: `a-start-${i}`,
        wallTime: `2026-11-0${i}T10:00:00Z`,
        sessionId: `as-${i}`,
        runId: `ar-${i}`,
        activity: 'case' as const,
        activityId: 'copd-niv-01',
        type: 'run_start' as const,
        guidanceByCompetency: { 'niv.selection': 'independent' as const, 'niv.titration': 'independent' as const },
      },
      {
        v: 1,
        id: `a-rubric-${i}`,
        wallTime: `2026-11-0${i}T10:15:00Z`,
        sessionId: `as-${i}`,
        runId: `ar-${i}`,
        type: 'rubric_result' as const,
        rubricId: `r-${i}`,
        met: true,
        critical: false,
        competency: 'niv.selection',
        evidenceType: 'decision' as const,
        correct: true,
        guidance: 'independent' as const,
        hidden: false,
        assistance: {
          assistedInWindow: true,
          maxHelpLevelUsed: 2,
          hintCountInProblem: 1,
          tutorTurnsBeforeCommit: 1,
          reconstructionPassed: true,
          timeToFirstHypothesisMs: 12000,
        },
      },
      {
        v: 1,
        id: `a-end-${i}`,
        wallTime: `2026-11-0${i}T10:20:00Z`,
        sessionId: `as-${i}`,
        runId: `ar-${i}`,
        type: 'run_end' as const,
        outcome: 'improved' as const,
      },
    ]);

    const entrust = deriveEntrustmentLevels(baseEvents);
    expect(entrust[1].level).toBe('Supervised');

    const exchangeAssisted = deriveEntrustmentLevels(
      baseEvents.map(e => (e.type === 'rubric_result' ? { ...e, assistance: undefined } : e)),
      {
        tutorExchanges: [
          { runId: 'ar-1', levelUsed: 2, assisted: true },
          { runId: 'ar-2', levelUsed: 2, assisted: true },
          { runId: 'ar-3', levelUsed: 1, assisted: true },
        ],
      }
    );
    expect(exchangeAssisted[1].level).toBe('Supervised');
  });
});
