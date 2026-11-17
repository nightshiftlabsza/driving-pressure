// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Home } from '../screens/Home';
import { FakeLearner } from '../screens/FakeLearner';
import type { CaseFile } from '../shared/caseSchema';
import type { DrillSet } from '../drills/types';
import type { LabExperiment } from '../lab/schema';

afterEach(() => {
  cleanup();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  } catch { /* ignore */ }
});


describe('Home Screen UI', () => {
  const mockCases: CaseFile[] = [
    {
      id: 'copd-niv-01',
      title: 'Breathless at 3 a.m. on the respiratory ward',
      summary: 'COPD case summary',
      difficulty: 1,
      competencies: ['niv.selection'],
      hiddenCompetencies: [],
      contextTags: ['copd', 'niv'],
    } as unknown as CaseFile,
  ];

  const mockDrills: DrillSet[] = [
    {
      id: 'waveforms',
      title: 'Waveforms Drill',
      description: 'Practice normal waveforms',
      competencies: ['wave.normal'],
      items: [],
    },
  ];

  const mockLabs: LabExperiment[] = [
    {
      id: '01-rc-time-constant-exhalation',
      title: 'RC time constant and exhalation',
      subtitle: 'Exhalation time constant mechanics',
      difficulty: 1,
      competencies: ['mech.eom'],
      contextTags: ['rc-constant'],
    } as unknown as LabExperiment,
  ];

  it('renders learning pathway with Level 1 active and Levels 2-4 locked for new learner', async () => {
    const learner = new FakeLearner();
    render(
      <Home
        learner={learner}
        catalogCases={mockCases}
        drillSets={mockDrills}
        labExperiments={mockLabs}
        onStartCase={vi.fn()}
        onStartDrill={vi.fn()}
        onStartLab={vi.fn()}
      />
    );

    expect(await screen.findByText('Curriculum Pathway')).toBeTruthy();
    expect(screen.getByTestId('pathway-level-1')).toBeTruthy();
    expect(screen.getByTestId('pathway-level-2')).toBeTruthy();
    expect(screen.getByTestId('pathway-level-3')).toBeTruthy();
    expect(screen.getByTestId('pathway-level-4')).toBeTruthy();

    // Level 1 should be active
    expect(screen.getByText(/Active/i)).toBeTruthy();

    // Level 2 should display locked indicator
    expect(screen.getAllByText(/Locked/i).length).toBeGreaterThanOrEqual(1);
  });

  it('toggles browse mode and unlocks all levels', async () => {
    const learner = new FakeLearner();
    render(
      <Home
        learner={learner}
        catalogCases={mockCases}
        drillSets={mockDrills}
        labExperiments={mockLabs}
        onStartCase={vi.fn()}
        onStartDrill={vi.fn()}
        onStartLab={vi.fn()}
      />
    );

    const toggleBtn = await screen.findByTestId('toggle-browse-mode');
    expect(toggleBtn.textContent).toContain('Browse mode (unlock all)');

    // Click to enable browse mode
    fireEvent.click(toggleBtn);
    expect(toggleBtn.textContent).toContain('Browse mode active');

    // Expand the collapsed levels 2-4 so the locked-content check covers real content
    fireEvent.click(await screen.findByTestId('pathway-level-toggle-2'));
    fireEvent.click(await screen.findByTestId('pathway-level-toggle-3'));
    fireEvent.click(await screen.findByTestId('pathway-level-toggle-4'));

    // All levels should now be unlocked: no locked badges
    expect(screen.queryByText(/🔒 Locked/)).toBeNull();
  });

  it('launches recommended activity on click', async () => {
    const learner = new FakeLearner();
    const onStartLab = vi.fn();

    render(
      <Home
        learner={learner}
        catalogCases={mockCases}
        drillSets={mockDrills}
        labExperiments={mockLabs}
        onStartCase={vi.fn()}
        onStartDrill={vi.fn()}
        onStartLab={onStartLab}
      />
    );

    const card = await screen.findByTestId('home-recommended-card');
    expect(card).toBeTruthy();

    const startBtn = screen.getByTestId('btn-start-recommended');
    fireEvent.click(startBtn);

    expect(onStartLab).toHaveBeenCalledTimes(1);
    expect(onStartLab).toHaveBeenCalledWith(mockLabs[0]);
  });

  it('renders activities under locked levels with locked indicators and allows launching them in browse mode', async () => {
    const learner = new FakeLearner();
    const onStartCase = vi.fn();

    render(
      <Home
        learner={learner}
        catalogCases={mockCases}
        drillSets={mockDrills}
        labExperiments={mockLabs}
        onStartCase={onStartCase}
        onStartDrill={vi.fn()}
        onStartLab={vi.fn()}
      />
    );

    // Level 2 contains case 'copd-niv-01' (collapsed by default: expand it first)
    fireEvent.click(await screen.findByTestId('pathway-level-toggle-2'));
    const lvl2 = await screen.findByTestId('pathway-level-2');
    expect(lvl2).toBeTruthy();

    // Verify activity title is visible under Level 2
    expect(lvl2.textContent).toContain(mockCases[0].title);

    // With browse mode off, the button for the case inside Level 2 is disabled with "Locked 🔒"
    const caseTitleEl = screen.getByText(mockCases[0].title);
    const caseRow = caseTitleEl.closest('div.p-3');
    expect(caseRow).toBeTruthy();

    const lockedBtn = caseRow?.querySelector('button[disabled]');
    expect(lockedBtn).toBeTruthy();
    expect(lockedBtn?.textContent).toContain('Locked 🔒');

    // Attempting to click the locked button does NOT launch the case
    if (lockedBtn) {
      fireEvent.click(lockedBtn);
      expect(onStartCase).not.toHaveBeenCalled();
    }

    // Toggle browse mode on
    const toggleBtn = screen.getByTestId('toggle-browse-mode');
    fireEvent.click(toggleBtn);

    // Now the case button is unlocked and enabled with "Start"
    const startBtn = caseRow?.querySelector('button:not([disabled])');
    expect(startBtn).toBeTruthy();
    expect(startBtn?.textContent).toContain('Start');

    // Clicking it now launches the case!
    if (startBtn) {
      fireEvent.click(startBtn);
      expect(onStartCase).toHaveBeenCalledWith(mockCases[0]);
    }
  });
});
