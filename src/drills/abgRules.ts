/**
 * Pure functions for arterial blood gas (ABG) consistency and clinical classification.
 *
 * Rules implemented:
 * 1. Henderson-Hasselbalch equation consistency check:
 *    pH = 6.1 + log10(HCO3 / (0.0307 * PaCO2)), tolerance 0.03
 *
 * 2. Primary disorder and compensation rules:
 *    - Metabolic acidosis: Winter's formula expected PaCO2 = 1.5 * HCO3 + 8 (+/- 2)
 *    - Metabolic alkalosis: expected PaCO2 = 40 + 0.7 * (HCO3 - 24) (+/- 3)
 *    - Acute respiratory acidosis: delta HCO3 = 1 mmol/L per 10 mmHg PaCO2 above 40 (+/- 2)
 *    - Chronic respiratory acidosis: delta HCO3 = 3.5 to 4.0 mmol/L per 10 mmHg PaCO2 above 40 (+/- 2)
 *    - Acute respiratory alkalosis: delta HCO3 = -2 mmol/L per 10 mmHg PaCO2 below 40 (+/- 2)
 *    - Chronic respiratory alkalosis: delta HCO3 = -5 mmol/L per 10 mmHg PaCO2 below 40 (+/- 2)
 *    - Mixed disorders: combined primary disturbances
 */

export interface AbgInput {
  ph: number;
  paco2MmHg: number;
  hco3MmolL: number;
}

export interface AbgConsistencyResult {
  consistent: boolean;
  calculatedPh: number;
  diff: number;
  tolerance: number;
}

export type AbgClassificationCode =
  | 'normal'
  | 'metabolic_acidosis_appropriate_compensation'
  | 'metabolic_acidosis_inadequate_compensation'
  | 'metabolic_acidosis_coexisting_resp_alkalosis'
  | 'metabolic_alkalosis_appropriate_compensation'
  | 'respiratory_acidosis_acute'
  | 'respiratory_acidosis_chronic'
  | 'respiratory_alkalosis_acute'
  | 'respiratory_alkalosis_chronic'
  | 'mixed_metabolic_and_respiratory_acidosis'
  | 'mixed_metabolic_and_respiratory_alkalosis'
  | 'mixed_respiratory_acidosis_and_metabolic_alkalosis';

export interface AbgClassification {
  code: AbgClassificationCode;
  primaryDisorder: string;
  compensationStatus: string;
  summary: string;
  expectedFormula?: string;
  expectedRange?: { min: number; max: number };
}

/**
 * Validates internal consistency of an ABG using the Henderson-Hasselbalch equation.
 * pH = 6.1 + log10(HCO3 / (0.0307 * PaCO2))
 * Tolerance: 0.03 pH units.
 */
export function checkAbgConsistency(input: AbgInput, tolerance = 0.03): AbgConsistencyResult {
  const { ph, paco2MmHg, hco3MmolL } = input;
  if (!ph || ph <= 0 || isNaN(ph) || !paco2MmHg || paco2MmHg <= 0 || isNaN(paco2MmHg) || !hco3MmolL || hco3MmolL <= 0 || isNaN(hco3MmolL)) {
    return { consistent: false, calculatedPh: 0, diff: 999, tolerance };
  }
  const dissolvedCo2 = 0.0307 * paco2MmHg;
  const calculatedPh = 6.1 + Math.log10(hco3MmolL / dissolvedCo2);
  const diff = Math.abs(ph - calculatedPh);
  // Add micro-epsilon for floating point comparisons
  const consistent = diff <= tolerance + 1e-6;

  return {
    consistent,
    calculatedPh: Math.round(calculatedPh * 100) / 100,
    diff: Math.round(diff * 1000) / 1000,
    tolerance,
  };
}

/**
 * Calculates Winter's formula expected PaCO2 for metabolic acidosis.
 * Expected PaCO2 = 1.5 * HCO3 + 8 (+/- 2)
 */
export function calculateWintersExpectedPaCO2(hco3: number): { expected: number; min: number; max: number } {
  const expected = 1.5 * hco3 + 8;
  return {
    expected: Math.round(expected * 10) / 10,
    min: Math.round((expected - 2) * 10) / 10,
    max: Math.round((expected + 2) * 10) / 10,
  };
}

/**
 * Classifies an ABG based on standard physiological diagnostic rules.
 */
export function classifyAbg(input: AbgInput): AbgClassification {
  const { ph, paco2MmHg: paco2, hco3MmolL: hco3 } = input;

  // Normal reference ranges
  const isPhNormal = ph >= 7.35 && ph <= 7.45;
  const isPaco2Normal = paco2 >= 35 && paco2 <= 45;
  const isHco3Normal = hco3 >= 22 && hco3 <= 26;

  if (isPhNormal && isPaco2Normal && isHco3Normal) {
    return {
      code: 'normal',
      primaryDisorder: 'Normal',
      compensationStatus: 'Not applicable',
      summary: 'Normal arterial blood gas values within physiological baseline limits.',
    };
  }

  // Check for severe mixed acidosis: both elevated PaCO2 and depressed HCO3
  if (ph < 7.35 && paco2 > 45 && hco3 < 22) {
    return {
      code: 'mixed_metabolic_and_respiratory_acidosis',
      primaryDisorder: 'Mixed metabolic and respiratory acidosis',
      compensationStatus: 'Inadequate / dual primary failure',
      summary: 'Severe combined acidosis: both metabolic (low HCO3) and respiratory (high PaCO2) disturbances are present simultaneously.',
    };
  }

  // Check for severe mixed alkalosis: both low PaCO2 and high HCO3
  if (ph > 7.45 && paco2 < 35 && hco3 > 26) {
    return {
      code: 'mixed_metabolic_and_respiratory_alkalosis',
      primaryDisorder: 'Mixed metabolic and respiratory alkalosis',
      compensationStatus: 'Dual primary disturbance',
      summary: 'Severe combined alkalosis: both metabolic (elevated HCO3) and respiratory (low PaCO2) alkaloses drive the high pH.',
    };
  }

  // Check for primary metabolic acidosis
  if (hco3 < 22 && (ph < 7.35 || (ph <= 7.45 && paco2 <= 40))) {
    const winters = calculateWintersExpectedPaCO2(hco3);
    const expectedFormula = `Winter's formula: 1.5 x [HCO3-] (${hco3}) + 8 = ${winters.expected} mmHg (range ${winters.min} - ${winters.max} mmHg)`;

    if (paco2 >= winters.min && paco2 <= winters.max) {
      return {
        code: 'metabolic_acidosis_appropriate_compensation',
        primaryDisorder: 'Metabolic acidosis',
        compensationStatus: 'Appropriate respiratory compensation',
        summary: `Metabolic acidosis with expected compensatory hyperventilation. PaCO2 of ${paco2} mmHg falls within the expected Winter's range (${winters.min} to ${winters.max} mmHg).`,
        expectedFormula,
        expectedRange: { min: winters.min, max: winters.max },
      };
    }

    if (paco2 > winters.max) {
      return {
        code: 'metabolic_acidosis_inadequate_compensation',
        primaryDisorder: 'Metabolic acidosis with coexisting respiratory acidosis',
        compensationStatus: 'Inadequate respiratory compensation',
        summary: `Metabolic acidosis with inadequate respiratory compensation. Measured PaCO2 (${paco2} mmHg) exceeds Winter's ceiling of ${winters.max} mmHg, indicating superimposed respiratory failure / hypoventilation.`,
        expectedFormula,
        expectedRange: { min: winters.min, max: winters.max },
      };
    }

    if (paco2 < winters.min) {
      return {
        code: 'metabolic_acidosis_coexisting_resp_alkalosis',
        primaryDisorder: 'Metabolic acidosis with coexisting respiratory alkalosis',
        compensationStatus: 'Excessive hypocapnia',
        summary: `Metabolic acidosis with concomitant primary respiratory alkalosis. Measured PaCO2 (${paco2} mmHg) is lower than Winter's floor (${winters.min} mmHg), reflecting independent hyperventilation.`,
        expectedFormula,
        expectedRange: { min: winters.min, max: winters.max },
      };
    }
  }

  // Check for primary metabolic alkalosis
  if (hco3 > 26 && (ph > 7.45 || (ph >= 7.35 && paco2 >= 40))) {
    const deltaHco3 = hco3 - 24;
    const expectedPaCO2 = 40 + 0.7 * deltaHco3;
    const minPaCO2 = Math.round((expectedPaCO2 - 3) * 10) / 10;
    const maxPaCO2 = Math.round((expectedPaCO2 + 3) * 10) / 10;
    const expectedFormula = `Expected PaCO2 = 40 + 0.7 x ([HCO3-] - 24) = ${Math.round(expectedPaCO2 * 10) / 10} mmHg (range ${minPaCO2} - ${maxPaCO2} mmHg)`;

    // Check if chronic respiratory acidosis with metabolic alkalosis (pH <= 7.44)
    const deltaPaCO2 = paco2 - 40;
    const chronicHco3Max = 24 + 4.0 * (deltaPaCO2 / 10);
    if (paco2 > 45 && hco3 > chronicHco3Max + 2.5 && ph <= 7.44) {
      return {
        code: 'mixed_respiratory_acidosis_and_metabolic_alkalosis',
        primaryDisorder: 'Mixed respiratory acidosis and metabolic alkalosis',
        compensationStatus: 'Superimposed metabolic alkalosis beyond chronic compensation',
        summary: `Elevated PaCO2 with disproportionately high HCO3 (${hco3} mmol/L exceeds chronic renal compensation ceiling of ~${Math.round(chronicHco3Max + 2)} mmol/L), consistent with chronic hypercapnia plus concurrent metabolic alkalosis.`,
      };
    }

    if (paco2 < 35 && ph > 7.45) {
      return {
        code: 'mixed_metabolic_and_respiratory_alkalosis',
        primaryDisorder: 'Mixed metabolic and respiratory alkalosis',
        compensationStatus: 'Dual primary disturbance',
        summary: `Both metabolic alkalosis (elevated HCO3 ${hco3} mmol/L) and primary respiratory alkalosis (low PaCO2 ${paco2} mmHg) are present simultaneously.`,
      };
    }

    if (paco2 > maxPaCO2) {
      return {
        code: 'mixed_respiratory_acidosis_and_metabolic_alkalosis',
        primaryDisorder: 'Mixed respiratory acidosis and metabolic alkalosis',
        compensationStatus: 'Coexisting respiratory acidosis',
        summary: `Metabolic alkalosis with coexisting respiratory acidosis. PaCO2 of ${paco2} mmHg exceeds expected compensatory ceiling (${maxPaCO2} mmHg).`,
        expectedFormula,
        expectedRange: { min: minPaCO2, max: maxPaCO2 },
      };
    }

    return {
      code: 'metabolic_alkalosis_appropriate_compensation',
      primaryDisorder: 'Metabolic alkalosis',
      compensationStatus: 'Appropriate respiratory compensation',
      summary: `Metabolic alkalosis with expected compensatory hypoventilation. PaCO2 of ${paco2} mmHg aligns with expected compensation (${minPaCO2} to ${maxPaCO2} mmHg).`,
      expectedFormula,
      expectedRange: { min: minPaCO2, max: maxPaCO2 },
    };
  }

  // Check for primary respiratory acidosis
  if (paco2 > 45) {
    const deltaPaCO2 = paco2 - 40;
    const acuteExpectedHco3 = 24 + 1.0 * (deltaPaCO2 / 10);
    const chronicExpectedHco3Min = 24 + 3.5 * (deltaPaCO2 / 10);
    const chronicExpectedHco3Max = 24 + 4.0 * (deltaPaCO2 / 10);

    // If HCO3 exceeds chronic upper limit by more than 2, it is mixed with metabolic alkalosis
    if (hco3 > chronicExpectedHco3Max + 2) {
      return {
        code: 'mixed_respiratory_acidosis_and_metabolic_alkalosis',
        primaryDisorder: 'Mixed respiratory acidosis and metabolic alkalosis',
        compensationStatus: 'Metabolic alkalosis exceeding chronic renal compensation',
        summary: `Respiratory acidosis accompanied by an independent metabolic alkalosis. HCO3 (${hco3} mmol/L) exceeds the maximal chronic compensatory ceiling (${Math.round((chronicExpectedHco3Max + 2) * 10) / 10} mmol/L).`,
      };
    }

    // Midpoint between acute buffering and chronic renal compensation divides acute vs chronic
    const midpointHco3 = (acuteExpectedHco3 + chronicExpectedHco3Min) / 2;

    if (hco3 < midpointHco3) {
      return {
        code: 'respiratory_acidosis_acute',
        primaryDisorder: 'Acute respiratory acidosis',
        compensationStatus: 'Acute cellular buffering only (uncompensated by kidneys)',
        summary: `Acute respiratory acidosis. PaCO2 is ${paco2} mmHg, and HCO3 of ${hco3} mmol/L matches acute buffering (~1 mmol/L per 10 mmHg delta PaCO2: expected ${Math.round(acuteExpectedHco3 * 10) / 10} mmol/L).`,
        expectedFormula: `Acute expected HCO3 = 24 + 1.0 x ((PaCO2 - 40) / 10) = ${Math.round(acuteExpectedHco3 * 10) / 10} mmol/L`,
        expectedRange: {
          min: Math.round((acuteExpectedHco3 - 2) * 10) / 10,
          max: Math.round((acuteExpectedHco3 + 2) * 10) / 10,
        },
      };
    } else {
      return {
        code: 'respiratory_acidosis_chronic',
        primaryDisorder: 'Chronic respiratory acidosis',
        compensationStatus: 'Appropriate chronic renal compensation',
        summary: `Chronic respiratory acidosis with robust renal bicarbonate retention. PaCO2 is ${paco2} mmHg, with HCO3 of ${hco3} mmol/L fitting chronic renal compensation (~3.5 to 4.0 mmol/L per 10 mmHg delta PaCO2: expected ${Math.round(chronicExpectedHco3Min * 10) / 10} - ${Math.round(chronicExpectedHco3Max * 10) / 10} mmol/L).`,
        expectedFormula: `Chronic expected HCO3 = 24 + 3.5 to 4.0 x ((PaCO2 - 40) / 10) = ${Math.round(chronicExpectedHco3Min * 10) / 10} to ${Math.round(chronicExpectedHco3Max * 10) / 10} mmol/L`,
        expectedRange: {
          min: Math.round((chronicExpectedHco3Min - 2) * 10) / 10,
          max: Math.round((chronicExpectedHco3Max + 2) * 10) / 10,
        },
      };
    }
  }

  // Check for primary respiratory alkalosis
  if (paco2 < 35) {
    const deltaPaCO2 = 40 - paco2;
    const acuteExpectedHco3 = 24 - 2.0 * (deltaPaCO2 / 10);
    const chronicExpectedHco3 = 24 - 5.0 * (deltaPaCO2 / 10);

    // If HCO3 exceeds acute expected upper limit significantly and pH is alkalaemic
    if (hco3 > 26 && ph > 7.45) {
      return {
        code: 'mixed_metabolic_and_respiratory_alkalosis',
        primaryDisorder: 'Mixed metabolic and respiratory alkalosis',
        compensationStatus: 'Dual primary disturbance',
        summary: `Severe combined alkalosis: both metabolic (elevated HCO3 ${hco3} mmol/L) and respiratory (low PaCO2 ${paco2} mmHg) alkaloses drive the high pH.`,
      };
    }

    const midpointHco3 = (acuteExpectedHco3 + chronicExpectedHco3) / 2;

    if (hco3 >= midpointHco3) {
      return {
        code: 'respiratory_alkalosis_acute',
        primaryDisorder: 'Acute respiratory alkalosis',
        compensationStatus: 'Acute cellular buffering',
        summary: `Acute respiratory alkalosis. PaCO2 is low at ${paco2} mmHg, and HCO3 (${hco3} mmol/L) reflects acute buffering (drop of 2 mmol/L per 10 mmHg delta PaCO2: expected ${Math.round(acuteExpectedHco3 * 10) / 10} mmol/L).`,
        expectedFormula: `Acute expected HCO3 = 24 - 2.0 x ((40 - PaCO2) / 10) = ${Math.round(acuteExpectedHco3 * 10) / 10} mmol/L`,
        expectedRange: {
          min: Math.round((acuteExpectedHco3 - 2) * 10) / 10,
          max: Math.round((acuteExpectedHco3 + 2) * 10) / 10,
        },
      };
    } else {
      return {
        code: 'respiratory_alkalosis_chronic',
        primaryDisorder: 'Chronic respiratory alkalosis',
        compensationStatus: 'Appropriate chronic renal compensation',
        summary: `Chronic respiratory alkalosis. PaCO2 is ${paco2} mmHg, with renal bicarbonate excretion reducing HCO3 to ${hco3} mmol/L (expected ${Math.round(chronicExpectedHco3 * 10) / 10} mmol/L).`,
        expectedFormula: `Chronic expected HCO3 = 24 - 5.0 x ((40 - PaCO2) / 10) = ${Math.round(chronicExpectedHco3 * 10) / 10} mmol/L`,
        expectedRange: {
          min: Math.round((chronicExpectedHco3 - 2) * 10) / 10,
          max: Math.round((chronicExpectedHco3 + 2) * 10) / 10,
        },
      };
    }
  }

  // Fallback to closest classification
  if (ph < 7.35) {
    if (paco2 > 45) {
      return {
        code: 'respiratory_acidosis_acute',
        primaryDisorder: 'Acute respiratory acidosis',
        compensationStatus: 'Uncompensated',
        summary: `Respiratory acidaemia: pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
      };
    }
    if (hco3 < 22) {
      return {
        code: 'metabolic_acidosis_appropriate_compensation',
        primaryDisorder: 'Metabolic acidosis',
        compensationStatus: 'Compensated',
        summary: `Metabolic acidaemia: pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
      };
    }
    return {
      code: 'mixed_metabolic_and_respiratory_acidosis',
      primaryDisorder: 'Mixed metabolic and respiratory acidosis',
      compensationStatus: 'Dual primary failure',
      summary: `Severe combined acidaemia with pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
    };
  }

  if (ph > 7.45) {
    if (paco2 < 35) {
      return {
        code: 'respiratory_alkalosis_acute',
        primaryDisorder: 'Acute respiratory alkalosis',
        compensationStatus: 'Acute buffering',
        summary: `Respiratory alkalaemia: pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
      };
    }
    if (hco3 > 26) {
      return {
        code: 'metabolic_alkalosis_appropriate_compensation',
        primaryDisorder: 'Metabolic alkalosis',
        compensationStatus: 'Compensated',
        summary: `Metabolic alkalaemia: pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
      };
    }
    return {
      code: 'mixed_metabolic_and_respiratory_alkalosis',
      primaryDisorder: 'Mixed metabolic and respiratory alkalosis',
      compensationStatus: 'Dual primary disturbance',
      summary: `Severe combined alkalaemia with pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
    };
  }

  return {
    code: 'normal',
    primaryDisorder: 'Near-normal acid-base balance',
    compensationStatus: 'Compensated',
    summary: `Values near baseline: pH ${ph}, PaCO2 ${paco2} mmHg, HCO3 ${hco3} mmol/L.`,
  };
}
