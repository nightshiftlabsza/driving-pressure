import type { DeviceSettings } from '../shared/engineTypes';

export interface RationaleReason {
  id: string;
  label: string;
  description: string;
}

export const RATIONALE_REASONS: readonly RationaleReason[] = [
  { id: 'oxygenation', label: 'Oxygenation', description: 'Improve PaO2 / SpO2 or reduce FiO2 toxicity' },
  { id: 'ventilation', label: 'CO2 / ventilation', description: 'Clear CO2 or correct acidaemia / alkalosis' },
  { id: 'lung_protection', label: 'Lung protection', description: 'Lower driving pressure, plateau pressure, or tidal volume' },
  { id: 'synchrony', label: 'Synchrony / comfort', description: 'Relieve work of breathing, fight, or trigger dyssynchrony' },
  { id: 'weaning', label: 'Weaning', description: 'Testing respiratory reserve or readiness for extubation/liberation' },
  { id: 'hypothesis_test', label: 'Testing a hypothesis', description: 'Diagnostic recruitment trial or response test' },
  { id: 'other', label: 'Other', description: 'Other clinical reason' },
] as const;

export const RATIONALE_RATE_LIMIT_SIM_SEC = 120; // 2 sim-minutes
export const RESCUE_COOLDOWN_SIM_SEC = 30; // 30 sim-seconds after alarm-driven rescue

/**
 * Checks whether a settings change meets the threshold for a major change:
 * - Mode change
 * - PEEP change >= 2 cmH2O
 * - FiO2 change >= 0.10
 * - Vt change >= 50 mL
 * - Pressure change >= 3 cmH2O (pinspAbovePeep, psAbovePeep, ipap, epap)
 */
export function isMajorSettingsChange(before: DeviceSettings, after: DeviceSettings): boolean {
  if (before.device !== after.device) return true;

  if (before.device === 'invasive' && after.device === 'invasive') {
    if (before.mode !== after.mode) return true;
    if (Math.abs(after.peep - before.peep) >= 2) return true;
    if (Math.abs(after.fio2 - before.fio2) >= 0.099) return true;

    if (before.mode === 'VC-AC' && after.mode === 'VC-AC') {
      const vtBefore = before.vtSetMl ?? 0;
      const vtAfter = after.vtSetMl ?? 0;
      if (Math.abs(vtAfter - vtBefore) >= 50) return true;
    }
    if (before.mode === 'PC-AC' && after.mode === 'PC-AC') {
      const pBefore = before.pinspAbovePeep ?? 0;
      const pAfter = after.pinspAbovePeep ?? 0;
      if (Math.abs(pAfter - pBefore) >= 3) return true;
    }
    if (before.mode === 'PSV' && after.mode === 'PSV') {
      const psBefore = before.psAbovePeep ?? 0;
      const psAfter = after.psAbovePeep ?? 0;
      if (Math.abs(psAfter - psBefore) >= 3) return true;
    }
  }

  if (before.device === 'niv' && after.device === 'niv') {
    if (Math.abs(after.fio2 - before.fio2) >= 0.099) return true;
    const epapBefore = before.epap;
    const epapAfter = after.epap;
    if (Math.abs(epapAfter - epapBefore) >= 2) return true;
    const ipapBefore = before.ipap ?? 0;
    const ipapAfter = after.ipap ?? 0;
    if (Math.abs(ipapAfter - ipapBefore) >= 3) return true;
  }

  if (before.device === 'hfnc' && after.device === 'hfnc') {
    if (Math.abs(after.fio2 - before.fio2) >= 0.099) return true;
    if (Math.abs(after.flowLpm - before.flowLpm) >= 10) return true;
  }

  return false;
}

/**
 * Checks if rationale chip can be shown given sim time and recent rescue/rationale history.
 */
export function canShowRationale(
  currentSimSec: number,
  lastRationaleSimSec: number | null,
  lastAlarmDrivenRescueSimSec: number | null
): boolean {
  if (
    lastAlarmDrivenRescueSimSec !== null &&
    currentSimSec - lastAlarmDrivenRescueSimSec < RESCUE_COOLDOWN_SIM_SEC
  ) {
    return false;
  }
  if (
    lastRationaleSimSec !== null &&
    currentSimSec - lastRationaleSimSec < RATIONALE_RATE_LIMIT_SIM_SEC
  ) {
    return false;
  }
  return true;
}
