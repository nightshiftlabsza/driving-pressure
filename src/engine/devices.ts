/**
 * Device behaviour expressed as rules. Each rule names its basis; all are simplifications.
 */
import type { DeviceSettings, PatientParams, PpvResponse } from '../shared/engineTypes';
import { aprvSettings, type AprvDrive } from './aprv';

/** How the airway pressure is generated during a breath. */
export type Drive =
  | { kind: 'vent'; mode: 'VC-AC' | 'PC-AC' | 'PSV' | 'SIMV-VC' | 'NIV-ST'; peep: number }
  | { kind: 'free'; paw: number }
  | AprvDrive;

export function driveFor(d: DeviceSettings): Drive {
  switch (d.device) {
    case 'invasive':
      if (d.mode === 'APRV') return { kind: 'aprv', ...aprvSettings(d) };
      if (d.mode === 'CPAP') return (d.psAbovePeep ?? 0) > 0 ? { kind: 'vent', mode: 'PSV', peep: d.peep } : { kind: 'free', paw: d.peep };
      return { kind: 'vent', mode: d.mode, peep: d.peep };
    case 'niv': {
      const fit = nivFitFactor(d.maskFit);
      if (d.mode === 'CPAP') return { kind: 'free', paw: d.epap * fit };
      return { kind: 'vent', mode: 'NIV-ST', peep: d.epap * fit };
    }
    case 'hfnc':
      return { kind: 'free', paw: hfncPeep(d.flowLpm) };
    case 'none':
      return { kind: 'free', paw: 0 };
  }
}

/** Poor mask fit lowers the pressure actually delivered (leak exceeds compensation). */
export function nivFitFactor(fit: 'good' | 'fair' | 'poor'): number {
  return fit === 'good' ? 1 : fit === 'fair' ? 0.92 : 0.8;
}

/** NIV total leak, L/min: intentional (vented mask) plus unintentional by fit, scaling with sqrt(pressure). */
export function nivLeakLpm(fit: 'good' | 'fair' | 'poor', meanPressure: number): number {
  const base = fit === 'good' ? 25 : fit === 'fair' ? 40 : 70;
  return base * Math.sqrt(Math.max(1, meanPressure) / 10);
}

/** HFNC end-expiratory pressure, about 0.5 cmH2O per 10 L/min with the mouth partly open (Parke 2011 range 0.35-0.7). */
export function hfncPeep(flowLpm: number): number {
  return 0.05 * flowLpm;
}

/** Anatomic dead space washed out by HFNC (upper airway portion, about 50 mL, fully washed by about 40 L/min). */
export function hfncWashoutMl(flowLpm: number): number {
  return 50 * Math.min(1, flowLpm / 40);
}

/**
 * Effective inspired FiO2.
 * - Ventilator/NIV: as set.
 * - HFNC: set FiO2 when flow exceeds patient peak inspiratory flow, else diluted with room air.
 * - Low-flow devices (nasal cannula, simple mask): nominal FiO2 by device and flow, diluted when minute ventilation exceeds 10 L/min.
 * - Non-rebreather mask: reservoir bag holds ~750-1000 mL and supplies 100% O2 during early inspiration.
 *   Dilutes only when peak inspiratory flow exceeds fresh gas flow plus the reservoir contribution (~45 L/min).
 *   Delivers FiO2 0.55-0.80 (aiming 0.60-0.75) at elevated VE (~20 L/min) and FGF 15 L/min.
 *   Sources:
 *   - Wagstaff TA, Soni N. Performance of oxygen delivery devices. Br J Anaesth 2007; 99(5):426-434.
 *   - BTS Guideline for oxygen use in healthcare and emergency settings. Thorax 2017; 72 Suppl 1:ii1-90.
 */
/** Standard Venturi valves: driving O2 flow (L/min) and the FiO2 each delivers. */
export const VENTURI_VALVES: readonly { flowLpm: number; fio2: number; colour: string }[] = [
  { flowLpm: 2, fio2: 0.24, colour: 'blue' },
  { flowLpm: 4, fio2: 0.28, colour: 'white' },
  { flowLpm: 6, fio2: 0.31, colour: 'orange' },
  { flowLpm: 8, fio2: 0.35, colour: 'yellow' },
  { flowLpm: 10, fio2: 0.4, colour: 'red' },
  { flowLpm: 15, fio2: 0.6, colour: 'green' },
];

export function venturiFio2(flowLpm: number): number {
  if (flowLpm <= 0) return 0.21;
  let best = VENTURI_VALVES[0]!;
  for (const v of VENTURI_VALVES) if (flowLpm >= v.flowLpm) best = v;
  return best.fio2;
}

export function effectiveFio2(d: DeviceSettings, patientPifLpm: number, minuteVentLpm: number): number {
  switch (d.device) {
    case 'invasive':
    case 'niv':
      return d.fio2;
    case 'hfnc': {
      const pif = Math.max(1, patientPifLpm);
      if (d.flowLpm >= pif) return d.fio2;
      return (d.flowLpm * d.fio2 + (pif - d.flowLpm) * 0.21) / pif;
    }
    case 'none': {
      if (d.o2 === 'room-air' || !d.o2) return 0.21;
      if (d.o2 === 'non-rebreather') {
        const nominal = Math.min(0.85, 0.6 + 0.015 * d.o2FlowLpm);
        // Reservoir bag (~750-1000 mL) delivers 100% O2 during inspiration, contributing
        // ~45 L/min effective flow buffer in addition to continuous fresh gas flow.
        // Room air entrainment occurs only when peak inspiratory flow exceeds combined supply.
        // Citations: Wagstaff & Soni (2007) Br J Anaesth 99(5):426-434; BTS Guideline (2017).
        const reservoirFlowLpm = 45;
        const availableFlowLpm = d.o2FlowLpm + reservoirFlowLpm;
        const pif = Math.max(1, patientPifLpm > 0 ? patientPifLpm : minuteVentLpm * 3);
        const dilution = pif > availableFlowLpm ? availableFlowLpm / pif : 1;
        return 0.21 + (nominal - 0.21) * dilution;
      }
      let nominal = 0.21;
      if (d.o2 === 'nasal-cannula') nominal = Math.min(0.44, 0.21 + 0.04 * d.o2FlowLpm);
      if (d.o2 === 'simple-mask') nominal = Math.min(0.55, 0.25 + 0.03 * d.o2FlowLpm);
      // Venturi: the valve's O2 flow sets a fixed FiO2, and the high entrained total flow keeps it fixed.
      if (d.o2 === 'venturi') return venturiFio2(d.o2FlowLpm);
      const dilution = minuteVentLpm > 10 ? 10 / minuteVentLpm : 1;
      return 0.21 + (nominal - 0.21) * dilution;
    }
  }
}

export function setPeepLevel(d: DeviceSettings): number | null {
  if (d.device === 'invasive') return d.mode === 'APRV' ? aprvSettings(d).plow : d.peep;
  if (d.device === 'niv') return d.epap;
  return null;
}

/** Pressure used for recruitment (sustained end-expiratory pressure). */
export function recruitingPressure(d: DeviceSettings): number {
  const drive = driveFor(d);
  // APRV sustains pressure at both levels: recruitment follows the time-weighted mean pressure, not Plow alone.
  if (drive.kind === 'aprv') return (drive.phigh * drive.thigh + drive.plow * drive.tlow) / (drive.thigh + drive.tlow);
  return drive.kind === 'vent' ? drive.peep : drive.paw;
}

/**
 * Rule-based circulation. Mean alveolar pressure above 5 cmH2O is the intrathoracic load.
 * Returns fractional MAP change and HR change.
 */
export function ppvEffect(phenotype: PpvResponse, severity: number, palvMean: number): { mapFrac: number; hrDelta: number; coFrac: number } {
  const load = Math.max(0, palvMean - 5);
  switch (phenotype) {
    case 'clean-kill': { const f = -Math.min(0.7, severity * 0.03 * load); return { mapFrac: f, hrDelta: -f * 40, coFrac: f }; }
    case 'unhelpful': { const f = -Math.min(0.3, severity * 0.006 * load); return { mapFrac: f, hrDelta: 0, coFrac: f }; }
    case 'complicated': {
      const harm = Math.max(0, palvMean - 12);
      const f = palvMean <= 12 ? severity * 0.004 * load : -Math.min(0.6, severity * 0.03 * harm);
      return { mapFrac: f, hrDelta: -f * 30, coFrac: f };
    }
    case 'helpful': {
      const g = Math.min(0.25, severity * 0.025 * Math.min(10, Math.max(0, palvMean - 1)));
      return { mapFrac: -g * 0.3, hrDelta: -g * 60, coFrac: g };
    }
  }
}

export function pbwKg(p: PatientParams): number {
  return (p.sex === 'M' ? 50 : 45.5) + 0.91 * (p.heightCm - 152.4);
}
