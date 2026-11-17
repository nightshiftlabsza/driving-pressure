import { describe, it, expect } from 'vitest';
import type { LearnerEvent } from '../shared/events';
import {
  deriveMistakeLedger,
  getRecurringMistakes,
  getHypercorrectionCandidates,
  getUnresolvedMistakes,
  type ProcessClassSource,
} from './ledger';

describe('Mistake Ledger derivation (src/adaptive/ledger.ts)', () => {
  it('returns empty ledger when given empty events', () => {
    expect(deriveMistakeLedger([])).toEqual([]);
  });

  it('aggregates multiple occurrences of a mistake per (mistake x competency)', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'e1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'major',
        detail: 'SpO2 > 96% in hypercapnic patient',
      },
      {
        v: 1,
        id: 'e2',
        wallTime: '2026-11-03T10:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'copd-psv-trigger-01',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'critical',
        detail: 'Excessive FiO2 with PaCO2 retention',
      },
      {
        v: 1,
        id: 'e3',
        wallTime: '2026-11-02T10:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'mistake',
        mistake: 'knowledge_gap',
        competency: 'disease.ards',
        severity: 'major',
        detail: 'Calculated Vt from actual weight not PBW',
      },
    ];

    const ledger = deriveMistakeLedger(events);
    expect(ledger.length).toBe(2);

    const recurring = getRecurringMistakes(ledger);
    expect(recurring.length).toBe(1);
    expect(recurring[0].mistakeId).toBe('unsafe_action');
    expect(recurring[0].competencyId).toBe('modes.peep-fio2');
    expect(recurring[0].count).toBe(2);
    expect(recurring[0].firstSeen).toBe('2026-11-01T10:00:00Z');
    expect(recurring[0].lastSeen).toBe('2026-11-03T10:00:00Z');
    expect(recurring[0].caseIds).toEqual(expect.arrayContaining(['copd-niv-01', 'copd-psv-trigger-01']));
    expect(recurring[0].severities).toEqual(expect.arrayContaining(['major', 'critical']));
  });

  it('identifies hypercorrection candidates from high-confidence errors', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'pred-1',
        wallTime: '2026-11-01T12:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'prediction',
        predictionId: 'p-pbw',
        question: 'What is his PBW?',
        answer: 98,
        expected: 66,
        correct: false,
        confidence: 'certain', // confident wrong answer!
        competency: 'disease.ards',
        evidenceType: 'prediction',
        guidance: 'prompted',
        hidden: false,
      },
    ];

    const ledger = deriveMistakeLedger(events);
    expect(ledger.length).toBe(1);
    expect(ledger[0].mistakeId).toBe('calibration_error');
    expect(ledger[0].hasHighConfidence).toBe(true);

    const candidates = getHypercorrectionCandidates(ledger);
    expect(candidates.length).toBe(1);
    expect(candidates[0].competencyId).toBe('disease.ards');
  });

  it('captures critical rubric failures as mistakes', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'rub-1',
        wallTime: '2026-11-01T14:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'rubric_result',
        rubricId: 'r-vt',
        met: false,
        critical: true,
        competency: 'disease.ards',
        evidenceType: 'decision',
        correct: false,
        guidance: 'prompted',
        hidden: false,
      },
    ];

    const ledger = deriveMistakeLedger(events);
    expect(ledger.length).toBe(1);
    expect(ledger[0].mistakeId).toBe('unsafe_action');
    expect(ledger[0].severities).toContain('critical');
  });

  it('integrates with ProcessClassSource without importing Agent A', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'start-1',
        wallTime: '2026-11-01T15:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'asthma-vent-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
    ];

    const mockProcessSource: ProcessClassSource = {
      getProcessClassRecords: () => [
        {
          runId: 'r1',
          caseId: 'asthma-vent-01',
          simTimeSec: 300,
          wallTime: '2026-11-01T15:05:00Z',
          processClass: 'unsafe',
          competency: 'mech.auto-peep',
          mistakeId: 'unsafe_action',
          detail: 'Increased respiratory rate during severe bronchospasm air-trapping',
          confidence: 'certain',
        },
        {
          runId: 'r1',
          simTimeSec: 600,
          wallTime: '2026-11-01T15:10:00Z',
          processClass: 'sound', // defensible: should NOT create a mistake
        },
      ],
    };

    const ledger = deriveMistakeLedger(events, { processSource: mockProcessSource });
    expect(ledger.length).toBe(1);
    expect(ledger[0].competencyId).toBe('mech.auto-peep');
    expect(ledger[0].mistakeId).toBe('unsafe_action');
    expect(ledger[0].hasHighConfidence).toBe(true);
  });

  it('marks a mistake resolved when a subsequent run re-tests the competency cleanly', () => {
    const events: LearnerEvent[] = [
      // Run 1: Made a mistake on disease.ards
      {
        v: 1,
        id: 'm1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'mistake',
        mistake: 'unsafe_action',
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
        outcome: 'deteriorated',
      },

      // Run 2 (later): re-tested disease.ards cleanly
      {
        v: 1,
        id: 'start2',
        wallTime: '2026-11-02T10:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'pred2',
        wallTime: '2026-11-02T10:05:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'prediction',
        predictionId: 'p-pbw',
        question: 'PBW',
        answer: 66,
        expected: 66,
        correct: true,
        confidence: 'certain',
        competency: 'disease.ards',
        evidenceType: 'prediction',
        guidance: 'independent',
        hidden: false,
      },
      {
        v: 1,
        id: 'end2',
        wallTime: '2026-11-02T10:30:00Z',
        sessionId: 's2',
        runId: 'r2',
        type: 'run_end',
        outcome: 'improved',
      },
    ];

    const ledger = deriveMistakeLedger(events);
    expect(ledger.length).toBe(1);
    expect(ledger[0].resolved).toBe(true);

    const unresolved = getUnresolvedMistakes(ledger);
    expect(unresolved.length).toBe(0);
  });
});
