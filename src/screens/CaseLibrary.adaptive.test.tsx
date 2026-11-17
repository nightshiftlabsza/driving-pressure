// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CaseLibrary } from './CaseLibrary';
import { FakeLearner } from './FakeLearner';
import type { CaseFile } from '../shared/caseSchema';
import realPneumoniaCase from '../cases/library/pneumonia-hfnc-01.json';
import realCopdCase from '../cases/library/copd-niv-01.json';

afterEach(() => {
  cleanup();
});

describe('CaseLibrary Adaptive Extensions', () => {
  it('renders the Suggested Next hero card at the top', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile, realPneumoniaCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    expect(screen.getByText('Suggested Next')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start suggested next case/i })).toBeTruthy();
  });

  it('masks diagnosis in title before completion and reveals it after completion', async () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    // 1. Before completion: Pneumonia title is masked to presentation title
    const { unmount } = render(
      <CaseLibrary
        cases={[realPneumoniaCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    expect(screen.getByText('Severe hypoxaemia on a non-rebreather in the ED')).toBeTruthy();
    expect(screen.queryByText('Pneumonia on a non-rebreather in the ED')).toBeNull();
    unmount();

    // 2. After completion: fakeLearner has a completed run for pneumonia-hfnc-01
    fakeLearner.setRun({
      runId: 'r-pna',
      activity: 'case',
      activityId: 'pneumonia-hfnc-01',
      startedAt: '2026-11-01T10:00:00Z',
      endedAt: '2026-11-01T10:30:00Z',
      outcome: 'improved',
      score: 5,
      maxScore: 6,
      predictions: [],
      rubric: [],
      mistakes: [],
      ordersTimeline: [],
    });

    render(
      <CaseLibrary
        cases={[realPneumoniaCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    // After completion, the confirmed diagnosis is revealed
    await screen.findByText('Pneumonia on a non-rebreather in the ED');
    expect(screen.getByText(/✓ Completed/i)).toBeTruthy();
  });
});
