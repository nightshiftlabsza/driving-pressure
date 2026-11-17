import { describe, it, expect } from 'vitest';
import { checkAbgConsistency, classifyAbg, calculateWintersExpectedPaCO2 } from './abgRules';

describe('abgRules', () => {
  describe('checkAbgConsistency (Henderson-Hasselbalch)', () => {
    it('passes normal baseline ABG (pH 7.40, PaCO2 40, HCO3 24)', () => {
      const res = checkAbgConsistency({ ph: 7.40, paco2MmHg: 40, hco3MmolL: 24 });
      expect(res.consistent).toBe(true);
      expect(res.calculatedPh).toBeCloseTo(7.39, 1);
      expect(res.diff).toBeLessThanOrEqual(0.03);
    });

    it('passes acute respiratory acidosis (pH 7.22, PaCO2 70, HCO3 27)', () => {
      const res = checkAbgConsistency({ ph: 7.22, paco2MmHg: 70, hco3MmolL: 27 });
      expect(res.consistent).toBe(true);
      expect(res.calculatedPh).toBeCloseTo(7.20, 1);
      expect(res.diff).toBeLessThanOrEqual(0.03);
    });

    it('passes metabolic acidosis (pH 7.26, PaCO2 25, HCO3 11)', () => {
      const res = checkAbgConsistency({ ph: 7.26, paco2MmHg: 25, hco3MmolL: 11 });
      expect(res.consistent).toBe(true);
      expect(res.calculatedPh).toBeCloseTo(7.26, 1);
      expect(res.diff).toBeLessThanOrEqual(0.03);
    });

    it('FAILS deliberately inconsistent ABG values (impossible chemistry)', () => {
      // pH 7.50 with PaCO2 80 and HCO3 15 is chemically impossible
      const res = checkAbgConsistency({ ph: 7.50, paco2MmHg: 80, hco3MmolL: 15 });
      expect(res.consistent).toBe(false);
      expect(res.diff).toBeGreaterThan(0.03);
    });

    it('FAILS when values are non-positive or NaN', () => {
      expect(checkAbgConsistency({ ph: 7.40, paco2MmHg: 0, hco3MmolL: 24 }).consistent).toBe(false);
      expect(checkAbgConsistency({ ph: 7.40, paco2MmHg: -10, hco3MmolL: 24 }).consistent).toBe(false);
      expect(checkAbgConsistency({ ph: 7.40, paco2MmHg: 40, hco3MmolL: 0 }).consistent).toBe(false);
      expect(checkAbgConsistency({ ph: 0, paco2MmHg: 40, hco3MmolL: 24 }).consistent).toBe(false);
      expect(checkAbgConsistency({ ph: NaN, paco2MmHg: 40, hco3MmolL: 24 }).consistent).toBe(false);
    });
  });

  describe('Winter formula calculation', () => {
    it('calculates expected PaCO2 for HCO3 12', () => {
      // 1.5 * 12 + 8 = 26 (+/- 2 => 24 to 28)
      const w = calculateWintersExpectedPaCO2(12);
      expect(w.expected).toBe(26);
      expect(w.min).toBe(24);
      expect(w.max).toBe(28);
    });
  });

  describe('classifyAbg (10+ textbook cases & mixed disorders)', () => {
    // Case 1: Normal
    it('Case 1: Normal blood gas', () => {
      const res = classifyAbg({ ph: 7.40, paco2MmHg: 40, hco3MmolL: 24 });
      expect(res.code).toBe('normal');
    });

    // Case 2: Acute respiratory acidosis
    it('Case 2: Acute respiratory acidosis', () => {
      // PaCO2 70 (+30 mmHg), delta HCO3 ~ 3 => HCO3 27, pH 7.21
      const res = classifyAbg({ ph: 7.22, paco2MmHg: 70, hco3MmolL: 27 });
      expect(res.code).toBe('respiratory_acidosis_acute');
    });

    // Case 3: Chronic respiratory acidosis
    it('Case 3: Chronic respiratory acidosis with appropriate renal compensation', () => {
      // PaCO2 65 (+25 mmHg), delta HCO3 ~ +9 to +10 => HCO3 34, pH 7.34
      const res = classifyAbg({ ph: 7.34, paco2MmHg: 65, hco3MmolL: 34 });
      expect(res.code).toBe('respiratory_acidosis_chronic');
    });

    // Case 4: Metabolic acidosis with appropriate compensation (Winter)
    it('Case 4: Metabolic acidosis with appropriate respiratory compensation', () => {
      // HCO3 11, expected PaCO2 = 1.5 * 11 + 8 = 24.5 +/- 2 (22.5 - 26.5), actual 25, pH 7.26
      const res = classifyAbg({ ph: 7.26, paco2MmHg: 25, hco3MmolL: 11 });
      expect(res.code).toBe('metabolic_acidosis_appropriate_compensation');
    });

    // Case 5: Metabolic acidosis with inadequate compensation (coexisting respiratory acidosis)
    it('Case 5: Metabolic acidosis with inadequate respiratory compensation', () => {
      // HCO3 12, expected PaCO2 = 24 - 28, actual 38 (above 28), pH 7.12
      const res = classifyAbg({ ph: 7.12, paco2MmHg: 38, hco3MmolL: 12 });
      expect(res.code).toBe('metabolic_acidosis_inadequate_compensation');
    });

    // Case 6: Metabolic acidosis with coexisting respiratory alkalosis
    it('Case 6: Metabolic acidosis with coexisting respiratory alkalosis', () => {
      // HCO3 11, expected PaCO2 = 22.5 - 26.5, actual 18 (below 22.5), pH 7.41
      const res = classifyAbg({ ph: 7.41, paco2MmHg: 18, hco3MmolL: 11 });
      expect(res.code).toBe('metabolic_acidosis_coexisting_resp_alkalosis');
    });

    // Case 7: Metabolic alkalosis with appropriate compensation
    it('Case 7: Metabolic alkalosis with appropriate respiratory compensation', () => {
      // HCO3 36, expected PaCO2 = 40 + 0.7 * 12 = 48.4 (+/- 3), actual 48, pH 7.50
      const res = classifyAbg({ ph: 7.50, paco2MmHg: 48, hco3MmolL: 36 });
      expect(res.code).toBe('metabolic_alkalosis_appropriate_compensation');
    });

    // Case 8: Mixed metabolic and respiratory acidosis
    it('Case 8: Mixed metabolic and respiratory acidosis', () => {
      // PaCO2 68 (high), HCO3 15 (low), pH 6.96
      const res = classifyAbg({ ph: 6.96, paco2MmHg: 68, hco3MmolL: 15 });
      expect(res.code).toBe('mixed_metabolic_and_respiratory_acidosis');
    });

    // Case 9: Mixed respiratory acidosis and metabolic alkalosis
    it('Case 9: Mixed respiratory acidosis and metabolic alkalosis', () => {
      // PaCO2 62, chronic expected HCO3 ~ 32-33, but actual is 41! pH 7.44
      const res = classifyAbg({ ph: 7.44, paco2MmHg: 62, hco3MmolL: 41 });
      expect(res.code).toBe('mixed_respiratory_acidosis_and_metabolic_alkalosis');
    });

    // Case 10: Acute respiratory alkalosis
    it('Case 10: Acute respiratory alkalosis', () => {
      // PaCO2 24 (-16 mmHg), acute expected HCO3 = 24 - 3.2 = 20.8, actual 21, pH 7.56
      const res = classifyAbg({ ph: 7.56, paco2MmHg: 24, hco3MmolL: 21 });
      expect(res.code).toBe('respiratory_alkalosis_acute');
    });

    // Case 11: Chronic respiratory alkalosis
    it('Case 11: Chronic respiratory alkalosis', () => {
      // PaCO2 25 (-15 mmHg), chronic expected HCO3 = 24 - 7.5 = 16.5, actual 17, pH 7.46
      const res = classifyAbg({ ph: 7.46, paco2MmHg: 25, hco3MmolL: 17 });
      expect(res.code).toBe('respiratory_alkalosis_chronic');
    });

    // Case 12: Mixed metabolic and respiratory alkalosis
    it('Case 12: Mixed metabolic and respiratory alkalosis', () => {
      // PaCO2 28 (low), HCO3 32 (high), pH 7.67
      const res = classifyAbg({ ph: 7.67, paco2MmHg: 28, hco3MmolL: 32 });
      expect(res.code).toBe('mixed_metabolic_and_respiratory_alkalosis');
    });

    // Edge Case 13: Metabolic alkalosis without full respiratory compensation (PaCO2 lower than expected)
    it('Case 13: Metabolic alkalosis with incomplete respiratory compensation', () => {
      // HCO3 34, expected PaCO2 44-50, actual 42, pH 7.52
      const res = classifyAbg({ ph: 7.52, paco2MmHg: 42, hco3MmolL: 34 });
      expect(res.code).toBe('metabolic_alkalosis_appropriate_compensation');
    });

    // Edge Case 14: Borderline HCO3 in respiratory acidosis correctly classified (not unclassified)
    it('Case 14: Borderline HCO3 in respiratory acidosis', () => {
      // PaCO2 70 (+30 mmHg), acute = 27, chronic = 34.5-36, actual 30.5, pH 7.25
      const res = classifyAbg({ ph: 7.25, paco2MmHg: 70, hco3MmolL: 30.5 });
      expect(res.code).toBe('respiratory_acidosis_acute');
    });

    // Edge Case 15: Borderline HCO3 in respiratory alkalosis correctly classified (not normal)
    it('Case 15: Borderline HCO3 in respiratory alkalosis', () => {
      // PaCO2 20 (-20 mmHg), acute = 20, chronic = 14, actual 17, pH 7.54
      const res = classifyAbg({ ph: 7.54, paco2MmHg: 20, hco3MmolL: 17 });
      expect(res.code).toBe('respiratory_alkalosis_acute');
    });

    // Edge Case 16: Severe alkalaemia fallback never returns normal
    it('Case 16: Severe alkalaemia fallback never returns normal', () => {
      const res = classifyAbg({ ph: 7.60, paco2MmHg: 36, hco3MmolL: 36 });
      expect(res.code).not.toBe('normal');
      expect(res.code).toBe('metabolic_alkalosis_appropriate_compensation');
    });
  });
});
