/**
 * Gas exchange and acid-base: pure functions, no state.
 * Every equation here is a standard textbook relation; simplifications are named.
 */

import { calculateVqArterialPo2 } from './vq';

export const PATM_MMHG = 760;      // sea level. Altitude is not modelled in v1.
export const PH2O_MMHG = 47;
export const RQ = 0.8;

/** CO2 solubility in plasma at 37°C in mmol/L/mmHg.
 * Source: Severinghaus JW, Stupfel M, Bradley AF. Accuracy of blood pH and PCO2 determinations. J Appl Physiol 1956; 9(2):197-200.
 */
export const ALPHA_CO2 = 0.0301;

/** Henderson-Hasselbalch equation:
 * pH = 6.1 + log10(HCO3 / (alpha * PaCO2)).
 * With alpha = 0.0301 mmol/L/mmHg, HCO3 24 mmol/L and PaCO2 40 mmHg yield pH 7.400.
 * Citation: Severinghaus JW, Stupfel M, Bradley AF. J Appl Physiol 1956; 9(2):197-200.
 */
export function phFrom(hco3: number, paco2: number): number {
  return 6.1 + Math.log10(hco3 / (ALPHA_CO2 * paco2));
}

/**
 * Acute (non-renal) buffering of HCO3 relative to PaCO2 baseline (default 40 mmHg):
 * +0.1 mmol/L per mmHg above baseline, 0.2 per mmHg below baseline.
 * Scaled down when the metabolic HCO3 is low, so severe metabolic acidosis does not drive HCO3 toward zero.
 * If baselinePaco2 is 0 or paco2 <= 0, treats the first argument directly as delta PaCO2.
 */
export function acuteBuffer(paco2: number, metabolicHco3 = 24, baselinePaco2 = 40): number {
  const scale = Math.min(1, Math.max(0.1, metabolicHco3 / 24));
  const delta = (baselinePaco2 === 0 || paco2 <= 0) ? paco2 : paco2 - baselinePaco2;
  return (delta >= 0 ? 0.1 * delta : 0.2 * delta) * scale;
}

/**
 * Acute buffering directly from delta PaCO2 (difference from chronic baseline).
 */
export function acuteBufferDelta(deltaPaco2: number, metabolicHco3 = 24): number {
  const scale = Math.min(1, Math.max(0.1, metabolicHco3 / 24));
  return (deltaPaco2 >= 0 ? 0.1 * deltaPaco2 : 0.2 * deltaPaco2) * scale;
}

/**
 * Metabolic (standard) HCO3 from a measured HCO3 at a given PaCO2 and chronic baseline PaCO2:
 * Inverts the acute buffer relative to chronicPaco2 (default 40 mmHg).
 * Sources:
 * - Brackett NC Jr, Cohen JJ, Schwartz WB. Carbon dioxide titration curve of normal man. N Engl J Med 1965; 272:6-12.
 * - Schwartz WB, Brackett NC Jr, Cohen JJ. The response of extracellular hydrogen ion concentration to symptomatic hypercapnia. J Clin Invest 1965; 44(2):291-301.
 */
export function metabolicFromMeasured(measuredHco3: number, paco2: number, chronicPaco2 = 40): number {
  let m = measuredHco3;
  for (let i = 0; i < 30; i++) {
    m = measuredHco3 - acuteBuffer(paco2, m, chronicPaco2);
  }
  return m;
}

/**
 * Computes initial metabolic HCO3 at case start.
 * In chronic hypercapnia (chronicPaco2 > 40 mmHg), baseline renal metabolic compensation is:
 * Baseline = 24 + 0.35 * Math.max(0, chronicPaco2 - 40)
 * Sources: Brackett et al. (1965); Schwartz et al. (1965).
 * If measuredHco3 is provided, inverts acute buffering relative to chronicPaco2.
 * If measuredHco3 is not provided, returns the chronic baseline metabolic HCO3.
 */
export function initialMetabolicHco3(measuredHco3?: number, paco2 = 40, chronicPaco2 = 40): number {
  const baseMetabolic = 24 + 0.35 * Math.max(0, chronicPaco2 - 40);
  if (measuredHco3 !== undefined) {
    return metabolicFromMeasured(measuredHco3, paco2, chronicPaco2);
  }
  return baseMetabolic;
}

/** Standard base excess (SBE, extracellular Van Slyke equation). */
export function baseExcess(hco3: number, ph: number): number {
  return 0.93 * (hco3 - 24.4 + 14.8 * (ph - 7.4));
}

/**
 * Full alveolar gas equation:
 * PAO2 = FiO2 * (Patm - PH2O) - (PaCO2 / RQ) * [1 - FiO2 * (1 - RQ)]
 * Source: Nunn's Applied Respiratory Physiology (8th ed).
 */
export function alveolarPo2(fio2: number, paco2: number): number {
  return Math.max(0, fio2 * (PATM_MMHG - PH2O_MMHG) - (paco2 / RQ) * (1 - fio2 * (1 - RQ)));
}

/** Severinghaus haemoglobin dissociation curve with Kelman-style pH and temperature correction. */
export function satFromPo2(po2: number, ph = 7.4, tempC = 37): number {
  const p = Math.max(0.1, po2 * Math.pow(10, 0.48 * (ph - 7.4) - 0.024 * (tempC - 37)));
  return 1 / (23400 / (p * p * p + 150 * p) + 1);
}

/** O2 content in mL/dL. */
export function o2Content(po2: number, hb: number, ph = 7.4, tempC = 37): number {
  return 1.34 * hb * satFromPo2(po2, ph, tempC) + 0.003 * po2;
}

/** Invert o2Content by bisection. */
export function po2FromContent(content: number, hb: number, ph = 7.4, tempC = 37): number {
  let lo = 0.1, hi = 700;
  if (content <= o2Content(lo, hb, ph, tempC)) return lo;
  if (content >= o2Content(hi, hb, ph, tempC)) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (o2Content(mid, hb, ph, tempC) < content) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Arterial PO2 from the three-compartment Riley model (or shunt equation when lowVqFraction is omitted).
 * CaO2 = (1 - Qs - lowVqFraction) * CcO2 + lowVqFraction * CcO2,low + Qs * CvO2
 * CvO2 = CaO2 - VO2 / (10 * CO)
 * Under critical hypoxaemia or low cardiac output, mixed venous content is floored
 * at 30% of CcO2 (oxygen extraction capped at 70%), beyond which VO2 becomes
 * supply-limited (Fick principle; critical oxygen extraction ratio ~0.6-0.7,
 * Leach & Treacher 1998; Vincent 2008).
 * Low V/Q units (Riley & Cournand 1949; West 2016) account for supplemental oxygen responsiveness.
 */
export function arterialPo2(opts: {
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
}): number {
  if (opts.lowVqFraction !== undefined && opts.lowVqFraction > 0) {
    return calculateVqArterialPo2(opts);
  }
  const pao2Alv = opts.alvPo2 ?? alveolarPo2(opts.fio2, opts.paco2);
  const cc = o2Content(pao2Alv, opts.hb, opts.ph, opts.tempC);
  const qs = Math.min(0.95, Math.max(0, opts.shunt));
  const dC = opts.vo2 / (10 * Math.max(0.5, opts.coLpm));
  const cvFloor = 0.3 * cc;
  const cv = Math.max(cvFloor, cc - dC / (1 - qs));
  const ca = (1 - qs) * cc + qs * cv;
  return Math.min(pao2Alv, po2FromContent(Math.max(0.5, ca), opts.hb, opts.ph, opts.tempC));
}

/** Steady-state PaCO2 from the alveolar ventilation equation. VCO2 mL/min, VA L/min. */
export function steadyPaco2(vco2: number, vaLpm: number): number {
  if (vaLpm <= 0.05) return 250;
  return Math.min(250, 0.863 * vco2 / vaLpm);
}
