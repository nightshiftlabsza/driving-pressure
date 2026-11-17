// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Home } from './Home';
import { FakeLearner } from './FakeLearner';
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

describe('Home collapse behaviour (Change A)', () => {
  const mockCases: CaseFile[] = [
    {
      id: 'pneumonia-hfnc-01',
      title: 'Short of breath on the ward (HFNC)',
      summary: 'Pneumonia HFNC case summary',
      difficulty: 1,
      competencies: ['niv.hfnc'],
      hiddenCompetencies: [],
      contextTags: ['pneumonia', 'hfnc'],
    } as unknown as CaseFile,
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

  function renderHome(overrides: Partial<Parameters<typeof Home>[0]> = {}) {
    return render(
      <Home
        learner={new FakeLearner()}
        catalogCases={mockCases}
        drillSets={mockDrills}
        labExperiments={mockLabs}
        onStartCase={vi.fn()}
        onStartDrill={vi.fn()}
        onStartLab={vi.fn()}
        {...overrides}
      />
    );
  }

  it('shows recommended card and current level expanded on first run, other levels collapsed', async () => {
    renderHome();

    // Recommended card visible without any interaction
    expect(await screen.findByTestId('home-recommended-card')).toBeTruthy();
    expect(screen.getByTestId('btn-start-recommended')).toBeTruthy();

    // Current level (1) is expanded: its activity section is rendered
    const l1 = screen.getByTestId('pathway-level-1');
    expect(l1.textContent).toContain('Physiology Labs');
    const l1Toggle = screen.getByTestId('pathway-level-toggle-1');
    expect(l1Toggle.getAttribute('aria-expanded')).toBe('true');
    expect(l1Toggle.getAttribute('aria-controls')).toBe('pathway-level-body-1');
    expect(document.getElementById('pathway-level-body-1')).toBeTruthy();

    // Other levels are collapsed: body absent, toggle row is a real button
    for (const level of [2, 3, 4]) {
      const toggle = screen.getByTestId(`pathway-level-toggle-${level}`);
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(`pathway-level-body-${level}`);
      expect(document.getElementById(`pathway-level-body-${level}`)).toBeNull();
      expect(screen.getByTestId(`pathway-level-${level}`).textContent).not.toContain('Physiology Labs');
    }
  });

  it('expands a collapsed level on click and collapses it again', async () => {
    renderHome();
    await screen.findByTestId('home-recommended-card');

    const toggle3 = screen.getByTestId('pathway-level-toggle-3');
    expect(toggle3.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(mockCases[0].title)).toBeNull();

    fireEvent.click(toggle3);
    // Expanding swaps the collapsed row for the expanded header toggle: re-query
    expect(screen.getByTestId('pathway-level-toggle-3').getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('pathway-level-body-3')).toBeTruthy();
    expect(screen.getByText(mockCases[0].title)).toBeTruthy();

    // Several levels can be open at once: expanding 3 did not collapse 1
    expect(screen.getByTestId('pathway-level-toggle-1').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('pathway-level-toggle-3'));
    expect(screen.getByTestId('pathway-level-toggle-3').getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('pathway-level-body-3')).toBeNull();
    expect(screen.queryByText(mockCases[0].title)).toBeNull();
  });

  it('hides competency checklists behind a disclosure inside each expanded level', async () => {
    renderHome();
    await screen.findByTestId('home-recommended-card');

    const checklistToggle = screen.getByTestId('pathway-level-checklist-toggle-1');
    expect(checklistToggle.getAttribute('aria-expanded')).toBe('false');
    expect(checklistToggle.getAttribute('aria-controls')).toBe('pathway-level-checklist-1');
    expect(document.getElementById('pathway-level-checklist-1')).toBeNull();

    fireEvent.click(checklistToggle);
    expect(checklistToggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('pathway-level-checklist-1')).toBeTruthy();
  });

  it('in browse mode levels 2-4 stay collapsed, locked indicators are gone and buttons are enabled after expanding', async () => {
    renderHome();
    await screen.findByTestId('home-recommended-card');

    fireEvent.click(screen.getByTestId('toggle-browse-mode'));

    // Levels 2-4 are still collapsed...
    for (const level of [2, 3, 4]) {
      expect(screen.getByTestId(`pathway-level-toggle-${level}`).getAttribute('aria-expanded')).toBe('false');
      expect(document.getElementById(`pathway-level-body-${level}`)).toBeNull();
    }

    // ...and no locked indicator is rendered anywhere
    expect(screen.queryByText(/🔒 Locked/)).toBeNull();

    // After expanding a collapsed level, its buttons are enabled
    fireEvent.click(screen.getByTestId('pathway-level-toggle-2'));
    const l2 = screen.getByTestId('pathway-level-2');
    expect(l2.textContent).toContain('Physiology Labs');
    const enabledButtons = Array.from(l2.querySelectorAll('button:not([disabled])'));
    expect(enabledButtons.length).toBeGreaterThan(0);
    expect(enabledButtons.some(b => b.textContent?.includes('Start'))).toBe(true);
  });
});
