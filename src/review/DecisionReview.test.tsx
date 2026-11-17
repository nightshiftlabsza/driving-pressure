// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { DecisionReview } from './DecisionReview';
import { saveRewindMetadata } from './rewind';
import type { RunSummary } from '../shared/learnerApi';
import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import ardsCaseRaw from '../cases/library/ards-vent-01.json';
import asthmaCaseRaw from '../cases/library/asthma-vent-01.json';

afterEach(() => {
  cleanup();
});

const ardsCase = ardsCaseRaw as unknown as CaseFile;
const asthmaCase = asthmaCaseRaw as unknown as CaseFile;

const mockRunSummary: RunSummary = {
  runId: 'run-review-test-1',
  activity: 'case',
  activityId: 'ards-vent-01',
  startedAt: '2026-11-08T00:00:00Z',
  endedAt: '2026-11-08T00:30:00Z',
  outcome: 'improved',
  score: 8,
  maxScore: 10,
  predictions: [],
  rubric: [],
  mistakes: [],
  ordersTimeline: [
    { simTimeSec: 60, order: 'abg' },
    { simTimeSec: 180, order: 'change-settings' },
  ],
};

const mockEvents: LearnerEvent[] = [
  {
    v: 1,
    id: 'ev-1',
    wallTime: '2026-11-08T00:01:00Z',
    sessionId: 'sess-1',
    runId: 'run-review-test-1',
    simTimeSec: 60,
    type: 'order',
    order: 'abg',
  },
  {
    v: 1,
    id: 'ev-2',
    wallTime: '2026-11-08T00:03:00Z',
    sessionId: 'sess-1',
    runId: 'run-review-test-1',
    simTimeSec: 180,
    type: 'order',
    order: 'change-settings',
    detail: {
      settings: {
        vtSetMl: 380,
        rrSetBpm: 24,
      },
    },
  },
  {
    v: 1,
    id: 'ev-3',
    wallTime: '2026-11-08T00:10:00Z',
    sessionId: 'sess-1',
    runId: 'run-review-test-1',
    simTimeSec: 600,
    type: 'order',
    order: 'prone',
  },
];

describe('DecisionReview Component', () => {
  it('renders clinical decision timeline, exposure ledger, and reference trajectory comparison', async () => {
    render(
      <DecisionReview
        run={mockRunSummary}
        caseFile={ardsCase}
        events={mockEvents}
      />
    );

    // 1. Heading
    await waitFor(() => {
      expect(screen.getByText(/Decision Process & Clinical Reasoning Review/i)).toBeTruthy();
    }, { timeout: 4000 });

    // 2. Decisions rendered in timeline
    expect(screen.getByText(/3 Decisions Evaluated/i)).toBeTruthy();
    expect(screen.getByText('+01:00')).toBeTruthy();
    expect(screen.getByText('+03:00')).toBeTruthy();
    expect(screen.getByText('+10:00')).toBeTruthy();

    // 3. Process class badges
    expect(screen.getAllByText('Sound Process').length).toBeGreaterThanOrEqual(1);

    // 4. Exposure ledger table
    expect(screen.getByText(/Exposure Ledger/i)).toBeTruthy();
    expect(screen.getByText(/Plateau pressure > 30 cmH2O/i)).toBeTruthy();
    expect(screen.getByText(/Driving pressure > 15 cmH2O/i)).toBeTruthy();

    // 5. Attending reference run & mode badge (CHAL-1)
    expect(screen.getByTestId('decision-review-mode-badge').textContent).toBe('Attending Reference Case');
    expect(screen.getByText(/Attending Trajectory Comparison/i)).toBeTruthy();
    expect(screen.getByText('One reasonable approach')).toBeTruthy();
  });

  it('shows Guideline Rubric Review badge when no attending reference run exists (CHAL-1)', async () => {
    const asthmaRun: RunSummary = { ...mockRunSummary, runId: 'run-asthma-1', activityId: 'asthma-vent-01' };
    render(
      <DecisionReview
        run={asthmaRun}
        caseFile={asthmaCase}
        events={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Decision Process & Clinical Reasoning Review/i)).toBeTruthy();
    });

    expect(screen.getByTestId('decision-review-mode-badge').textContent).toBe('Guideline Rubric Review');
  });

  it('expands decision details on click and handles rewind callback', async () => {
    const handleRewind = vi.fn();

    render(
      <DecisionReview
        run={mockRunSummary}
        caseFile={ardsCase}
        events={mockEvents}
        onRewind={handleRewind}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('+03:00')).toBeTruthy();
    });

    // Decision index 0 is open by default, let's click decision 1 (+03:00) to expand it
    const row = screen.getByText('+03:00');
    fireEvent.click(row);

    // Verify expanded card content
    await waitFor(() => {
      expect(screen.getByText(/1. Information Available at Decision Time/i)).toBeTruthy();
      expect(screen.getByText(/2. Physiological Response/i)).toBeTruthy();
    });

    // Find "Try again from here" button and click it
    const rewindButton = screen.getAllByRole('button', { name: /Try again from here/i })[0];
    expect(rewindButton).toBeTruthy();
    fireEvent.click(rewindButton);

    expect(handleRewind).toHaveBeenCalledTimes(1);
    const rewoundState = handleRewind.mock.calls[0][0];
    expect(rewoundState.runId).toMatch(/^rewind-/);
  });

  it('merges pre-rewind decisions from parentRunId with post-rewind decisions when rendering a rewound run', async () => {
    saveRewindMetadata({
      rewindRunId: 'run-child',
      parentRunId: 'run-parent',
      caseId: 'ards-vent-01',
      rewindAtSimSec: 120,
      decisionIndex: 1,
      createdAt: new Date().toISOString(),
    });

    const parentEvent1: LearnerEvent = {
      v: 1,
      id: 'ev-parent-1',
      wallTime: '2026-11-08T00:01:00Z',
      sessionId: 'sess-1',
      runId: 'run-parent',
      simTimeSec: 60,
      type: 'order',
      order: 'change-settings',
      detail: {
        settings: {
          vtSetMl: 370,
        },
      },
    };

    const parentEventUndoneBad: LearnerEvent = {
      v: 1,
      id: 'ev-parent-2-bad',
      wallTime: '2026-11-08T00:02:00Z',
      sessionId: 'sess-1',
      runId: 'run-parent',
      simTimeSec: 120,
      type: 'order',
      order: 'change-settings',
      detail: {
        settings: {
          vtSetMl: 800,
        },
      },
    };

    const childEventReplacement: LearnerEvent = {
      v: 1,
      id: 'ev-child-replacement',
      wallTime: '2026-11-08T00:02:00Z',
      sessionId: 'sess-1',
      runId: 'run-child',
      simTimeSec: 120,
      type: 'order',
      order: 'change-settings',
      detail: {
        settings: {
          peep: 10,
        },
      },
    };

    const childEvent2: LearnerEvent = {
      v: 1,
      id: 'ev-child-2',
      wallTime: '2026-11-08T00:03:00Z',
      sessionId: 'sess-1',
      runId: 'run-child',
      simTimeSec: 180,
      type: 'order',
      order: 'change-settings',
      detail: {
        settings: {
          peep: 12,
        },
      },
    };

    const childRun: RunSummary = {
      runId: 'run-child',
      activity: 'case',
      activityId: 'ards-vent-01',
      startedAt: '2026-11-08T00:00:00Z',
      endedAt: '2026-11-08T00:10:00Z',
      outcome: 'improved',
      score: 10,
      maxScore: 10,
      predictions: [],
      rubric: [],
      mistakes: [],
      ordersTimeline: [
        { simTimeSec: 60, order: 'change-settings' },
        { simTimeSec: 120, order: 'change-settings' },
        { simTimeSec: 180, order: 'change-settings' },
      ],
    };

    const { container } = render(
      <DecisionReview
        run={childRun}
        caseFile={ardsCase}
        events={[parentEvent1, parentEventUndoneBad, childEventReplacement, childEvent2]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('+01:00')).toBeTruthy();
      expect(screen.getByText('+02:00')).toBeTruthy();
      expect(screen.getByText('+03:00')).toBeTruthy();
    });

    // Verify that the undone bad decision from parent at t=120s (vtSetMl: 800) is excluded
    expect(container.innerHTML).not.toContain('800');
    expect(container.innerHTML).toContain('PEEP 10');

    // Verify that the undone bad decision from parent at t=120s (vtSetMl: 800) is excluded
    expect(container.innerHTML).not.toContain('800');
  });
});
