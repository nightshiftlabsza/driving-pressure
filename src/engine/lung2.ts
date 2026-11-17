/**
 * Recruitable two-compartment lung model.
 * Owned by Sub-agent 2 (Two-compartment lung & mechanics).
 *
 * Physiology citations:
 * - Gattinoni L, Caironi P, Cressoni M, et al. Lung recruitment in patients with the acute
 *   respiratory distress syndrome. N Engl J Med 2006; 354(17):1775-1786.
 * - Amato MB, Meade MO, Slutsky AS, et al. Driving pressure and survival in the acute
 *   respiratory distress syndrome. N Engl J Med 2015; 372(8):747-755.
 * - Grasso S, Stripoli T, Sacchi M, et al. PEEP titration in ARDS: is driving pressure
 *   the answer? Intensive Care Med 2016; 42(10):1651-1653.
 *
 * Architecture:
 * - Compartment 1: Baseline open lung units ("baby lung") with baseline compliance C_base.
 * - Compartment 2: Recruitable alveolar units that open when airway / transpulmonary pressure
 *   exceeds critical opening pressure (default 10 cmH2O) and close / derecruit when end-expiratory
 *   pressure falls below closing pressure (default 5 cmH2O).
 * - Recruitment increases effective compliance C_eff by up to recruitComplianceMlPerCmH2O (default 14 mL/cmH2O),
 *   which at fixed tidal volume lowers driving pressure (Amato 2015).
 * - Overdistension: When end-expiratory lung volume (FRC above relaxation volume) exceeds
 *   overdistensionVolumeMl (default 600 mL, e.g. at excessive PEEP = 22 cmH2O), alveolar units
 *   become hyperinflated on the upper flat part of the static P-V curve. Compliance falls off
 *   according to overdistensionFalloff (default 0.058 mL/cmH2O per mL excess volume), causing
 *   driving pressure to rise sharply.
 * - Both compartments share the airway pressure Paw.
 * - When lungModel is undefined or 'single', C_eff = patient.complianceMlPerCmH2O exactly (100% backward compatible).
 */

import type { PatientParams } from '../shared/engineTypes';

export const DEFAULT_OPENING_PRESSURE_CMH2O = 10;
export const DEFAULT_CLOSING_PRESSURE_CMH2O = 5;
export const DEFAULT_RECRUIT_COMPLIANCE_ML_PER_CMH2O = 14;
export const DEFAULT_OVERDISTENSION_VOLUME_ML = 600;
export const DEFAULT_OVERDISTENSION_FALLOFF = 0.058;
export const MIN_COMPLIANCE_ML_PER_CMH2O = 5;

export interface TwoCompartmentAnalysis {
  cBase: number;
  cRecruited: number;
  cEff: number;
  recruitedFraction: number;
  isOverdistended: boolean;
  overdistensionLoss: number;
  restingVolumeMl: number;
  drivingPressureAtVt: (vtMl: number) => number;
  estimatedPplat: (vtMl: number, peep: number) => number;
}

/**
 * Detailed analysis of two-compartment mechanics for a given patient, volume, and PEEP.
 */
export function analyzeTwoCompartment(
  p: PatientParams,
  V?: number,
  peep?: number
): TwoCompartmentAnalysis {
  const cBase = p.complianceMlPerCmH2O;

  if (p.lungModel !== 'two-compartment') {
    const restingVol = peep !== undefined ? peep * cBase : (V ?? 0);
    return {
      cBase,
      cRecruited: 0,
      cEff: cBase,
      recruitedFraction: 0,
      isOverdistended: false,
      overdistensionLoss: 0,
      restingVolumeMl: restingVol,
      drivingPressureAtVt: (vtMl: number) => (cBase > 0 ? vtMl / cBase : 0),
      estimatedPplat: (vtMl: number, pSet: number) => pSet + (cBase > 0 ? vtMl / cBase : 0),
    };
  }

  const params = p.twoCompartmentParams;
  const pOpen = params?.openingPressureCmH2O ?? DEFAULT_OPENING_PRESSURE_CMH2O;
  const pClose = params?.closingPressureCmH2O ?? DEFAULT_CLOSING_PRESSURE_CMH2O;
  const recruitC = params?.recruitComplianceMlPerCmH2O ?? DEFAULT_RECRUIT_COMPLIANCE_ML_PER_CMH2O;
  const vOver = params?.overdistensionVolumeMl ?? DEFAULT_OVERDISTENSION_VOLUME_ML;
  const falloff = params?.overdistensionFalloff ?? DEFAULT_OVERDISTENSION_FALLOFF;

  // Effective pressure driving recruitment (sustained end-expiratory pressure / PEEP)
  const effPeep = peep !== undefined ? Math.max(0, peep) : (V !== undefined && cBase > 0 ? Math.max(0, V / cBase) : 0);

  // Recruitment fraction between closing and opening pressure
  let recruitFrac = 0;
  if (effPeep <= pClose) {
    recruitFrac = 0;
  } else if (effPeep >= pOpen) {
    recruitFrac = 1;
  } else if (pOpen > pClose) {
    recruitFrac = (effPeep - pClose) / (pOpen - pClose);
  }

  const cRecruited = cBase + recruitC * recruitFrac;

  // Operating volume for overdistension (end-expiratory volume supported by PEEP)
  const restingVol = effPeep * cRecruited;
  const evalVol = peep !== undefined ? restingVol : (V !== undefined ? V : restingVol);

  let overLoss = 0;
  if (evalVol > vOver) {
    overLoss = (evalVol - vOver) * falloff;
  }

  const cEff = Math.max(MIN_COMPLIANCE_ML_PER_CMH2O, cRecruited - overLoss);

  return {
    cBase,
    cRecruited: recruitC * recruitFrac,
    cEff,
    recruitedFraction: recruitFrac,
    isOverdistended: overLoss > 0,
    overdistensionLoss: overLoss,
    restingVolumeMl: restingVol,
    drivingPressureAtVt: (vtMl: number) => (cEff > 0 ? vtMl / cEff : 0),
    estimatedPplat: (vtMl: number, pSet: number) => pSet + (cEff > 0 ? vtMl / cEff : 0),
  };
}

/**
 * Calculate effective respiratory system compliance C_eff (mL/cmH2O).
 *
 * Highly optimized direct calculation for high-frequency (200 Hz) engine inner loop.
 * When lungModel is undefined or 'single', returns patient.complianceMlPerCmH2O exactly.
 * When lungModel === 'two-compartment', dynamically computes C_eff reflecting recruitment
 * and overdistension.
 */
export function effectiveCompliance(
  p: PatientParams,
  V?: number,
  peep?: number
): number {
  const cBase = p.complianceMlPerCmH2O;
  if (p.lungModel !== 'two-compartment') {
    return cBase;
  }

  const params = p.twoCompartmentParams;
  const pOpen = params?.openingPressureCmH2O ?? DEFAULT_OPENING_PRESSURE_CMH2O;
  const pClose = params?.closingPressureCmH2O ?? DEFAULT_CLOSING_PRESSURE_CMH2O;
  const recruitC = params?.recruitComplianceMlPerCmH2O ?? DEFAULT_RECRUIT_COMPLIANCE_ML_PER_CMH2O;
  const vOver = params?.overdistensionVolumeMl ?? DEFAULT_OVERDISTENSION_VOLUME_ML;
  const falloff = params?.overdistensionFalloff ?? DEFAULT_OVERDISTENSION_FALLOFF;

  const effPeep = peep !== undefined ? (peep > 0 ? peep : 0) : (V !== undefined && cBase > 0 ? (V > 0 ? V / cBase : 0) : 0);

  let recruitFrac = 0;
  if (effPeep <= pClose) {
    recruitFrac = 0;
  } else if (effPeep >= pOpen) {
    recruitFrac = 1;
  } else if (pOpen > pClose) {
    recruitFrac = (effPeep - pClose) / (pOpen - pClose);
  }

  const cRecruited = cBase + recruitC * recruitFrac;
  const restingVol = effPeep * cRecruited;
  const evalVol = peep !== undefined ? restingVol : (V !== undefined ? V : restingVol);

  let overLoss = 0;
  if (evalVol > vOver) {
    overLoss = (evalVol - vOver) * falloff;
  }

  const cEff = cRecruited - overLoss;
  return cEff > MIN_COMPLIANCE_ML_PER_CMH2O ? cEff : MIN_COMPLIANCE_ML_PER_CMH2O;
}

/**
 * Alveolar elastic recoil pressure Palv (cmH2O) for a given volume and PEEP.
 */
export function twoCompartmentPalv(
  p: PatientParams,
  V: number,
  peep?: number
): number {
  const C = effectiveCompliance(p, V, peep);
  return C > 0 ? V / C : 0;
}

/**
 * Static driving pressure (cmH2O) at fixed tidal volume and PEEP level.
 */
export function twoCompartmentDrivingPressure(
  p: PatientParams,
  vtMl: number,
  peep: number
): number {
  const C = effectiveCompliance(p, undefined, peep);
  return C > 0 ? vtMl / C : 0;
}
