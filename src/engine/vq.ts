/**
 * Three-compartment Riley ventilation-perfusion (V/Q) inequality model.
 *
 * Sources:
 * 1. Riley RL, Cournand A. "'Ideal' alveolar air and the analysis of ventilation-perfusion
 *    relationships in the lungs." J Appl Physiol 1949; 1(12):825-847.
 * 2. West JB. Respiratory Physiology: The Essentials. 10th ed. Wolters Kluwer, 2016; Chapter 5.
 * 3. Nunn JF. Nunn's Applied Respiratory Physiology. 8th ed. Elsevier, 2016; Chapter 10.
 *
 * Mathematical and physiological principles:
 * - Pulmonary blood flow QT is partitioned into three parallel compartments:
 *   1. Anatomic/pathologic shunt (Qs/Qt): blood flows past unventilated lung units (V/Q = 0);
 *      end-capillary blood has mixed venous oxygen content (CvO2).
 *   2. Low V/Q compartment (lowVqFraction): perfusion to underventilated units where
 *      ventilation-perfusion ratio is low (default lowVqRatio = 0.1).
 *   3. Ideal compartment (1 - Qs/Qt - lowVqFraction): units with normal V/Q matching
 *      where end-capillary PO2 equilibrates with ideal alveolar PO2 (PAO2,ideal).
 *
 * - Low V/Q alveolar gas exchange:
 *   - Local alveolar ventilation is restricted: V_A,low = lowVqRatio * Q_low.
 *   - Local PACO2 is elevated towards mixed venous PvCO2 because reduced ventilation
 *     restricts CO2 excretion.
 *   - Local PAO2 is determined by steady-state O2 mass balance between alveolar ventilation
 *     and capillary uptake: (V_A/Q) * (PIO2 - PAO2,low) = 8.63 * (CcO2,low - CvO2).
 *   - As FiO2 increases, nitrogen (which occupies ~79% of room air) is progressively
 *     washed out of the compartment. When FiO2 approaches 1.0, the absence of nitrogen
 *     allows alveolar PO2 in low V/Q units to rise dramatically toward
 *     PAO2,max = (Patm - PH2O) - PACO2 (~665 mmHg), sharply contrasting with true shunt
 *     which remains refractory to supplemental oxygen.
 *
 * - Blood mixing (Fick principle):
 *   CaO2 = (1 - Qs - lowVqFraction) * CcO2,ideal + lowVqFraction * CcO2,low + Qs * CvO2
 *   CvO2 = CaO2 - VO2 / (10 * CO)
 *   Mixed venous oxygen content is subject to a physiological floor (30% of CcO2,ideal;
 *   Vincent 2008, Leach & Treacher 1998) to represent critical supply dependency.
 *   Arterial PaO2 is obtained by inverting the Severinghaus dissociation curve.
 */

import { PATM_MMHG, PH2O_MMHG, alveolarPo2, o2Content, po2FromContent } from './gas';

export interface VqArterialPo2Options {
  alvPo2?: number;
  fio2: number;
  paco2: number;
  shunt: number;
  hb: number;
  vo2: number;
  coLpm: number;
  ph: number;
  tempC: number;
  lowVqFraction?: number;
  lowVqRatio?: number;
}

/**
 * Calculates arterial PO2 using the Riley 3-compartment model (shunt, low V/Q, ideal).
 * When lowVqFraction is 0 or undefined, behaves 100% identically to the 1-compartment shunt equation.
 */
export function calculateVqArterialPo2(opts: VqArterialPo2Options): number {
  const fio2 = opts.fio2;
  const paco2 = opts.paco2;
  const pI = Math.max(0, fio2 * (PATM_MMHG - PH2O_MMHG));
  const pao2Ideal = opts.alvPo2 ?? alveolarPo2(fio2, paco2);
  const ccIdeal = o2Content(pao2Ideal, opts.hb, opts.ph, opts.tempC);
  const qs = Math.min(0.95, Math.max(0, opts.shunt));
  const rawLowVq = opts.lowVqFraction ?? 0;
  const lowVqFrac = Math.min(0.95 - qs, Math.max(0, rawLowVq));
  const fIdeal = Math.max(0, 1 - qs - lowVqFrac);
  const lowVqRatio = Math.max(0.01, Math.min(1.0, opts.lowVqRatio ?? 0.1));
  const dC = opts.vo2 / (10 * Math.max(0.5, opts.coLpm));
  const cvFloor = 0.3 * ccIdeal;

  // If no low V/Q fraction is present, revert exactly to single-compartment shunt equation
  if (lowVqFrac <= 0) {
    const cv = Math.max(cvFloor, ccIdeal - dC / (1 - qs));
    const ca = (1 - qs) * ccIdeal + qs * cv;
    return Math.min(pao2Ideal, po2FromContent(Math.max(0.5, ca), opts.hb, opts.ph, opts.tempC));
  }

  // Local low-V/Q PACO2: approaches mixed venous PvCO2 as lowVqRatio decreases
  const deltaPvco2 = Math.min(15, Math.max(4, 1.6 * dC));
  const pvco2 = paco2 + deltaPvco2;
  const paco2Low = paco2 + (1 - Math.min(1, lowVqRatio / 0.8)) * (pvco2 - paco2);
  const pao2Max = Math.max(10, (PATM_MMHG - PH2O_MMHG) - paco2Low);

  // Oxygen mass balance conversion constant: 0.863 * 10 = 8.63
  const kvq = lowVqRatio / 8.63;

  // Solve for low-V/Q alveolar PO2 (pAlvLowBase) via monotonic bisection:
  // fIdeal * (CcO2(m) - CcO2,ideal) + dC - (1 - qs) * kvq * (pI - m) = 0
  let lo = 1;
  let hi = Math.max(1.1, pao2Ideal);
  for (let j = 0; j < 40; j++) {
    const m = (lo + hi) / 2;
    const cm = o2Content(m, opts.hb, opts.ph, opts.tempC);
    const g = fIdeal * (cm - ccIdeal) + dC - (1 - qs) * kvq * (pI - m);
    if (g < 0) lo = m; else hi = m;
  }
  let pAlvLowBase = (lo + hi) / 2;
  let ccLow = o2Content(pAlvLowBase, opts.hb, opts.ph, opts.tempC);
  let cv = (fIdeal * ccIdeal + lowVqFrac * ccLow - dC) / (1 - qs);

  // Mixed venous oxygen content floor check
  if (cv < cvFloor) {
    cv = cvFloor;
    lo = 1;
    hi = Math.max(1.1, pao2Ideal);
    for (let j = 0; j < 40; j++) {
      const m = (lo + hi) / 2;
      const cm = o2Content(m, opts.hb, opts.ph, opts.tempC);
      const g = cm - cvFloor - kvq * (pI - m);
      if (g < 0) lo = m; else hi = m;
    }
    pAlvLowBase = (lo + hi) / 2;
    ccLow = o2Content(pAlvLowBase, opts.hb, opts.ph, opts.tempC);
  }

  // Nitrogen washout at higher FiO2:
  // When FiO2 increases, nitrogen is washed out and alveolar PO2 rises towards pao2Max.
  // At FiO2 <= 0.35, nitrogen is abundant (>65%), so washout factor is 0.
  // As FiO2 exceeds 0.35 towards 1.0, nitrogen washout factor increases smoothly.
  const washoutFactor = Math.pow(Math.max(0, (fio2 - 0.35) / 0.65), 3);
  const pAlvLow = (1 - washoutFactor) * pAlvLowBase + washoutFactor * pao2Max;
  ccLow = o2Content(pAlvLow, opts.hb, opts.ph, opts.tempC);

  // Recalculate mixed venous and mixed arterial contents
  cv = Math.max(cvFloor, (fIdeal * ccIdeal + lowVqFrac * ccLow - dC) / (1 - qs));
  const ca = fIdeal * ccIdeal + lowVqFrac * ccLow + qs * cv;

  return Math.min(pao2Ideal, po2FromContent(Math.max(0.5, ca), opts.hb, opts.ph, opts.tempC));
}
