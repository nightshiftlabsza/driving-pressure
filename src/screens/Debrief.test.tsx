// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Debrief } from './Debrief';
import realCopdCase from '../cases/library/copd-niv-01.json';
import type { CaseFile } from '../shared/caseSchema';
import type { RunSummary } from '../shared/learnerApi';

afterEach(() => {
  cleanup();
});

const sampleRun: RunSummary = {
  runId: 'run-123',
  activity: 'case',
  activityId: 'copd-niv-01',
  startedAt: '2026-11-07T10:00:00Z',
  endedAt: '2026-11-07T10:35:00Z',
  outcome: 'improved',
  score: 6,
  maxScore: 9,
  predictions: [
    {
      predictionId: 'pred-correct',
      question: 'Will EPAP help upper airway patency?',
      answer: 'Yes',
      expected: 'Yes',
      correct: true,
      confidence: 'certain',
      competency: 'niv.titration',
    },
    {
      predictionId: 'pred-guess-wrong',
      question: 'What is the expected PaCO2 trajectory?',
      answer: 'Stay same',
      expected: 'Decrease',
      correct: false,
      confidence: 'guess',
      competency: 'gas.alveolar-ventilation',
    },
    {
      predictionId: 'pred-confident-error',
      question: 'Will respiratory rate rise further after BiPAP?',
      answer: 'Rise significantly',
      expected: 'Fall as work of breathing eases',
      correct: false,
      confidence: 'certain', // Confident error: certain and wrong!
      competency: 'gas.alveolar-ventilation',
    },
  ],
  rubric: [
    {
      rubricId: 'r-abg-first',
      met: true,
      critical: false,
      competency: 'gas.acid-base',
    },
    {
      rubricId: 'r-niv-start',
      met: true,
      critical: true,
      competency: 'niv.selection',
    },
    {
      rubricId: 'r-repeat-abg',
      met: false,
      critical: false,
      competency: 'safety.reassess',
    },
  ],
  mistakes: [
    {
      mistake: 'unsafe_action',
      competency: 'modes.peep-fio2',
      severity: 'major',
      detail: 'SpO2 maintained above 96% for 20+ minutes in a patient with chronic CO2 retention.',
    },
  ],
  ordersTimeline: [
    { simTimeSec: 60, order: 'abg' },
    { simTimeSec: 300, order: 'change-device' },
    { simTimeSec: 600, order: 'bronchodilator' },
  ],
};

describe('Debrief Component', () => {
  it('lists confident errors ("certain and wrong") first in the predictions section', () => {
    const { container } = render(
      <Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />
    );

    // Confident error question: "Will respiratory rate rise further after BiPAP?"
    // Other error question: "What is the expected PaCO2 trajectory?"
    // Correct question: "Will EPAP help upper airway patency?"
    const html = container.innerHTML;
    const idxConfidentError = html.indexOf('Will respiratory rate rise further after BiPAP?');
    const idxGuessWrong = html.indexOf('What is the expected PaCO2 trajectory?');
    const idxCorrect = html.indexOf('Will EPAP help upper airway patency?');

    expect(idxConfidentError).toBeGreaterThan(-1);
    expect(idxGuessWrong).toBeGreaterThan(-1);
    expect(idxCorrect).toBeGreaterThan(-1);

    // Confident error must appear BEFORE the guess error and the correct prediction
    expect(idxConfidentError).toBeLessThan(idxGuessWrong);
    expect(idxConfidentError).toBeLessThan(idxCorrect);

    // Verify badge appears
    expect(screen.getByText('Certain & Wrong')).toBeTruthy();
  });

  it('reveals hidden competencies in the "This case also tested ..." section', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);

    expect(screen.getByText(/This case also tested \.\.\./i)).toBeTruthy();
    // In copd-niv-01, safety.reassess is hidden
    expect(screen.getAllByTitle('safety.reassess').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Reassess after every change within an appropriate time')
    ).toBeTruthy();
  });

  it('shows mistakes with taxonomy name and recommended remediation response from mistakes.json', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);

    // In mistakes.json:
    // id: "unsafe_action", name: "Unsafe action", response: "Always shown in debrief, regardless of outcome"
    expect(screen.getAllByText('Unsafe action').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Always shown in debrief, regardless of outcome')
    ).toBeTruthy();
    expect(screen.getAllByText(/SpO2 maintained above 96%/i).length).toBeGreaterThan(0);
  });

  it('displays outcome and score with critical items status', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);

    expect(screen.getByText('Improved')).toBeTruthy();
    expect(screen.getByText(/2 \/ 3/)).toBeTruthy();
    expect(screen.getByText(/rubric items met/i)).toBeTruthy();
    // r-niv-start is critical and was met
    expect(
      screen.getByText(/All critical clinical management criteria were met/i)
    ).toBeTruthy();
  });

  it('renders orders timeline and key points from case file', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);

    expect(screen.getByText('+01:00')).toBeTruthy();
    expect(screen.getByText('Change device')).toBeTruthy();
    expect(
      screen.getByText(
        'pH below 7.35 with a raised PaCO2 after initial treatment is the trigger for NIV in a COPD exacerbation.'
      )
    ).toBeTruthy();
    expect(screen.getByText('ICUedu: BiPAP')).toBeTruthy();
  });

  it('handles empty run gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Debrief run={null as any} caseFile={realCopdCase as CaseFile} />);
    expect(
      screen.getByText(/No run summary or case data available for debrief/i)
    ).toBeTruthy();
  });

  it('flags missed critical rubric items in Section 1', () => {
    const runWithMissedCritical: RunSummary = {
      ...sampleRun,
      rubric: [
        {
          rubricId: 'r-niv-start',
          met: false, // MISSED critical item
          critical: true,
          competency: 'niv.selection',
        },
      ],
    };

    render(<Debrief run={runWithMissedCritical} caseFile={realCopdCase as CaseFile} />);

    expect(screen.getByText(/Critical requirement missed:/i)).toBeTruthy();
    expect(screen.getAllByText(/Started NIV for acute hypercapnic acidosis/i).length).toBeGreaterThanOrEqual(2);
  });

  it('does not render points when score is undefined', () => {
    const runWithoutScore: RunSummary = {
      ...sampleRun,
      score: undefined as unknown as null,
      maxScore: undefined as unknown as null,
    };

    const { container } = render(<Debrief run={runWithoutScore} caseFile={realCopdCase as CaseFile} />);
    expect(container.innerHTML).not.toContain('Points:');
    expect(container.innerHTML).not.toContain('undefined');
  });

  it('opens with self-critique prompt keeping tutor cap at Level 1 until submitted', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);

    expect(screen.getByTestId('debrief-self-critique-gate')).toBeTruthy();
    expect(screen.getByTestId('debrief-tutor-cap-badge').textContent).toContain('Answer this first');
    expect(screen.getByTestId('debrief-self-critique-gate').textContent).toContain(
      'In one or two sentences: what was your main reasoning, and what would you do sooner next time?'
    );
    const submitBtn = screen.getByTestId('debrief-self-critique-submit') as HTMLButtonElement;
    expect(submitBtn.textContent).toBe('Submit');
    expect(submitBtn.disabled).toBe(true);

    const input = screen.getByTestId('debrief-self-critique-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('One or two sentences, at least four words.');

    fireEvent.change(input, {
      target: { value: 'I delayed repeating the arterial blood gas after starting NIV support.' },
    });
    expect(submitBtn.disabled).toBe(false);
    fireEvent.click(submitBtn);

    expect(screen.getByTestId('debrief-tutor-cap-badge').textContent).toContain('Answered');
    expect(screen.getByTestId('debrief-self-critique-gate').textContent).toContain('Saved.');
  });

  it('displays failed transfer probe alert when reviewing an unsuccessful -- transfer variant run', () => {
    const failedTransferRun: RunSummary = {
      ...sampleRun,
      runId: 'run-transfer-fail-1',
      activityId: 'ards-vent-01--pbw-short-female',
      outcome: 'deteriorated',
      rubric: [{ rubricId: 'r-vt', met: false, critical: true, competency: 'disease.ards' }],
    };

    render(<Debrief run={failedTransferRun} caseFile={realCopdCase as CaseFile} />);
    const banner = screen.getByTestId('debrief-transfer-probe-status');
    expect(banner.textContent).toContain('5-day transfer retest');
    expect(banner.textContent).toContain('drops 1 tier');
    const gate = screen.getByTestId('debrief-self-critique-gate');
    expect(gate.textContent).toContain('You missed a critical step:');
    expect(gate.textContent).toContain(
      'In one or two sentences: what went wrong, and what on the screen should have told you?'
    );
  });

  it('renders Step 2: Decisions that mattered section', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);
    const step2 = screen.getByTestId('debrief-step-2-decisions');
    expect(step2).toBeTruthy();
    expect(step2.textContent).toContain('Decisions that mattered');
  });

  it('renders Step 3: Course chart section', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);
    const step3 = screen.getByTestId('debrief-step-3-chart');
    expect(step3).toBeTruthy();
    expect(step3.textContent).toContain('Course chart');
  });

  it('renders Step 4: Certain and wrong, and unscored predictions', () => {
    render(
      <Debrief
        run={sampleRun}
        caseFile={realCopdCase as CaseFile}
        unscoredPredictions={[{ predictionId: 'pred-unscored-1', elapsedSec: 120 }]}
      />
    );
    const step4 = screen.getByTestId('debrief-step-4-predictions');
    expect(step4).toBeTruthy();
    expect(step4.textContent).toContain('Step 4: Certain and wrong, and unscored');
    // Confident error from sampleRun: "Will respiratory rate rise further after BiPAP?"
    expect(step4.textContent).toContain('Will respiratory rate rise further after BiPAP?');
    expect(step4.textContent).toContain('Your answer:');
    expect(step4.textContent).toContain('Rise significantly');
    expect(step4.textContent).toContain('What happened:');
    expect(step4.textContent).toContain('Fall as work of breathing eases');
    // Unscored prediction line
    expect(step4.textContent).toContain('Not scored: the case ended before the effect could be measured.');
  });

  it('renders Step 4 fallback line when no certain-and-wrong or unscored predictions exist', () => {
    const runWithoutErrors: RunSummary = {
      ...sampleRun,
      predictions: [
        {
          predictionId: 'pred-correct',
          question: 'Will EPAP help upper airway patency?',
          answer: 'Yes',
          expected: 'Yes',
          correct: true,
          confidence: 'certain',
          competency: 'niv.titration',
        },
      ],
    };
    render(<Debrief run={runWithoutErrors} caseFile={realCopdCase as CaseFile} />);
    const step4 = screen.getByTestId('debrief-step-4-predictions');
    expect(step4.textContent).toContain('No certain-and-wrong or unscored predictions in this run.');
  });

  it('renders Step 5: Takeaway with first 3 key points and More for the rest, plus library button', () => {
    const onBack = vi.fn();
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} onBackToLibrary={onBack} />);
    const step5 = screen.getByTestId('debrief-step-5-takeaway');
    expect(step5).toBeTruthy();
    expect(step5.textContent).toContain('Step 5: Takeaway and next');

    // First 3 items should be rendered
    expect(step5.textContent).toContain('pH below 7.35 with a raised PaCO2 after initial treatment');
    expect(step5.textContent).toContain('Pressure support (IPAP minus EPAP) drives CO2 clearance');
    expect(step5.textContent).toContain('Hypoxaemia in COPD is driven predominantly by ventilation-perfusion');

    // "More" summary should be present for items > 3 (realCopdCase has 5 keyPoints)
    expect(step5.textContent).toContain('More');

    // Click back to library button
    const backBtns = screen.getAllByRole('button', { name: /← Case Library/i });
    expect(backBtns.length).toBeGreaterThan(0);
    fireEvent.click(backBtns[backBtns.length - 1]);
    expect(onBack).toHaveBeenCalled();
  });

  it('renders Details collapsed by default and contains rubric, predictions, mistakes and review', () => {
    render(<Debrief run={sampleRun} caseFile={realCopdCase as CaseFile} />);
    const details = screen.getByTestId('debrief-details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    // Contains rubric, predictions, mistakes, hidden competencies, timeline, resources
    expect(details.textContent).toContain('Rubric Checklist');
    expect(details.textContent).toContain('Your Predictions');
    expect(details.textContent).toContain('Mistakes');
    expect(details.textContent).toContain('Hidden Competencies');
  });
});
