import { describe, it, expect } from 'vitest';
import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import { selectNextCase } from './nextCase';
import type { CaseVariantMetadata } from '../cases/variants/loader';

describe('Adaptive Next-Case Selection (src/adaptive/nextCase.ts)', () => {
  const dummyCase = (id: string, competencies: string[], contextTags: string[]): CaseFile =>
    ({
      schemaVersion: '1.0',
      id,
      version: '0.1.0',
      title: `Case ${id}`,
      summary: `Summary of ${id}`,
      difficulty: 1,
      setting: 'icu',
      competencies,
      hiddenCompetencies: [],
      contextTags,
      evidence: [
        {
          claim: 'Guideline claim',
          source: 'Ref',
          year: 2020,
          kind: 'guideline',
        },
      ],
      patient: {
        displayName: 'Synthetic patient',
        presentingStory: 'Story',
        history: 'History',
        params: {
          sex: 'M',
          ageYears: 50,
          heightCm: 175,
          actualWeightKg: 70,
          complianceMlPerCmH2O: 40,
          inspResistanceCmH2OPerLps: 10,
          expResistanceCmH2OPerLps: 10,
          spontRateBpm: 0,
          pmusAmplitudeCmH2O: 0,
          pmusInspTimeSec: 0.8,
          vco2MlPerMin: 250,
          vo2MlPerMin: 300,
          anatomicDeadSpaceMl: 150,
          alveolarDeadSpaceFraction: 0.3,
          shuntFraction: 0.2,
          recruitability: 0.3,
          hbGPerDl: 14,
          temperatureC: 37,
          baselineHco3MmolL: 24,
          hrBaselineBpm: 80,
          sbpBaselineMmHg: 120,
          dbpBaselineMmHg: 80,
          ppvResponse: 'unhelpful',
          ppvSeverity: 0.2,
          respiratoryReserve: 0.5,
        },
      },
      initialDevice: {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.5,
        peep: 5,
        rrSetBpm: 14,
        vtSetMl: 450,
      },
      initialPhys: { paco2MmHg: 40 },
      availableOrders: ['abg'],
      orderEffects: [],
      findings: { examine: 'Exam', cxr: 'CXR' },
      course: [],
      triggers: [
        {
          id: 'end',
          when: { threshold: { metric: 'simMin', op: '>=', value: 10 } },
          then: [{ type: 'endCase', outcome: 'improved', reason: 'Done' }],
        },
      ],
      predictionPoints: [],
      rubric: [
        {
          id: 'r1',
          description: 'Rubric',
          competency: competencies[0],
          evidenceType: 'decision',
          met: { threshold: { metric: 'simMin', op: '>=', value: 1 } },
        },
      ],
      maxSimMin: 60,
      debrief: { keyPoints: ['Done'], resources: [] },
    } as unknown as CaseFile);

  const candidates: CaseFile[] = [
    dummyCase('ards-vent-01', ['disease.ards', 'mech.driving-pressure'], ['ards', 'invasive']),
    dummyCase('copd-niv-01', ['niv.selection', 'modes.peep-fio2'], ['copd', 'niv']),
    dummyCase('pneumonia-hfnc-01', ['niv.hfnc', 'niv.failure'], ['pneumonia', 'hfnc']),
    dummyCase('ards-vent-01--pbw-short-female', ['disease.ards'], ['ards', 'variant']),
  ];

  const variantsMeta: Record<string, CaseVariantMetadata> = {
    'ards-vent-01--pbw-short-female': {
      variantId: 'ards-vent-01--pbw-short-female',
      baseCaseId: 'ards-vent-01',
      title: 'Disguised ARDS Variant',
      summary: 'Summary',
      rationale: 'PBW trap',
      retestsMistake: {
        mistakeId: 'knowledge_gap',
        competencyId: 'disease.ards',
        clinicalFocus: 'PBW',
      },
      source: 'ARDSNet 2000; teaching-convention',
      changes: { vignette: 'Female', parametersChanged: {} },
      overlay: {},
    },
  };

  it('returns null if candidates array is empty', () => {
    expect(selectNextCase([])).toBeNull();
  });

  it('selects new learning when learner has no past mistakes, interleaving pathology', () => {
    // If learner just did copd-niv-01, next case should interleave away from copd
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'e1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'run_end',
        outcome: 'improved',
        contextTags: ['copd', 'niv'],
      },
    ];

    const recommendation = selectNextCase(candidates, events, { variantsMeta });
    expect(recommendation).not.toBeNull();
    expect(recommendation?.kind).toBe('new_learning');
    // Should choose an unseen base case that is NOT copd (interleaving!)
    expect(['ards-vent-01', 'pneumonia-hfnc-01']).toContain(recommendation?.caseId);
  });

  it('prioritizes a due re-test and selects a disguised variant without revealing the target', () => {
    // Learner made a mistake on disease.ards in ards-vent-01
    const mistakeTime = '2026-11-01T10:00:00Z';
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'start1',
        wallTime: mistakeTime,
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'm1',
        wallTime: '2026-11-01T10:15:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'mistake',
        mistake: 'knowledge_gap',
        competency: 'disease.ards',
        severity: 'major',
        detail: 'Vt > 8 mL/kg PBW',
      },
      {
        v: 1,
        id: 'end1',
        wallTime: '2026-11-01T10:30:00Z',
        sessionId: 's1',
        runId: 'r1',
        type: 'run_end',
        outcome: 'improved',
      },
    ];

    // Check 2 days later (Box 1 is 1 day, so re-test is due)
    const now = new Date('2026-11-03T10:00:00Z');
    const rec = selectNextCase(candidates, events, { now, variantsMeta });

    expect(rec).not.toBeNull();
    expect(rec?.kind).toBe('retest');
    // Should choose the disguised variant ards-vent-01--pbw-short-female
    expect(rec?.caseId).toBe('ards-vent-01--pbw-short-female');

    // CRITICAL: Learner reason must NOT reveal mistake or diagnosis!
    expect(rec?.learnerReason.toLowerCase()).not.toContain('ards');
    expect(rec?.learnerReason.toLowerCase()).not.toContain('mistake');
    expect(rec?.learnerReason.toLowerCase()).not.toContain('pbw');

    // Debrief reason preserves full educational audit
    expect(rec?.debriefReason).toContain('disease.ards');
    expect(rec?.debriefReason).toContain('knowledge_gap');
  });
});
