// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { getHandoff } from './handoffLoader';
import { HandoffCard } from './HandoffCard';
import { loadAllCasesWithVariants } from '../screens/caseCatalog';

afterEach(() => {
  cleanup();
});

const ALL_CASE_IDS = [
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

describe('Bedside Handoff files', () => {
  it('loads valid handoffs for all 11 library cases', () => {
    for (const id of ALL_CASE_IDS) {
      const h = getHandoff(id);
      expect(h, `Handoff for ${id} should exist`).not.toBeNull();
      expect(h?.caseId).toBe(id);
      expect(h?.who).toBeTruthy();
      expect(h?.whyAdmitted).toBeTruthy();
      expect(h?.whatHasBeenDone).toBeTruthy();
      expect(h?.currentSupport).toBeTruthy();
      expect(h?.theWorry).toBeTruthy();
    }
  });

  it('contains no diagnosis labels or answers in the handoff titles/worries', () => {
    const forbiddenLabels: Record<string, string[]> = {
      'ards-vent-01': ['ARDS', 'acute respiratory distress syndrome', 'Berlin definition'],
      'vent-high-pressure-01': ['tension pneumothorax', 'pneumothorax', 'needle decompression', 'chest drain'],
      'dka-intubated-01': ['diabetic ketoacidosis', 'DKA', 'Winter\'s formula'],
      'copd-psv-trigger-01': ['ineffective triggering', 'trigger dyssynchrony'],
      'dyssynchrony-01': ['double triggering', 'breath stacking', 'flow starvation'],
      'asthma-vent-01': ['dynamic hyperinflation', 'auto-peep'],
      'apo-cpap-01': ['pulmonary oedema', 'pulmonary edema', 'acute cardiogenic'],
      'sbt-fail-01': ['weaning failure', 'failed sbt', 'extubation failure'],
      'sbt-pass-01': ['ready for extubation', 'passed sbt'],
    };

    for (const [caseId, forbidden] of Object.entries(forbiddenLabels)) {
      const h = getHandoff(caseId);
      expect(h).not.toBeNull();
      const combined = `${h?.who} ${h?.whyAdmitted} ${h?.theWorry}`.toLowerCase();
      for (const phrase of forbidden) {
        expect(combined).not.toContain(phrase.toLowerCase());
      }
    }
  });
});

describe('HandoffCard Component', () => {
  it('renders sign-out details and pauses until "Take over the patient" is pressed', () => {
    const handoff = getHandoff('ards-vent-01')!;
    const onTakeOver = vi.fn();

    render(<HandoffCard handoff={handoff} onTakeOver={onTakeOver} mode="initial" />);

    expect(screen.getByTestId('handoff-card')).toBeTruthy();
    expect(screen.getByText('Mr J. Kowalski (synthetic)')).toBeTruthy();
    expect(screen.getByText(handoff.who)).toBeTruthy();
    expect(screen.getByText(handoff.theWorry)).toBeTruthy();

    const btn = screen.getByTestId('take-over-button');
    expect(btn.textContent).toBe('Take over the patient');
    fireEvent.click(btn);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it('overrides base handoff patient demographics cleanly for disguised variants (CHAL-4)', () => {
    const catalog = loadAllCasesWithVariants();
    const pbwVariant = catalog.variants.find(v => v.id === 'ards-vent-01--pbw-short-female')!;
    expect(pbwVariant).toBeDefined();

    const h = getHandoff(pbwVariant.id, pbwVariant);
    expect(h).not.toBeNull();
    expect(h!.caseId).toBe('ards-vent-01--pbw-short-female');
    expect(h!.patientName).toContain('Mrs E. Davies');
    expect(h!.who).toContain('58yo female');
    expect(h!.who).toContain('152 cm');
    expect(h!.whyAdmitted).toContain('weighs nearly 100 kilos');
  });
});
