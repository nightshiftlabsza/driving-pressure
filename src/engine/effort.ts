/**
 * Effort monitoring and advanced respiratory mechanics (Physiology v2).
 *
 * Citations:
 * - Mauri T, Yoshida T, Bellani G, et al. Esophageal and transpulmonary pressure in the clinical setting:
 *   meaning, usefulness and perspectives. Intensive Care Med 2016; 42(9):1360-1373.
 * - Akoumianaki E, Maggiore SM, Valenza F, et al. The application of esophageal pressure measurement
 *   in patients with respiratory failure. Am J Respir Crit Care Med 2014; 189(5):520-531.
 * - Telias I, Damiani F, Brochard L. The airway occlusion pressure (P0.1) to monitor respiratory drive
 *   during mechanical ventilation: pros and cons. Intensive Care Med 2018; 44(11):1946-1949.
 * - Bertoni M, Telias I, Urner M, et al. A novel non-invasive method to detect excessively high respiratory
 *   effort and transpulmonary driving pressure during mechanical ventilation. Crit Care 2019; 23(1):346.
 */

import type { EngineState, ManoeuvreResult, PatientParams, WaveformSample } from '../shared/engineTypes';
import { I } from './types';
import { mainBreaths } from './aprv';

export interface CompliancePartition {
  C_rs: number; // total respiratory system compliance, mL/cmH2O
  C_cw: number; // chest wall compliance, mL/cmH2O
  C_l: number;  // lung compliance, mL/cmH2O
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Compliance partitioning:
 * 1/C_rs = 1/C_l + 1/C_cw
 *
 * Total respiratory system compliance C_rs = patient.complianceMlPerCmH2O.
 * Chest wall compliance C_cw = patient.chestWallComplianceMlPerCmH2O ?? (2 * C_rs).
 * Default: chest wall is twice as compliant as the total system (C_cw = 2 * C_rs => C_l = 2 * C_rs).
 * (Akoumianaki 2014)
 */
export function partitionCompliance(patient: PatientParams): CompliancePartition {
  const C_rs = Math.max(1, patient.complianceMlPerCmH2O);
  const rawCcw = patient.chestWallComplianceMlPerCmH2O ?? (2 * C_rs);
  // Ensure C_cw > C_rs to maintain positive lung compliance (C_l > 0)
  const C_cw = Math.max(C_rs * 1.02, rawCcw);
  const invCl = 1 / C_rs - 1 / C_cw;
  const C_l = invCl > 0 ? 1 / invCl : 2 * C_rs;
  return { C_rs, C_cw, C_l };
}

/**
 * Esophageal pressure (Pes) reflects pleural pressure:
 * Pes(t) = V(t) / C_cw - Pmus(t).
 * In passive breathing, Pes rises with volume (positive chest wall distension);
 * during inspiratory effort, muscular contraction pulls Pes downward.
 * (Mauri 2016, Akoumianaki 2014)
 */
export function esophagealPressure(volumeMl: number, C_cw: number, pmusCmH2O: number = 0): number {
  return volumeMl / C_cw - pmusCmH2O;
}

/**
 * Transpulmonary pressure:
 * P_L(t) = Paw(t) - Pes(t).
 * (Mauri 2016)
 */
export function transpulmonaryPressure(pawCmH2O: number, pesCmH2O: number): number {
  return pawCmH2O - pesCmH2O;
}

/**
 * Airway occlusion pressure in the first 100 ms of an occluded inspiratory effort (Telias 2018).
 * Normal resting P0.1 is 1.0–2.0 cmH2O.
 * Excessive respiratory drive (Pmus = 16 cmH2O) causes P0.1 >= 3.5 cmH2O.
 * Proportional to neuromuscular drive (effort amplitude and rate):
 * P0.1 ≈ 0.25 * Pmus_amplitude * (spontRate / 15).
 */
export function estimateP01(pmusAmplitudeCmH2O: number, spontRateBpm: number): number {
  if (pmusAmplitudeCmH2O <= 0 || spontRateBpm <= 0) return 0;
  return round1(0.25 * pmusAmplitudeCmH2O * (spontRateBpm / 15));
}

/**
 * Maximal negative airway pressure deflection during an end-expiratory occlusion manoeuvre (Bertoni 2019).
 * Delta Pocc ≈ Pmus / 0.75 (so when Pmus = 16 cmH2O, Delta Pocc >= 18 cmH2O, reaching ~21.3 cmH2O).
 */
export function estimateDeltaPocc(pmusAmplitudeCmH2O: number): number {
  if (pmusAmplitudeCmH2O <= 0) return 0;
  return round1(pmusAmplitudeCmH2O / 0.75);
}

/**
 * Estimated muscular pressure swing from occluded airway deflection (Bertoni 2019):
 * Pmus = round1(0.75 * Delta Pocc).
 * Dynamic transpulmonary driving pressure estimate = estimated Pmus.
 */
export function estimatePmusFromDeltaPocc(deltaPoccCmH2O: number): number {
  return round1(0.75 * deltaPoccCmH2O);
}

/**
 * Helper to get the effective spontaneous effort parameters accounting for chemoreflex drive.
 */
function effectiveEffortParams(s: EngineState): { amp: number; rate: number } {
  const p = s.patient;
  const x = I(s);
  const driveMult = typeof x.drive === 'number' && Number.isFinite(x.drive) && x.drive > 0 ? x.drive : 1;
  const rawAmp = p.pmusAmplitudeCmH2O ?? 0;
  const rawRate = p.spontRateBpm ?? 0;
  return {
    amp: rawAmp * driveMult,
    rate: rawRate * Math.sqrt(driveMult),
  };
}

/**
 * Process a completed manoeuvre result from the engine internal state.
 * Calibrates end-expiratory occlusion results according to Bertoni 2019.
 */
export function processManoeuvre(s: EngineState, rawResult: ManoeuvreResult): ManoeuvreResult {
  if (rawResult.kind !== 'occlusion') {
    return rawResult;
  }

  const { amp, rate } = effectiveEffortParams(s);
  const rawDeflection = rawResult.deltaPoccCmH2O ?? 0;

  // If raw deflection was tracked in airway without the 1/0.75 occlusion scaling factor,
  // scale it to the true occluded airway deflection (Bertoni 2019).
  // When Pmus is 16, Delta Pocc reaches ~21.3 cmH2O (>= 18 cmH2O).
  let deltaPocc: number;
  if (rawDeflection > 0) {
    deltaPocc = round1(rawDeflection / 0.75);
  } else if (amp > 0) {
    deltaPocc = estimateDeltaPocc(amp);
  } else {
    deltaPocc = 0;
  }

  const pmusEst = round1(0.75 * deltaPocc);
  const p01 = rawResult.p01CmH2O && rawResult.p01CmH2O > 0
    ? round1(rawResult.p01CmH2O)
    : estimateP01(amp, rate);

  return {
    kind: 'occlusion',
    deltaPoccCmH2O: deltaPocc,
    pmusEstimatedCmH2O: pmusEst,
    deltaPlDynEstimatedCmH2O: pmusEst,
    p01CmH2O: p01,
    valid: deltaPocc > 1.0,
  };
}

/**
 * Update monitored values in EngineState for effort monitoring and advanced mechanics.
 * Populates:
 * - pesCmH2O: instantaneous esophageal pressure (reflecting pleural pressure)
 * - plEndInspCmH2O: end-inspiratory transpulmonary pressure
 * - plEndExpCmH2O: end-expiratory transpulmonary pressure
 * - p01CmH2O: 100 ms airway occlusion pressure drop
 * - deltaPoccCmH2O: peak occlusion pressure deflection
 */
export function updateEffortMonitoring(s: EngineState): void {
  const p = s.patient;
  const x = I(s);
  const m = s.monitored;
  const { C_rs, C_cw } = partitionCompliance(p);
  const { amp, rate } = effectiveEffortParams(s);

  // 1. P0.1 and Delta Pocc
  if (amp > 0 && rate > 0) {
    m.p01CmH2O = estimateP01(amp, rate);
    m.deltaPoccCmH2O = estimateDeltaPocc(amp);
  } else {
    m.p01CmH2O = 0;
    m.deltaPoccCmH2O = 0;
  }

  // If a valid occlusion manoeuvre was recently performed, use its recorded values
  if (s.lastManoeuvre?.kind === 'occlusion' && s.lastManoeuvre.valid) {
    if (s.lastManoeuvre.p01CmH2O !== undefined) {
      m.p01CmH2O = s.lastManoeuvre.p01CmH2O;
    }
    if (s.lastManoeuvre.deltaPoccCmH2O !== undefined) {
      m.deltaPoccCmH2O = s.lastManoeuvre.deltaPoccCmH2O;
    }
  }

  // 2. Instantaneous Esophageal Pressure (Pes)
  const currentV = typeof x.V === 'number' && Number.isFinite(x.V) ? x.V : 0;
  let currentPmus = 0;
  if (x.effortStart >= 0 && amp > 0) {
    const te = s.simTimeSec - x.effortStart;
    const tiN = p.pmusInspTimeSec ?? 0.8;
    if (te >= 0 && te < tiN) {
      currentPmus = (amp * (1 - Math.cos((Math.PI * te) / tiN))) / 2;
    } else if (te >= tiN) {
      currentPmus = amp * Math.exp(-(te - tiN) / 0.15);
    }
  }
  m.pesCmH2O = round1(esophagealPressure(currentV, C_cw, currentPmus));

  // 3. End-Inspiratory and End-Expiratory Transpulmonary Pressures (PL,end-insp & PL,end-exp)
  const recentBreaths = mainBreaths(s);
  if (recentBreaths && recentBreaths.length > 0) {
    const lastB = recentBreaths[recentBreaths.length - 1];
    // End-inspiratory alveolar pressure is palvEndInsp (which is Pplat in passive ventilation)
    const pawEndInsp = lastB.palvEndInsp;
    const vEndInsp = pawEndInsp * C_rs;
    const pesEndInsp = esophagealPressure(vEndInsp, C_cw, 0);
    m.plEndInspCmH2O = round1(transpulmonaryPressure(pawEndInsp, pesEndInsp));

    // End-expiratory alveolar pressure is palvEndExp (PEEP + autoPEEP)
    const pawEndExp = lastB.palvEndExp;
    const vEndExp = pawEndExp * C_rs;
    const pesEndExp = esophagealPressure(vEndExp, C_cw, 0);
    m.plEndExpCmH2O = round1(transpulmonaryPressure(pawEndExp, pesEndExp));
  } else {
    // Fallback prior to first completed breath in breathLog
    const peep = m.peepSetCmH2O ?? 5;
    const estVt = s.device.device === 'invasive' && s.device.vtSetMl ? s.device.vtSetMl : 400;
    const pawEndInsp = peep + estVt / C_rs;
    const vEndInsp = pawEndInsp * C_rs;
    const pesEndInsp = esophagealPressure(vEndInsp, C_cw, 0);
    m.plEndInspCmH2O = round1(transpulmonaryPressure(pawEndInsp, pesEndInsp));

    const pawEndExp = peep;
    const vEndExp = pawEndExp * C_rs;
    const pesEndExp = esophagealPressure(vEndExp, C_cw, 0);
    m.plEndExpCmH2O = round1(transpulmonaryPressure(pawEndExp, pesEndExp));
  }
}

/**
 * Annotate waveform samples with esophageal (Pes) and transpulmonary (PL) pressure values.
 */
export function annotateWaveformSample(sample: WaveformSample, C_cw: number): void {
  const pes = esophagealPressure(sample.volumeMl, C_cw, sample.pmusCmH2O);
  sample.pesCmH2O = round1(pes);
  sample.plCmH2O = round1(transpulmonaryPressure(sample.pawCmH2O, pes));
}
