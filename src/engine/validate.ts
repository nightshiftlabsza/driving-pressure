/**
 * Input validation for the engine (QA1-002, QA6-001, QA2-003).
 * Every path into the engine (UI, case JSON patientChange, imports) ends here, so impossible values
 * fail with a clear message instead of producing NaN or Infinity pressures.
 */
import type { DeviceSettings, PatientParams } from '../shared/engineTypes';

/** Shortest expiratory time the engine will accept (s). Below this the breath cycle is not physically deliverable. */
export const MIN_TE_SEC = 0.2;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function range(errors: string[], name: string, v: unknown, lo: number, hi: number) {
  if (v === undefined) return;
  if (!fin(v)) errors.push(`${name} must be a finite number`);
  else if (v < lo || v > hi) errors.push(`${name} must be between ${lo} and ${hi}`);
}

/** Inspiratory time (s) implied by the settings, or undefined when it cannot be known. */
export function impliedTiSec(d: DeviceSettings): number | undefined {
  if (d.device === 'invasive') {
    if (d.mode === 'PC-AC') return d.tiSec;
    if ((d.mode === 'VC-AC' || d.mode === 'SIMV-VC') && d.vtSetMl && d.inspFlowLpm) {
      const meanFlowLps = (d.inspFlowLpm / 60) * (d.flowPattern === 'decelerating' ? 0.5 : 1);
      return d.vtSetMl / 1000 / meanFlowLps;
    }
  }
  if (d.device === 'niv' && d.mode === 'ST') return d.tiSec;
  return undefined;
}

/** Message when the mandatory breath cycle leaves too little time to exhale, else null. Used by the UI too. */
export function cycleProblem(d: DeviceSettings): string | null {
  const rate = d.device === 'invasive' ? d.rrSetBpm : d.device === 'niv' && d.mode === 'ST' ? d.backupRrBpm : undefined;
  const ti = impliedTiSec(d);
  if (!rate || !ti || !fin(rate) || !fin(ti)) return null;
  const te = 60 / rate - ti;
  return te < MIN_TE_SEC ? `Inspiratory time ${ti.toFixed(1)} s leaves ${Math.max(0, te).toFixed(1)} s to exhale at ${rate} b/min. Lower the rate, raise the flow or shorten Ti.` : null;
}

export function deviceErrors(d: DeviceSettings): string[] {
  const e: string[] = [];
  if ('fio2' in d) { if (!fin(d.fio2) || d.fio2 < 0.21 || d.fio2 > 1) e.push('fio2 must be between 0.21 and 1'); }
  if (d.device === 'invasive') {
    range(e, 'PEEP', d.peep, 0, 40);
    range(e, 'Rate', d.rrSetBpm, 0, 80);
    range(e, 'VT', d.vtSetMl, 0, 2000);
    range(e, 'Peak flow', d.inspFlowLpm, 1, 200);
    range(e, 'Pinsp', d.pinspAbovePeep, 0, 80);
    range(e, 'Ti', d.tiSec, 0.1, 10);
    range(e, 'Pressure support', d.psAbovePeep, 0, 60);
    range(e, 'Cycle-off %', d.cyclePctPeakFlow, 1, 90);
    range(e, 'Flow trigger', d.triggerFlowLpm, 0.1, 20);
    range(e, 'Rise time', d.riseTimeSec, 0, 2);
    range(e, 'Pmax', d.pmaxCmH2O, 10, 120);
    range(e, 'Phigh', d.phighCmH2O, 10, 40);
    range(e, 'Plow', d.plowCmH2O, 0, 15);
    range(e, 'Thigh', d.thighSec, 2, 12);
    range(e, 'Tlow', d.tlowSec, 0.2, 1.5);
    if (d.mode === 'APRV') {
      const hi = d.phighCmH2O ?? 25, lo = d.plowCmH2O ?? 0;
      if (fin(hi) && fin(lo) && lo >= hi) e.push('Plow must be lower than Phigh');
    }
  } else if (d.device === 'niv') {
    range(e, 'EPAP', d.epap, 0, 30);
    range(e, 'IPAP', d.ipap, 0, 40);
    range(e, 'Backup rate', d.backupRrBpm, 0, 60);
    range(e, 'Ti', d.tiSec, 0.1, 10);
    if (d.mode === 'ST' && fin(d.ipap) && fin(d.epap) && d.ipap < d.epap) e.push('IPAP must be at least EPAP');
  } else if (d.device === 'hfnc') {
    range(e, 'HFNC flow', d.flowLpm, 0, 80);
  } else {
    range(e, 'Oxygen flow', d.o2FlowLpm, 0, 30);
  }
  const c = e.length ? null : cycleProblem(d);
  if (c) e.push(c);
  return e;
}

export function patientErrors(p: Partial<PatientParams>): string[] {
  const e: string[] = [];
  const r = (k: keyof PatientParams, lo: number, hi: number) => range(e, String(k), p[k], lo, hi);
  r('ageYears', 0, 120); r('heightCm', 80, 230); r('actualWeightKg', 20, 300);
  r('complianceMlPerCmH2O', 2, 250);
  r('inspResistanceCmH2OPerLps', 0.5, 60); r('expResistanceCmH2OPerLps', 0.5, 80);
  r('spontRateBpm', 0, 60); r('pmusAmplitudeCmH2O', 0, 40); r('pmusInspTimeSec', 0.2, 3);
  r('vco2MlPerMin', 20, 800); r('vo2MlPerMin', 20, 1000);
  r('anatomicDeadSpaceMl', 20, 400); r('alveolarDeadSpaceFraction', 0, 0.9);
  r('shuntFraction', 0, 0.9); r('recruitability', 0, 1);
  r('hbGPerDl', 3, 22); r('temperatureC', 28, 43);
  r('baselineHco3MmolL', 5, 50);
  r('hrBaselineBpm', 20, 220); r('sbpBaselineMmHg', 30, 260); r('dbpBaselineMmHg', 15, 160);
  r('ppvSeverity', 0, 1); r('respiratoryReserve', 0, 1);
  return e;
}

export function validateDevice(d: DeviceSettings) {
  const e = deviceErrors(d);
  if (e.length) throw new Error(e[0]);
}
export function validatePatient(p: Partial<PatientParams>) {
  const e = patientErrors(p);
  if (e.length) throw new Error(`Invalid patient: ${e[0]}`);
}
