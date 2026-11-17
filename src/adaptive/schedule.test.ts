import { describe, it, expect } from 'vitest';
import type { LearnerEvent } from '../shared/events';
import {
  deriveReTestSchedule,
  getDueReTests,
  getNextDueReTest,
  LEITNER_INTERVALS,
} from './schedule';

describe('Spaced Re-Test Scheduler (src/adaptive/schedule.ts)', () => {
  it('returns empty schedule when no events exist', () => {
    expect(deriveReTestSchedule([])).toEqual([]);
  });

  it('places a new mistake into Box 1 with 1 day interval', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'start-1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'run_start',
        guidanceByCompetency: {},
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
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'major',
        detail: 'SpO2 > 96% in hypercapnia',
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
    ];

    const now = new Date('2026-11-01T12:00:00Z');
    const schedule = deriveReTestSchedule(events, now);
    expect(schedule.length).toBe(1);

    const item = schedule[0];
    expect(item.mistakeId).toBe('unsafe_action');
    expect(item.competencyId).toBe('modes.peep-fio2');
    expect(item.box).toBe(1);
    expect(item.intervalDays).toBe(1);
    expect(item.lastTestedAt).toBe('2026-11-01T10:15:00Z');
    expect(item.dueAt).toBe(new Date('2026-11-02T10:15:00Z').toISOString());
    expect(item.isDue).toBe(false); // only 2 hours later
    expect(item.history.length).toBe(1);
    expect(item.history[0].action).toBe('initial_mistake');
  });

  it('promotes item through Leitner boxes on clean re-tests', () => {
    const events: LearnerEvent[] = [
      // Day 1: Mistake in Run 1 (enters Box 1)
      {
        v: 1,
        id: 'm1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'ards-vent-01',
        type: 'mistake',
        mistake: 'knowledge_gap',
        competency: 'disease.ards',
        severity: 'major',
        detail: 'PBW error',
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

      // Day 2 (24h later): Clean re-test in Run 2 (promotes to Box 2)
      {
        v: 1,
        id: 'start2',
        wallTime: '2026-11-02T11:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'ards-vent-01--pbw-short-female',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'pred2',
        wallTime: '2026-11-02T11:05:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'ards-vent-01--pbw-short-female',
        type: 'prediction',
        predictionId: 'p-pbw',
        question: 'PBW',
        answer: 46,
        expected: 46,
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
        wallTime: '2026-11-02T11:30:00Z',
        sessionId: 's2',
        runId: 'r2',
        type: 'run_end',
        outcome: 'improved',
      },

      // Day 5 (3 days later): Clean re-test in Run 3 (promotes to Box 3)
      {
        v: 1,
        id: 'start3',
        wallTime: '2026-11-05T12:00:00Z',
        sessionId: 's3',
        runId: 'r3',
        activity: 'case',
        activityId: 'pneumonia-hfnc-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'rub3',
        wallTime: '2026-11-05T12:10:00Z',
        sessionId: 's3',
        runId: 'r3',
        activity: 'case',
        activityId: 'pneumonia-hfnc-01',
        type: 'rubric_result',
        rubricId: 'r-lpv',
        met: true,
        critical: false,
        competency: 'disease.ards',
        evidenceType: 'safety',
        correct: true,
        guidance: 'independent',
        hidden: false,
      },
      {
        v: 1,
        id: 'end3',
        wallTime: '2026-11-05T12:30:00Z',
        sessionId: 's3',
        runId: 'r3',
        type: 'run_end',
        outcome: 'improved',
      },
    ];

    const now = new Date('2026-11-06T12:00:00Z');
    const schedule = deriveReTestSchedule(events, now);
    expect(schedule.length).toBe(1);

    const item = schedule[0];
    expect(item.box).toBe(3);
    expect(item.intervalDays).toBe(LEITNER_INTERVALS[3]); // 7 days
    expect(item.history.length).toBe(3);
    expect(item.history[1].action).toBe('clean_retest');
    expect(item.history[1].boxAfter).toBe(2);
    expect(item.history[2].action).toBe('clean_retest');
    expect(item.history[2].boxAfter).toBe(3);
  });

  it('resets item back to Box 1 when repeat mistake occurs', () => {
    const events: LearnerEvent[] = [
      // Day 1: Run 1 error
      {
        v: 1,
        id: 'm1',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'major',
        detail: 'SpO2 > 96%',
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

      // Day 2: Clean re-test (Box 2)
      {
        v: 1,
        id: 'start2',
        wallTime: '2026-11-02T10:00:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'run_start',
        guidanceByCompetency: {},
      },
      {
        v: 1,
        id: 'rub2',
        wallTime: '2026-11-02T10:15:00Z',
        sessionId: 's2',
        runId: 'r2',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'rubric_result',
        rubricId: 'r-spo2-target',
        met: true,
        critical: false,
        competency: 'modes.peep-fio2',
        evidenceType: 'safety',
        correct: true,
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

      // Day 5: Repeat mistake occurs in Run 3!
      {
        v: 1,
        id: 'm3',
        wallTime: '2026-11-05T10:00:00Z',
        sessionId: 's3',
        runId: 'r3',
        activity: 'case',
        activityId: 'copd-niv-01--retention-alkalosis',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'critical',
        detail: 'Repeated over-oxygenation',
      },
      {
        v: 1,
        id: 'end3',
        wallTime: '2026-11-05T10:30:00Z',
        sessionId: 's3',
        runId: 'r3',
        type: 'run_end',
        outcome: 'deteriorated',
      },
    ];

    const now = new Date('2026-11-05T12:00:00Z');
    const schedule = deriveReTestSchedule(events, now);
    expect(schedule.length).toBe(1);

    const item = schedule[0];
    expect(item.box).toBe(1); // Demoted back to Box 1!
    expect(item.intervalDays).toBe(1);
    expect(item.history[item.history.length - 1].action).toBe('repeat_mistake');
    expect(item.history[item.history.length - 1].boxBefore).toBe(2);
    expect(item.history[item.history.length - 1].boxAfter).toBe(1);
  });

  it('correctly flags isDue and computes overdueDays', () => {
    const events: LearnerEvent[] = [
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
        detail: 'Excessive Vt',
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

    // Check 3 days later: should be 2 days overdue (due at 2026-11-02T10:00:00Z)
    const now = new Date('2026-11-04T10:00:00Z');
    const schedule = deriveReTestSchedule(events, now);
    const due = getDueReTests(schedule, now);

    expect(due.length).toBe(1);
    expect(due[0].isDue).toBe(true);
    expect(due[0].overdueDays).toBe(2);

    const nextDue = getNextDueReTest(schedule, now);
    expect(nextDue?.key).toBe('unsafe_action::disease.ards');
  });

  it('schedules a 5-day retest interval when a transfer variant probe fails', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 't-start',
        wallTime: '2026-11-01T10:00:00Z',
        sessionId: 'st-1',
        runId: 'rt-1',
        activity: 'case',
        activityId: 'ards-vent-01--pbw-short-female',
        type: 'run_start',
        guidanceByCompetency: { 'disease.ards': 'independent' },
        isTransferVariant: true,
        transferVariantId: 'ards-vent-01--pbw-short-female',
      },
      {
        v: 1,
        id: 't-rubric-fail',
        wallTime: '2026-11-01T10:15:00Z',
        sessionId: 'st-1',
        runId: 'rt-1',
        activity: 'case',
        activityId: 'ards-vent-01--pbw-short-female',
        type: 'rubric_result',
        rubricId: 'r-vt-pbw',
        met: false,
        critical: true,
        competency: 'disease.ards',
        evidenceType: 'decision',
        correct: false,
        guidance: 'independent',
        hidden: false,
        isTransferVariant: true,
        transferVariantId: 'ards-vent-01--pbw-short-female',
      },
      {
        v: 1,
        id: 't-end',
        wallTime: '2026-11-01T10:20:00Z',
        sessionId: 'st-1',
        runId: 'rt-1',
        type: 'run_end',
        outcome: 'deteriorated',
      },
    ];

    const day3 = new Date('2026-11-04T10:20:00Z');
    const schedDay3 = deriveReTestSchedule(events, day3);
    expect(schedDay3).toHaveLength(1);
    expect(schedDay3[0].intervalDays).toBe(5);
    expect(schedDay3[0].isTransferRetest).toBe(true);
    expect(schedDay3[0].isDue).toBe(false);

    const day5 = new Date('2026-11-06T11:00:00Z');
    const schedDay5 = deriveReTestSchedule(events, day5);
    expect(schedDay5[0].isDue).toBe(true);
  });
});
