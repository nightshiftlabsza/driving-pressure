// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Progress } from './Progress';
import { FakeLearner } from './FakeLearner';
import type { LearnerEvent } from '../shared/events';

afterEach(() => {
  cleanup();
});

describe('Progress Clinical Development View (src/screens/Progress.tsx)', () => {
  it('renders Entrustment per case tier with EPA status', () => {
    const fakeLearner = new FakeLearner();
    render(<Progress learner={fakeLearner} />);

    expect(screen.getByText('Entrustment Levels by Case Tier')).toBeTruthy();
    expect(screen.getByText('Tier 1: Single problem')).toBeTruthy();
    expect(screen.getByText('Tier 2: Two interacting problems')).toBeTruthy();
    expect(screen.getByText('Tier 3: Dynamic or deteriorating crisis')).toBeTruthy();

    const observedBadges = screen.getAllByText('Observed');
    expect(observedBadges.length).toBe(3);
  });

  it('renders Spaced Re-test Schedule with Leitner boxes when events are present', async () => {
    const fakeLearner = new FakeLearner();
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'start1',
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
        id: 'm1',
        wallTime: '2026-11-01T10:15:00Z',
        sessionId: 's1',
        runId: 'r1',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'major',
        detail: 'Excessive oxygen delivery in hypercapnia',
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

    for (const e of events) {
      await fakeLearner.record(e);
    }

    render(<Progress learner={fakeLearner} />);

    await screen.findByText('Recurring Mistakes & Spaced Re-test Schedule');
    expect(screen.getByText(/Box 1 \(1d\)/i)).toBeTruthy();
    expect(screen.getAllByText('modes.peep-fio2').length).toBeGreaterThanOrEqual(1);
  });
});
