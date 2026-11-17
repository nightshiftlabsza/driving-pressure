// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
import { Debrief } from './Debrief';
import realCopdCase from '../cases/library/copd-niv-01.json';
import type { CaseFile } from '../shared/caseSchema';
import type { RunSummary } from '../shared/learnerApi';
import type { ReferenceDivergence } from '../review/reference';

let mockDivergence: ReferenceDivergence | null = null;

vi.mock('../review/DecisionReview', () => ({
  DecisionReview: ({ onTrajectoryComparisonReady }: { onTrajectoryComparisonReady?: (c: any, d: ReferenceDivergence | null) => void }) => {
    useEffect(() => {
      onTrajectoryComparisonReady?.(null, mockDivergence);
    }, [onTrajectoryComparisonReady]);
    return <div data-testid="mock-decision-review" />;
  },
  startRewindFromPoint: vi.fn(),
}));

describe('Debrief Step 1 question and box wording', () => {
  const baseRun: RunSummary = {
    runId: 'run-test-step1',
    activity: 'case',
    activityId: 'copd-niv-01',
    startedAt: '2026-11-01T00:00:00Z',
    endedAt: '2026-11-01T00:30:00Z',
    outcome: 'improved',
    score: 8,
    maxScore: 10,
    predictions: [],
    ordersTimeline: [],
    rubric: [],
    mistakes: [],
  };

  it('formats plateau pressure divergence box with plain language and formatClinical', () => {
    mockDivergence = {
      simTimeSec: 1230,
      metric: 'pplat',
      label: 'Plateau Pressure',
      unit: 'cmH2O',
      learnerValue: 23.31,
      referenceValue: 26.76,
      relativeDiffPct: 14.8,
    };

    render(<Debrief run={baseRun} caseFile={realCopdCase as CaseFile} />);

    const divBox = screen.getByTestId('debrief-reference-divergence');
    expect(divBox.textContent?.trim()).toBe(
      'At +20:30 your plateau pressure was 23 cmH2O. The reference run had 27 cmH2O.'
    );
    expect(divBox.textContent).not.toContain('First Reference Divergence');
    expect(divBox.textContent).not.toContain('attending');
    expect(divBox.textContent).not.toContain('diverged');
    expect(divBox.textContent).not.toContain('Explain why');

    const gate = screen.getByTestId('debrief-self-critique-gate');
    expect(gate.textContent).toContain(
      'In one or two sentences: what had you done differently by then, and was it better or worse for the patient?'
    );
  });

  it('preserves uppercase abbreviations like FiO2, PEEP, SpO2, PaCO2', () => {
    mockDivergence = {
      simTimeSec: 300,
      metric: 'paco2',
      label: 'PaCO2',
      unit: 'mmHg',
      learnerValue: 48.2,
      referenceValue: 55.8,
      relativeDiffPct: 13.6,
    };

    render(<Debrief run={baseRun} caseFile={realCopdCase as CaseFile} />);

    const divBox = screen.getByTestId('debrief-reference-divergence');
    expect(divBox.textContent?.trim()).toBe(
      'At +05:00 your PaCO2 was 48 mmHg. The reference run had 56 mmHg.'
    );
  });
});
