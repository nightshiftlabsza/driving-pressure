/**
 * Respiratory mechanics and flow calculations.
 * Owned by Sub-agent 2 (Two-compartment lung & mechanics).
 *
 * Equation of motion: Paw - (V/C - Pmus) = R * flow.
 * Exact analytical solution over integration step dt with Paw and Pmus held constant:
 * V(t+dt) = V_eq + (V(t) - V_eq) * exp(-dt / tau) where V_eq = C * (Paw + Pmus) and tau = R * C.
 *
 * Physiology citations:
 * - Gattinoni L, Caironi P, Cressoni M, et al. Lung recruitment in patients with the acute
 *   respiratory distress syndrome. N Engl J Med 2006; 354(17):1775-1786.
 * - Amato MB, Meade MO, Slutsky AS, et al. Driving pressure and survival in the acute
 *   respiratory distress syndrome. N Engl J Med 2015; 372(8):747-755.
 */
import type { DeviceSettings, EngineState, PatientParams } from '../shared/engineTypes';
import { nivFitFactor } from './devices';
import { DEFAULT_PMAX_CMH2O, I } from './types';
import { effectiveCompliance, twoCompartmentDrivingPressure, twoCompartmentPalv } from './lung2';

export { effectiveCompliance, twoCompartmentDrivingPressure, twoCompartmentPalv };

/** High-pressure limit (Pmax) in cmH2O. Invasive ventilators cycle to expiration at this pressure. */
export function pmaxLimit(d: DeviceSettings): number {
  return d.device === 'invasive' ? (d.pmaxCmH2O ?? DEFAULT_PMAX_CMH2O) : Infinity;
}

/** Exact solution of V' = (Paw + Pmus - V/C)/R over dt with Paw and Pmus held constant. */
export function relax(V: number, paw: number, pmus: number, R: number, C: number, dt: number): number {
  const veq = C * (paw + pmus);
  const tau = (R * C) / 1000;
  return veq + (V - veq) * Math.exp(-dt / tau);
}

/**
 * Flow-limited expiration (all unverified teaching values): the part of the expiratory resistance upstream of the
 * choke point (peripheral airways) that sets the limited flow, and how much slower gas leaks once alveolar pressure
 * is below the critical pressure. A small upstream fraction makes expiration reach the pcrit plateau within one
 * breath, so applied PEEP below pcrit leaves total PEEP at about pcrit.
 */
const EFL_UPSTREAM_FRACTION = 0.6;
const EFL_TAIL_FACTOR = 60;

/**
 * One step of free/expiratory flow with optional expiratory flow limitation (waterfall):
 * while alveolar pressure exceeds the closing pressure, downstream pressure below it does not
 * speed exhalation; below the closing pressure, emptying is EFL_TAIL_FACTOR times slower.
 *
 * When lungModel === 'two-compartment', uses dynamic effective compliance based on recruitment
 * and overdistension state.
 */
export function flowStep(p: PatientParams, V: number, paw: number, pmus: number, C: number, dt: number): number {
  const cEff = p.lungModel === 'two-compartment' ? effectiveCompliance(p, V, paw) : C;
  const palv = V / cEff - pmus;
  if (paw >= palv) return relax(V, paw, pmus, p.inspResistanceCmH2OPerLps, cEff, dt);
  const pcrit = p.expFlowLimitationCmH2O;
  if (pcrit === undefined || paw >= pcrit) return relax(V, paw, pmus, p.expResistanceCmH2OPerLps, cEff, dt);
  if (palv > pcrit) return Math.max(relax(V, pcrit, pmus, p.expResistanceCmH2OPerLps * EFL_UPSTREAM_FRACTION, cEff, dt), cEff * (pcrit + pmus));
  return relax(V, paw, pmus, p.expResistanceCmH2OPerLps * EFL_TAIL_FACTOR, cEff, dt);
}

/** Delivered flow pattern in Volume Control (square or decelerating ramp). */
export function vcFlowLps(s: EngineState, tIn: number): number {
  const d = s.device;
  if (d.device !== 'invasive') return 0;
  const peak = (d.inspFlowLpm ?? 60) / 60;
  if ((d.flowPattern ?? 'square') === 'square') return peak;
  const vt = (d.vtSetMl ?? 450) / 1000;
  const ti = (2 * vt) / peak;
  return Math.max(0.05 * peak, peak * (1 - tIn / ti));
}

/** Pressure assistance above baseline for patient-triggered breaths (PS, PC inspiratory pressure, IPAP-EPAP). */
export function inspPressureAbovePeep(s: EngineState): number {
  const d = s.device, x = I(s);
  if (x.apnoeaBackup && x.control === 'pc' && x.backupPinsp !== undefined) return x.backupPinsp;
  if (d.device === 'invasive') {
    if (x.control === 'pc') return d.pinspAbovePeep ?? 15;
    return d.psAbovePeep ?? 0;
  }
  if (d.device === 'niv') {
    const fit = nivFitFactor(d.maskFit);
    return Math.max(0, (d.ipap ?? d.epap) - d.epap) * fit;
  }
  return 0;
}
