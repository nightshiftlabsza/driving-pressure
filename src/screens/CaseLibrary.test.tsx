// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CaseLibrary } from './CaseLibrary';
import { FakeLearner } from './FakeLearner';
import realCopdCase from '../cases/library/copd-niv-01.json';
import type { CaseFile } from '../shared/caseSchema';
import type { CaseVariantMetadata } from '../cases/variants/loader';

afterEach(() => {
  cleanup();
});

const edCase: CaseFile = {
  ...realCopdCase,
  id: 'ed-case-02',
  title: 'Acute Pulmonary Oedema in Emergency',
  setting: 'ed',
  summary: 'A 74-year-old presenting with acute flash pulmonary oedema and severe respiratory distress.',
  competencies: ['gas.oxy-vs-vent', 'circ.ppv-preload'],
  hiddenCompetencies: [],
} as CaseFile;

describe('CaseLibrary Component', () => {
  it('renders the copd-niv-01 title', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    expect(screen.getByText('Breathless at 3 a.m. on the respiratory ward')).toBeTruthy();
    expect(screen.getByText(/A 68-year-old with known lung disease/i)).toBeTruthy();
  });

  it('does not render any hidden competency name or id', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    const { container } = render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    // In copd-niv-01, "safety.reassess" is hidden:
    // Name: "Reassess after every change within an appropriate time"
    expect(screen.queryByText(/safety\.reassess/i)).toBeNull();
    expect(screen.queryByText(/Reassess after every change within an appropriate time/i)).toBeNull();
    expect(container.innerHTML).not.toContain('safety.reassess');
    expect(container.innerHTML).not.toContain('Reassess after every change within an appropriate time');
  });

  it('displays recommended badge and reasons on the case the fake ranks first', async () => {
    const fakeLearner = new FakeLearner();
    fakeLearner.setRecommendations([
      {
        id: realCopdCase.id,
        score: 0.98,
        reasons: ['auto-PEEP is due for review', 'High yield for noninvasive ventilation training'],
      },
    ]);

    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile, edCase]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recommended')).toBeTruthy();
      expect(screen.getByText('auto-PEEP is due for review')).toBeTruthy();
      expect(screen.getByText('High yield for noninvasive ventilation training')).toBeTruthy();
    });
  });

  it('filters cases by setting', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile, edCase]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    expect(screen.getByText('Breathless at 3 a.m. on the respiratory ward')).toBeTruthy();
    expect(screen.getByText('Acute Pulmonary Oedema in Emergency')).toBeTruthy();

    const settingFilter = screen.getByLabelText(/Setting/i);

    // Filter to ED only
    fireEvent.change(settingFilter, { target: { value: 'ed' } });
    expect(screen.queryByText('Breathless at 3 a.m. on the respiratory ward')).toBeNull();
    expect(screen.getByText('Acute Pulmonary Oedema in Emergency')).toBeTruthy();

    // Filter to Ward only
    fireEvent.change(settingFilter, { target: { value: 'ward' } });
    expect(screen.getByText('Breathless at 3 a.m. on the respiratory ward')).toBeTruthy();
    expect(screen.queryByText('Acute Pulmonary Oedema in Emergency')).toBeNull();

    // Reset back to all
    fireEvent.change(settingFilter, { target: { value: 'all' } });
    expect(screen.getByText('Breathless at 3 a.m. on the respiratory ward')).toBeTruthy();
    expect(screen.getByText('Acute Pulmonary Oedema in Emergency')).toBeTruthy();
  });

  it('supports keyboard navigation and starting a case', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    const startBtn = screen.getByRole('button', { name: /Start case: Breathless at 3 a.m./i });
    fireEvent.click(startBtn);
    expect(handleStart).toHaveBeenCalledWith('copd-niv-01');

    // Also card keyboard Enter
    const card = screen.getByRole('listitem');
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(handleStart).toHaveBeenCalledTimes(2);
  });

  it('renders honest empty states', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    const { rerender } = render(
      <CaseLibrary
        cases={[]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    expect(screen.getByText(/No cases available in the library/i)).toBeTruthy();

    // With cases but filtering to no matches
    rerender(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    const domainFilter = screen.getByLabelText(/Domain/i);
    // Filter by circulation domain (copd-niv-01 does not train circulation)
    fireEvent.change(domainFilter, { target: { value: 'circ' } });
    expect(screen.getByText(/No cases match the selected filters/i)).toBeTruthy();
  });

  it('filters cases by domain and shows matches', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile, edCase]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    const domainFilter = screen.getByLabelText(/Domain/i);
    // Filter by Non-invasive ventilation (copd-niv-01 trains niv, edCase does not)
    fireEvent.change(domainFilter, { target: { value: 'niv' } });
    expect(screen.getByText('Breathless at 3 a.m. on the respiratory ward')).toBeTruthy();
    expect(screen.queryByText('Acute Pulmonary Oedema in Emergency')).toBeNull();

    // Filter by circulation (edCase trains circ, copd-niv-01 does not)
    fireEvent.change(domainFilter, { target: { value: 'circ' } });
    expect(screen.queryByText('Breathless at 3 a.m. on the respiratory ward')).toBeNull();
    expect(screen.getByText('Acute Pulmonary Oedema in Emergency')).toBeTruthy();
  });

  it('sanitizes recommendation reasons so hidden competencies are never leaked on the card', async () => {
    const fakeLearner = new FakeLearner();
    // Provide reasons where one mentions the hidden competency name
    fakeLearner.setRecommendations([
      {
        id: realCopdCase.id,
        score: 0.99,
        reasons: [
          'Ventilator mode titration is due for practice',
          'safety.reassess needs remediation', // mentions hidden id
          'Reassess after every change within an appropriate time is weak', // mentions hidden name
        ],
      },
    ]);

    const handleStart = vi.fn();

    const { container } = render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recommended')).toBeTruthy();
      expect(screen.getByText('Ventilator mode titration is due for practice')).toBeTruthy();
    });

    // Neither the hidden id nor the hidden name may appear in the rendered document
    expect(container.innerHTML).not.toContain('safety.reassess');
    expect(container.innerHTML).not.toContain('Reassess after every change within an appropriate time');
  });

  it('starts case when clicking on the card article', () => {
    const fakeLearner = new FakeLearner();
    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    const card = screen.getByRole('listitem');
    fireEvent.click(card);
    expect(handleStart).toHaveBeenCalledWith('copd-niv-01');
  });

  it('displays learner unavailable banner when recommendations fail or learner is missing', async () => {
    const fakeLearner = new FakeLearner();
    vi.spyOn(fakeLearner, 'recommend').mockRejectedValue(new Error('Network offline or database locked'));

    const handleStart = vi.fn();

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={handleStart}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Learner recommendations currently unavailable/i)).toBeTruthy();
      expect(screen.getByText(/database locked/i)).toBeTruthy();
    });
  });

  it('renders cases sorted by curriculum tier order (Tier 1 before Tier 2 before Tier 3)', () => {
    const fakeLearner = new FakeLearner();
    const mockCases: CaseFile[] = [
      { ...realCopdCase, id: 'asthma-vent-01', title: 'Severe Asthma', difficulty: 3 } as CaseFile,
      { ...realCopdCase, id: 'copd-niv-01', title: 'COPD NIV', difficulty: 1 } as CaseFile,
      { ...realCopdCase, id: 'ards-vent-01', title: 'ARDS Vent', difficulty: 2 } as CaseFile,
    ];

    render(<CaseLibrary cases={mockCases} learner={fakeLearner} onStart={() => {}} />);
    const cards = screen.getAllByRole('listitem');
    expect(cards[0].textContent).toContain('COPD NIV'); // Tier 1
    expect(cards[1].textContent).toContain('ARDS Vent'); // Tier 2
    expect(cards[2].textContent).toContain('Severe Asthma'); // Tier 3
  });

  it('gates far-transfer variant probes until base case is completed, allowing toggle override', async () => {
    const fakeLearner = new FakeLearner();
    vi.spyOn(fakeLearner, 'listRuns').mockResolvedValue([]);

    const mockVariant: CaseFile = {
      ...realCopdCase,
      id: 'copd-niv-01--frail-elderly',
      title: 'Frail Elderly COPD Variant',
      difficulty: 1,
    } as CaseFile;

    const variantMeta: CaseVariantMetadata = {
      variantId: 'copd-niv-01--frail-elderly',
      baseCaseId: 'copd-niv-01',
      title: 'Transfer probe: Frail elderly patient',
      summary: 'Tests transfer of COPD NIV knowledge to frail elderly patient.',
      rationale: 'Transfer test',
      retestsMistake: {
        mistakeId: 'm-copd',
        competencyId: 'disease.copd',
        clinicalFocus: 'Frail patient settings',
      },
      source: 'Clinical protocol',
      changes: {
        vignette: 'Older patient vignette',
        parametersChanged: {},
      },
      overlay: {},
    };

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={() => {}}
        variants={[mockVariant]}
        variantsMeta={{ 'copd-niv-01--frail-elderly': variantMeta }}
      />
    );

    // Initial state: base case copd-niv-01 not completed, probe is locked
    const startProbeBtn = screen.getByTestId('start-probe-copd-niv-01--frail-elderly') as HTMLButtonElement;
    expect(startProbeBtn.disabled).toBe(true);
    expect(screen.getByTestId('locked-probe-badge')).toBeTruthy();

    // Toggle unlock all probes
    fireEvent.click(screen.getByTestId('toggle-unlock-all-probes'));
    expect(startProbeBtn.disabled).toBe(false);
  });

  it('hides the variant rationale until the learner has a finished run of that variant', async () => {
    const fakeLearner = new FakeLearner();
    vi.spyOn(fakeLearner, 'listRuns').mockResolvedValue([]);

    const mockVariant: CaseFile = {
      ...realCopdCase,
      id: 'copd-niv-01--frail-elderly',
      title: 'Frail Elderly COPD Variant',
      difficulty: 1,
    } as CaseFile;

    const variantMeta: CaseVariantMetadata = {
      variantId: 'copd-niv-01--frail-elderly',
      baseCaseId: 'copd-niv-01',
      title: 'Transfer probe: Frail elderly patient',
      summary: 'Tests transfer of COPD NIV knowledge to frail elderly patient.',
      rationale: 'This probe asks the learner to explain the trigger change aloud.',
      retestsMistake: { mistakeId: 'm-copd', competencyId: 'disease.copd', clinicalFocus: 'Frail patient settings' },
      source: 'Clinical protocol',
      changes: { vignette: 'Older patient vignette', parametersChanged: {} },
      overlay: {},
    };

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={() => {}}
        variants={[mockVariant]}
        variantsMeta={{ 'copd-niv-01--frail-elderly': variantMeta }}
      />
    );

    await waitFor(() => expect(screen.getByTestId('case-library-transfer-variants')).toBeTruthy());
    expect(screen.queryByText('This probe asks the learner to explain the trigger change aloud.')).toBeNull();
  });

  it('shows the variant rationale once that variant has a finished run', async () => {
    const fakeLearner = new FakeLearner();
    vi.spyOn(fakeLearner, 'listRuns').mockResolvedValue([
      {
        runId: 'r-1',
        activity: 'case',
        activityId: 'copd-niv-01--frail-elderly',
        activityVersion: '1',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:30:00.000Z',
        outcome: 'completed',
        score: 4,
        maxScore: 10,
        predictions: [],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      },
    ]);

    const mockVariant: CaseFile = {
      ...realCopdCase,
      id: 'copd-niv-01--frail-elderly',
      title: 'Frail Elderly COPD Variant',
      difficulty: 1,
    } as CaseFile;

    const variantMeta: CaseVariantMetadata = {
      variantId: 'copd-niv-01--frail-elderly',
      baseCaseId: 'copd-niv-01',
      title: 'Transfer probe: Frail elderly patient',
      summary: 'Tests transfer of COPD NIV knowledge to frail elderly patient.',
      rationale: 'This probe asks the learner to explain the trigger change aloud.',
      retestsMistake: { mistakeId: 'm-copd', competencyId: 'disease.copd', clinicalFocus: 'Frail patient settings' },
      source: 'Clinical protocol',
      changes: { vignette: 'Older patient vignette', parametersChanged: {} },
      overlay: {},
    };

    render(
      <CaseLibrary
        cases={[realCopdCase as CaseFile]}
        learner={fakeLearner}
        onStart={() => {}}
        variants={[mockVariant]}
        variantsMeta={{ 'copd-niv-01--frail-elderly': variantMeta }}
      />
    );

    await waitFor(() => expect(screen.getByText('This probe asks the learner to explain the trigger change aloud.')).toBeTruthy());
  });
});
