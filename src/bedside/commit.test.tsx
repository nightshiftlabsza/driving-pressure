// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommitSheet } from './CommitSheet';
import { GENERIC_ASSESSMENTS, getAssessmentKey } from './assessmentLoader';

afterEach(() => {
  cleanup();
});

describe('Generic Assessments Data', () => {
  it('contains expected core assessments with sources', () => {
    expect(GENERIC_ASSESSMENTS.length).toBeGreaterThanOrEqual(8);
    const ids = GENERIC_ASSESSMENTS.map(a => a.id);
    expect(ids).toContain('hypoxaemic_failure');
    expect(ids).toContain('hypercapnic_failure');
    expect(ids).toContain('high_resistance');
    expect(ids).toContain('low_compliance');
    expect(ids).toContain('dynamic_hyperinflation');
    expect(ids).toContain('dyssynchrony');
    expect(ids).toContain('cardiogenic_pulmonary_edema');
    expect(ids).toContain('equipment_tube_problem');
    expect(ids).toContain('weaning_failure');
    expect(ids).toContain('weaning_ready');
    expect(ids).toContain('uncertain');

    for (const a of GENERIC_ASSESSMENTS) {
      expect(a.source, `Assessment ${a.id} must have a clinical source or teaching-convention`).toBeTruthy();
    }
  });

  it('has valid accepted assessment keys for all 11 library cases', () => {
    const caseIds = [
      'apo-cpap-01',
      'ards-vent-01',
      'asthma-vent-01',
      'copd-niv-01',
      'copd-psv-trigger-01',
      'dka-intubated-01',
      'dyssynchrony-01',
      'pneumonia-hfnc-01',
      'sbt-fail-01',
      'sbt-pass-01',
      'vent-high-pressure-01',
    ];
    for (const cid of caseIds) {
      const key = getAssessmentKey(cid);
      expect(key, `Key for ${cid} should exist`).not.toBeNull();
      expect(key?.acceptedAssessments.length).toBeGreaterThan(0);
      expect(key?.source).toBeTruthy();
    }
  });
});

describe('CommitSheet Component', () => {
  it('disables commit button until assessment and confidence are chosen', () => {
    const onCommit = vi.fn();
    render(<CommitSheet onCommit={onCommit} pendingActionDescription="Change settings" />);

    const commitBtn = screen.getByTestId('commit-button') as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);

    // Tap 1: Select an assessment
    const opt = screen.getByTestId('assessment-option-hypoxaemic_failure');
    fireEvent.click(opt);
    expect(commitBtn.disabled).toBe(true);

    // Tap 2: Select confidence
    const conf = screen.getByTestId('confidence-option-fairly_sure');
    fireEvent.click(conf);
    expect(commitBtn.disabled).toBe(false);

    // Tap 3: Commit
    fireEvent.click(commitBtn);
    expect(onCommit).toHaveBeenCalledWith(['hypoxaemic_failure'], 'fairly_sure');
  });

  it('allows selecting up to 2 assessments and replacing on 3rd selection', () => {
    const onCommit = vi.fn();
    render(<CommitSheet onCommit={onCommit} />);

    fireEvent.click(screen.getByTestId('assessment-option-hypoxaemic_failure'));
    fireEvent.click(screen.getByTestId('assessment-option-low_compliance'));
    fireEvent.click(screen.getByTestId('confidence-option-certain'));

    // Select a 3rd - should keep at most 2
    fireEvent.click(screen.getByTestId('assessment-option-dyssynchrony'));

    const commitBtn = screen.getByTestId('commit-button');
    fireEvent.click(commitBtn);

    expect(onCommit).toHaveBeenCalledWith(['low_compliance', 'dyssynchrony'], 'certain');
  });

  it('can be cancelled if onCancel prop provided', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<CommitSheet onCommit={onCommit} onCancel={onCancel} />);

    const cancelBtn = screen.getByLabelText('Dismiss sheet');
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('renders paused simulation clock message and not running message', () => {
    render(<CommitSheet onCommit={() => {}} />);
    expect(screen.getByText(/Simulation clock paused while committing/i)).toBeTruthy();
    expect(screen.queryByText(/Clock continues running/i)).toBeNull();
  });
});

describe('CommitSheet modal behaviour', () => {
  it('Escape cancels, focus moves inside, Tab cycles', () => {
    const onCancel = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<CommitSheet onCommit={vi.fn()} onCancel={onCancel} />);
    const dlg = screen.getByRole('dialog');
    expect(dlg.contains(document.activeElement)).toBe(true);
    const buttons = Array.from(dlg.querySelectorAll<HTMLElement>('button:not([disabled])'));
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(dlg.querySelector('button:not([disabled])'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
