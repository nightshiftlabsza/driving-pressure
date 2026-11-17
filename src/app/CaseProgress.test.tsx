// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { caseStages, CaseProgress } from './CaseProgress';

afterEach(cleanup);
const o = (...names: string[]) => names.map(order => ({ order })) as { order: never }[];

describe('caseStages', () => {
  it('lights nothing at the start', () => {
    expect(caseStages([], false)).toEqual({ assess: false, act: false, reassess: false });
  });
  it('Assess needs the handoff taken and an exam or gas', () => {
    expect(caseStages(o('abg'), false).assess).toBe(false);
    expect(caseStages(o('cxr'), true).assess).toBe(false);
    expect(caseStages(o('examine'), true).assess).toBe(true);
  });
  it('Act is the first settings change or treatment order', () => {
    expect(caseStages(o('abg', 'cxr'), true).act).toBe(false);
    expect(caseStages(o('change-settings'), true).act).toBe(true);
    expect(caseStages(o('fluid-bolus'), true).act).toBe(true);
  });
  it('Reassess needs an exam or gas AFTER the first action', () => {
    expect(caseStages(o('abg', 'change-settings'), true).reassess).toBe(false);
    expect(caseStages(o('change-settings', 'cxr'), true).reassess).toBe(false);
    expect(caseStages(o('abg', 'change-settings', 'abg'), true)).toEqual({ assess: true, act: true, reassess: true });
  });
});

describe('CaseProgress', () => {
  it('shows patient time against the case length and no rubric text', () => {
    render(<CaseProgress simTimeSec={1500} maxSimMin={150} studyTime="0:00:05" stages={caseStages([], true)} fmt={s => `${Math.floor(s / 60)}m`} />);
    expect(screen.getByLabelText('Simulated time').textContent).toBe('25m');
    expect(screen.getByTestId('case-progress').textContent).toContain('of up to 150m');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1500');
  });
});
