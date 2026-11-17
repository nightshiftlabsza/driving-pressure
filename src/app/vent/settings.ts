/**
 * Setting definitions for the ventilator-style controls: which settings each device and mode exposes,
 * their ranges, steps and display. Pure data and pure functions over DeviceSettings; no physiology.
 */
import type { DeviceSettings, InvasiveMode, InvasiveSettings, NivSettings } from '../../shared/engineTypes';
import { cycleProblem } from '../../engine/validate';
import { effectiveFio2, VENTURI_VALVES } from '../../engine/devices';

export type DeviceKind = DeviceSettings['device'];
export type O2Kind = Extract<DeviceSettings, { device: 'none' }>['o2'];

export interface ListOption { value: string; label: string }

export interface SettingSpec {
  id: string;
  label: string;
  /** Long name for the adjustment strip and screen readers. */
  name: string;
  unit?: string;
  kind: 'number' | 'list';
  min?: number;
  max?: number;
  step?: number;
  /** Larger step for Shift-click on the - and + buttons. */
  coarseStep?: number;
  decimals?: number;
  /** Values shown to the user; FiO2 is stored 0.21 to 1 but shown as O2 %. */
  read: (d: DeviceSettings) => number | string | undefined;
  write: (d: DeviceSettings, v: number | string) => DeviceSettings;
  options?: (d: DeviceSettings) => ListOption[];
}

// ---------------------------------------------------------------------------
// Device and mode labels
// ---------------------------------------------------------------------------

export const DEVICE_LABEL: Record<DeviceKind, string> = { none: 'Conventional O2', hfnc: 'High-flow O2', niv: 'NIV', invasive: 'Invasive' };
export const DEVICE_LONG: Record<DeviceKind, string> = {
  none: 'Conventional oxygen', hfnc: 'High-flow nasal oxygen', niv: 'Non-invasive ventilation', invasive: 'Invasive ventilation',
};
export type VentSkin = 'hamilton' | 'mindray';

export const INVASIVE_MODES: readonly InvasiveMode[] = ['VC-AC', 'PC-AC', 'SIMV-VC', 'PSV', 'CPAP', 'APRV'];
export const MODE_LABEL: Record<string, string> = {
  'VC-AC': 'VC-AC', 'PC-AC': 'PC-AC', 'SIMV-VC': 'SIMV-VC', PSV: 'PSV', CPAP: 'CPAP/PS', APRV: 'APRV', ST: 'S/T', 'NIV-CPAP': 'CPAP',
};
export const MODE_LONG: Record<string, string> = {
  'VC-AC': 'Volume control, assist-control', 'PC-AC': 'Pressure control, assist-control', 'SIMV-VC': 'Synchronised IMV, volume control',
  PSV: 'Pressure support', CPAP: 'CPAP with pressure support', APRV: 'Airway pressure release ventilation', ST: 'Bilevel, spontaneous/timed', 'NIV-CPAP': 'Mask CPAP',
};

export const HAMILTON_MODES: Record<string, string> = {
  'VC-AC': '(S)CMV',
  'PC-AC': 'PCV+',
  'SIMV-VC': 'SIMV',
  PSV: 'SPONT',
  CPAP: 'SPONT',
  APRV: 'APRV',
  ST: 'NIV-ST',
  'NIV-CPAP': 'NIV (CPAP)',
};

export const MINDRAY_MODES: Record<string, string> = {
  'VC-AC': 'V-A/C',
  'PC-AC': 'P-A/C',
  'SIMV-VC': 'V-SIMV',
  PSV: 'CPAP/PSV',
  CPAP: 'CPAP/PSV',
  APRV: 'APRV',
  ST: 'NIV P-A/C',
  'NIV-CPAP': 'NIV CPAP',
};

export interface UnsupportedMode {
  id: string;
  label: string;
  title: string;
}

export const HAMILTON_UNSUPPORTED_MODES: readonly UnsupportedMode[] = [
  { id: 'apvcmv', label: 'APVcmv', title: 'APVcmv — not simulated yet' },
  { id: 'apvsimv', label: 'APVsimv', title: 'APVsimv — not simulated yet' },
  { id: 'asv', label: 'ASV®', title: 'Adaptive Support Ventilation® — not simulated yet' },
  { id: 'intellivent', label: 'INTELLiVENT®', title: 'INTELLiVENT®-ASV — not simulated yet' },
];

export const MINDRAY_UNSUPPORTED_MODES: readonly UnsupportedMode[] = [
  { id: 'prvc', label: 'PRVC', title: 'PRVC — not simulated yet' },
  { id: 'prvc-simv', label: 'PRVC-SIMV', title: 'PRVC-SIMV — not simulated yet' },
];

export function unsupportedModesFor(kind: DeviceKind, skin?: VentSkin): readonly UnsupportedMode[] {
  if (kind !== 'invasive') return [];
  if (skin === 'hamilton') return HAMILTON_UNSUPPORTED_MODES;
  if (skin === 'mindray') return MINDRAY_UNSUPPORTED_MODES;
  return [];
}

export function modeLabel(mode: string, skin?: VentSkin): string {
  if (skin === 'hamilton') return HAMILTON_MODES[mode] ?? MODE_LABEL[mode] ?? mode;
  if (skin === 'mindray') return MINDRAY_MODES[mode] ?? MODE_LABEL[mode] ?? mode;
  return MODE_LABEL[mode] ?? mode;
}

export function modeLong(mode: string, skin?: VentSkin): string {
  const base = MODE_LONG[mode] ?? mode;
  if (skin === 'hamilton' && HAMILTON_MODES[mode]) return `${HAMILTON_MODES[mode]} (${base})`;
  if (skin === 'mindray' && MINDRAY_MODES[mode]) return `${MINDRAY_MODES[mode]} (${base})`;
  return base;
}

/** Checks whether two modes map to the same mode under the active skin (e.g. PSV and CPAP both map to SPONT in Hamilton). */
export function isSameSkinMode(modeA: string, modeB: string, skin?: VentSkin): boolean {
  if (modeA === modeB) return true;
  if ((skin === 'hamilton' || skin === 'mindray') && (modeA === 'PSV' || modeA === 'CPAP') && (modeB === 'PSV' || modeB === 'CPAP')) {
    return true;
  }
  return false;
}

/** The mode name as shown in the status bar and mode tabs. */
export function modeKey(d: DeviceSettings): string {
  if (d.device === 'invasive') return d.mode;
  if (d.device === 'niv') return d.mode === 'CPAP' ? 'NIV-CPAP' : 'ST';
  return d.device;
}
export function modeTitle(d: DeviceSettings, skin?: VentSkin): string {
  if (d.device === 'invasive' || d.device === 'niv') return modeLabel(modeKey(d), skin);
  if (d.device === 'hfnc') {
    if (skin === 'hamilton') return 'HiFlowO2';
    if (skin === 'mindray') return 'O2 Therapy';
    return 'HFNO';
  }
  return O2_LABELS[d.o2];
}

// ---------------------------------------------------------------------------
// Conventional oxygen
// ---------------------------------------------------------------------------

export const O2_KINDS: readonly O2Kind[] = ['room-air', 'nasal-cannula', 'simple-mask', 'venturi', 'non-rebreather'];
export const O2_LABELS: Record<O2Kind, string> = {
  'room-air': 'Room air', 'nasal-cannula': 'Nasal cannula', 'simple-mask': 'Simple face mask', venturi: 'Venturi mask', 'non-rebreather': 'Non-rebreather',
};
/** Flows each interface is actually run at. A simple mask below 5 L/min rebreathes CO2; a non-rebreather's bag must stay inflated. */
export const O2_FLOWS: Record<O2Kind, readonly number[]> = {
  'room-air': [0],
  'nasal-cannula': [1, 2, 3, 4, 5, 6],
  'simple-mask': [5, 6, 7, 8, 9, 10],
  venturi: VENTURI_VALVES.map(v => v.flowLpm),
  'non-rebreather': [10, 12, 15],
};
export const O2_HINTS: Record<O2Kind, string> = {
  'room-air': 'FiO2 0.21.',
  'nasal-cannula': 'Roughly FiO2 0.24 to 0.44; falls as minute ventilation rises.',
  'simple-mask': 'Roughly FiO2 0.35 to 0.55; variable.',
  venturi: 'Fixed FiO2 set by the valve. Use when oxygen must be controlled, for example in COPD with CO2 retention.',
  'non-rebreather': 'Roughly FiO2 0.6 to 0.85; not a precise FiO2.',
};
export function nearestFlow(kind: O2Kind, flow: number): number {
  const opts = O2_FLOWS[kind];
  return opts.reduce((best, f) => (Math.abs(f - flow) < Math.abs(best - flow) ? f : best), opts[0]!);
}
function flowLabel(kind: O2Kind, f: number): string {
  if (kind === 'venturi') {
    const v = VENTURI_VALVES.find(x => x.flowLpm === f);
    return v ? `${Math.round(v.fio2 * 100)}% ${v.colour} (${f} L/min)` : `${f} L/min`;
  }
  return `${f} L/min`;
}

// ---------------------------------------------------------------------------
// Defaults when switching device or mode (every value is reviewed before Confirm)
// ---------------------------------------------------------------------------

export function defaultsFor(kind: DeviceKind, current: DeviceSettings): DeviceSettings {
  // Never step oxygen down by switching device: start from what the patient is getting now (at least 0.4).
  const nowFio2 = 'fio2' in current ? current.fio2 : effectiveFio2(current, 0, 0);
  const fio2 = Math.max(0.4, Math.round(nowFio2 * 20) / 20);
  switch (kind) {
    case 'invasive': return { device: 'invasive', mode: 'VC-AC', fio2: 1, peep: 5, rrSetBpm: 16, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square', pinspAbovePeep: 15, tiSec: 1, psAbovePeep: 10 };
    case 'niv': return { device: 'niv', mode: 'ST', fio2, epap: 5, ipap: 15, backupRrBpm: 12, tiSec: 1, interface: 'oronasal', maskFit: 'good' };
    case 'hfnc': return { device: 'hfnc', flowLpm: 50, fio2, temperatureC: 37 };
    case 'none': return { device: 'none', o2: 'non-rebreather', o2FlowLpm: 15 };
  }
}

/** Switch mode within a device, filling any setting the new mode needs with a standard starting value. */
export function withMode(d: DeviceSettings, mode: string): DeviceSettings {
  if (d.device === 'invasive') {
    const m = mode as InvasiveMode;
    const next: InvasiveSettings = { ...d, mode: m };
    if ((m === 'VC-AC' || m === 'SIMV-VC') && next.vtSetMl === undefined) next.vtSetMl = 450;
    if ((m === 'VC-AC' || m === 'SIMV-VC') && next.inspFlowLpm === undefined) next.inspFlowLpm = 60;
    if (m === 'PC-AC') { next.pinspAbovePeep ??= 15; next.tiSec ??= 1; }
    if (m === 'APRV') {
      next.phighCmH2O ??= 25; next.plowCmH2O ??= 5; next.thighSec ??= 5; next.tlowSec ??= 0.6;
      next.peep = next.plowCmH2O;
    }
    if (m === 'PSV' || m === 'CPAP' || m === 'SIMV-VC') next.psAbovePeep ??= m === 'CPAP' ? 5 : 10;
    return next;
  }
  if (d.device === 'niv') {
    const m = mode === 'NIV-CPAP' ? 'CPAP' : 'ST';
    const next: NivSettings = { ...d, mode: m };
    if (m === 'ST') { next.ipap = Math.max(next.ipap ?? 15, next.epap + 5); next.backupRrBpm ??= 12; next.tiSec ??= 1; }
    return next;
  }
  return d;
}

export function modesFor(kind: DeviceKind, skin?: VentSkin): readonly string[] {
  if (kind === 'invasive') {
    if (skin === 'hamilton' || skin === 'mindray') return ['VC-AC', 'PC-AC', 'SIMV-VC', 'PSV', 'APRV'];
    return INVASIVE_MODES;
  }
  if (kind === 'niv') return ['NIV-CPAP', 'ST'];
  return [];
}

// ---------------------------------------------------------------------------
// Setting specs
// ---------------------------------------------------------------------------

const num = (id: string, label: string, name: string, unit: string | undefined, min: number, max: number, step: number,
  read: SettingSpec['read'], write: SettingSpec['write'], decimals = 0): SettingSpec =>
  ({ id, label, name, unit, kind: 'number', min, max, step, decimals, read, write });

const set = (d: DeviceSettings, patch: Record<string, unknown>) => ({ ...d, ...patch }) as DeviceSettings;
const field = (k: string) => (d: DeviceSettings) => (d as unknown as Record<string, number | string | undefined>)[k];

const O2_PCT = { ...num('fio2', 'O2', 'Oxygen concentration', '%', 21, 100, 1,
  d => ('fio2' in d ? Math.round(d.fio2 * 100) : undefined), (d, v) => set(d, { fio2: Number(v) / 100 })), coarseStep: 5 };
const PEEP = num('peep', 'PEEP', 'PEEP', 'cmH2O', 0, 25, 1, field('peep'), (d, v) => set(d, { peep: v }));
const RATE = num('rrSetBpm', 'f', 'Rate', 'b/min', 4, 40, 1, field('rrSetBpm'), (d, v) => set(d, { rrSetBpm: v }));
const VT = { ...num('vtSetMl', 'VT', 'Tidal volume', 'mL', 150, 1000, 10, field('vtSetMl'), (d, v) => set(d, { vtSetMl: v })), coarseStep: 50 };
const FLOW = num('inspFlowLpm', 'Peak flow', 'Peak inspiratory flow', 'L/min', 10, 120, 5, field('inspFlowLpm'), (d, v) => set(d, { inspFlowLpm: v }));
const PINSP = num('pinspAbovePeep', 'Pinsp', 'Inspiratory pressure above PEEP', 'cmH2O', 0, 40, 1, field('pinspAbovePeep'), (d, v) => set(d, { pinspAbovePeep: v }));
const TI = num('tiSec', 'Tinsp', 'Inspiratory time', 's', 0.3, 3, 0.05, field('tiSec'), (d, v) => set(d, { tiSec: Math.round(Number(v) * 100) / 100 }), 2);
const PS = num('psAbovePeep', 'ΔPsupp', 'Pressure support above PEEP', 'cmH2O', 0, 30, 1, field('psAbovePeep'), (d, v) => set(d, { psAbovePeep: v }));
const ETS = num('cyclePctPeakFlow', 'ETS', 'Expiratory trigger sensitivity', '%', 5, 80, 5, d => field('cyclePctPeakFlow')(d) ?? 25, (d, v) => set(d, { cyclePctPeakFlow: v }));
const RISE = num('riseTimeSec', 'Rise', 'Pressure rise time', 's', 0, 0.6, 0.05, d => field('riseTimeSec')(d) ?? 0.1, (d, v) => set(d, { riseTimeSec: Math.round(Number(v) * 100) / 100 }), 2);
const TRIG = num('triggerFlowLpm', 'F-Trig', 'Flow trigger', 'L/min', 0.5, 10, 0.5, d => field('triggerFlowLpm')(d) ?? 2, (d, v) => set(d, { triggerFlowLpm: v }), 1);
const PATTERN: SettingSpec = {
  id: 'flowPattern', label: 'Flow pattern', name: 'Inspiratory flow pattern', kind: 'list',
  read: d => field('flowPattern')(d) ?? 'square', write: (d, v) => set(d, { flowPattern: v }),
  options: () => [{ value: 'square', label: 'Square' }, { value: 'decelerating', label: 'Decelerating' }],
};

export function specsFor(d: DeviceSettings, skin?: VentSkin): SettingSpec[] {
  const o2Label = skin === 'hamilton' ? 'Oxygen' : skin === 'mindray' ? 'O2%' : 'O2';
  const vtLabel = skin === 'hamilton' ? 'Vt' : skin === 'mindray' ? 'TV' : 'VT';
  const rateLabel = skin === 'hamilton' ? 'Rate' : 'f';
  const peepLabel = skin === 'hamilton' ? 'PEEP/CPAP' : 'PEEP';
  const pinspLabel = 'Pinsp';
  const psLabel = skin === 'hamilton' ? 'Psupport' : 'ΔPsupp';
  const tiLabel = skin === 'hamilton' ? 'TI' : 'Tinsp';
  const riseLabel = skin === 'hamilton' ? 'P-ramp' : skin === 'mindray' ? 'Tslope' : 'Rise';
  const etsLabel = skin === 'mindray' ? 'Exp%' : 'ETS';
  const trigLabel = skin === 'hamilton' ? 'Trigger' : 'F-Trig';

  const o2Spec = { ...num('fio2', o2Label, 'Oxygen concentration', '%', 21, 100, 1,
    d2 => ('fio2' in d2 ? Math.round(d2.fio2 * 100) : undefined), (d2, v) => set(d2, { fio2: Number(v) / 100 })), coarseStep: 5 };
  const peepSpec = num('peep', peepLabel, 'PEEP', 'cmH2O', 0, 25, 1, field('peep'), (d2, v) => set(d2, { peep: v }));
  const rateSpec = num('rrSetBpm', rateLabel, 'Rate', 'b/min', 4, 40, 1, field('rrSetBpm'), (d2, v) => set(d2, { rrSetBpm: v }));
  const vtSpec = { ...num('vtSetMl', vtLabel, 'Tidal volume', 'mL', 150, 1000, 10, field('vtSetMl'), (d2, v) => set(d2, { vtSetMl: v })), coarseStep: 50 };
  const flowSpec = num('inspFlowLpm', 'Peak flow', 'Peak inspiratory flow', 'L/min', 10, 120, 5, field('inspFlowLpm'), (d2, v) => set(d2, { inspFlowLpm: v }));
  const pinspSpec = num('pinspAbovePeep', pinspLabel, 'Inspiratory pressure above PEEP', 'cmH2O', 0, 40, 1, field('pinspAbovePeep'), (d2, v) => set(d2, { pinspAbovePeep: v }));
  const tiSpec = num('tiSec', tiLabel, 'Inspiratory time', 's', 0.3, 3, 0.05, field('tiSec'), (d2, v) => set(d2, { tiSec: Math.round(Number(v) * 100) / 100 }), 2);
  const psSpec = num('psAbovePeep', psLabel, 'Pressure support above PEEP', 'cmH2O', 0, 30, 1, field('psAbovePeep'), (d2, v) => set(d2, { psAbovePeep: v }));
  const etsSpec = num('cyclePctPeakFlow', etsLabel, 'Expiratory trigger sensitivity', '%', 5, 80, 5, d2 => field('cyclePctPeakFlow')(d2) ?? 25, (d2, v) => set(d2, { cyclePctPeakFlow: v }));
  const riseSpec = num('riseTimeSec', riseLabel, 'Pressure rise time', 's', 0, 0.6, 0.05, d2 => field('riseTimeSec')(d2) ?? 0.1, (d2, v) => set(d2, { riseTimeSec: Math.round(Number(v) * 100) / 100 }), 2);
  const trigSpec = num('triggerFlowLpm', trigLabel, 'Flow trigger', 'L/min', 0.5, 10, 0.5, d2 => field('triggerFlowLpm')(d2) ?? 2, (d2, v) => set(d2, { triggerFlowLpm: v }), 1);

  const phighSpec = num('phighCmH2O', 'Phigh', 'High pressure (APRV)', 'cmH2O', 10, 40, 1, d2 => field('phighCmH2O')(d2) ?? 25, (d2, v) => set(d2, { phighCmH2O: v }));
  const plowSpec = num('plowCmH2O', 'Plow', 'Low pressure (APRV release)', 'cmH2O', 0, 15, 1, d2 => field('plowCmH2O')(d2) ?? 5, (d2, v) => set(d2, { plowCmH2O: v, peep: v }));
  const thighSpec = num('thighSec', 'Thigh', 'Time at high pressure', 's', 2, 12, 0.1, d2 => field('thighSec')(d2) ?? 5, (d2, v) => set(d2, { thighSec: Math.round(Number(v) * 10) / 10 }), 1);
  const tlowSpec = num('tlowSec', 'Tlow', 'Release time at low pressure', 's', 0.2, 1.5, 0.05, d2 => field('tlowSec')(d2) ?? 0.6, (d2, v) => set(d2, { tlowSec: Math.round(Number(v) * 100) / 100 }), 2);

  switch (d.device) {
    case 'invasive':
      switch (d.mode) {
        case 'APRV': return [o2Spec, phighSpec, plowSpec, thighSpec, tlowSpec];
        case 'VC-AC': return [o2Spec, vtSpec, rateSpec, peepSpec, flowSpec, PATTERN, trigSpec];
        case 'SIMV-VC': return [o2Spec, vtSpec, rateSpec, peepSpec, flowSpec, psSpec, trigSpec];
        case 'PC-AC': return [o2Spec, pinspSpec, rateSpec, tiSpec, peepSpec, riseSpec, trigSpec];
        case 'PSV': return [o2Spec, psSpec, peepSpec, etsSpec, riseSpec, trigSpec];
        case 'CPAP': return [o2Spec, peepSpec, psSpec, etsSpec, riseSpec, trigSpec];
      }
      break;
    case 'niv': {
      const iface: SettingSpec = {
        id: 'interface', label: 'Interface', name: 'Patient interface', kind: 'list', read: field('interface'), write: (x, v) => set(x, { interface: v }),
        options: () => [{ value: 'oronasal', label: 'Oronasal' }, { value: 'full-face', label: 'Full face' }, { value: 'nasal', label: 'Nasal' }, { value: 'helmet', label: 'Helmet' }],
      };
      const fit: SettingSpec = {
        id: 'maskFit', label: 'Fit', name: 'Mask fit', kind: 'list', read: field('maskFit'), write: (x, v) => set(x, { maskFit: v }),
        options: () => [{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'poor', label: 'Poor' }],
      };
      const nivEpapLabel = skin === 'hamilton' ? 'PEEP/CPAP' : skin === 'mindray' ? 'PEEP' : 'EPAP';
      const nivBackupRateLabel = skin === 'hamilton' ? 'Rate' : skin === 'mindray' ? 'f' : 'f backup';
      const nivBackupTiLabel = skin === 'hamilton' ? 'TI' : skin === 'mindray' ? 'Tinsp' : 'Ti backup';

      if (d.mode === 'CPAP') {
        return [o2Spec, num('epap', nivEpapLabel === 'PEEP/CPAP' ? 'CPAP' : nivEpapLabel, 'CPAP level', 'cmH2O', 3, 20, 1, field('epap'), (x, v) => set(x, { epap: v })), iface, fit];
      }
      return [
        o2Spec,
        num('ipap', pinspLabel, 'Inspiratory positive airway pressure', 'cmH2O', 5, 30, 1, field('ipap'), (x, v) => set(x, { ipap: v })),
        num('epap', nivEpapLabel, 'Expiratory positive airway pressure', 'cmH2O', 3, 20, 1, field('epap'), (x, v) => set(x, { epap: v })),
        num('backupRrBpm', nivBackupRateLabel, 'Backup rate', 'b/min', 0, 30, 1, field('backupRrBpm'), (x, v) => set(x, { backupRrBpm: v })),
        num('tiSec', nivBackupTiLabel, 'Backup inspiratory time', 's', 0.5, 2, 0.1, field('tiSec'), (x, v) => set(x, { tiSec: Math.round(Number(v) * 10) / 10 }), 1),
        iface, fit,
      ];
    }
    case 'hfnc':
      return [
        num('flowLpm', 'Flow', 'Gas flow', 'L/min', 10, 60, 5, field('flowLpm'), (x, v) => set(x, { flowLpm: v })),
        o2Spec,
        {
          id: 'temperatureC', label: 'Temp', name: 'Humidifier temperature', unit: '°C', kind: 'list', read: d2 => String(field('temperatureC')(d2)),
          write: (x, v) => set(x, { temperatureC: Number(v) }), options: () => ['31', '34', '37'].map(t => ({ value: t, label: `${t} °C` })),
        },
      ];
    case 'none':
      return [
        {
          id: 'o2', label: 'Interface', name: 'Oxygen interface', kind: 'list', read: field('o2'),
          write: (x, v) => { const k = v as O2Kind; return set(x, { o2: k, o2FlowLpm: k === 'room-air' ? 0 : nearestFlow(k, (x as { o2FlowLpm: number }).o2FlowLpm) }); },
          options: () => O2_KINDS.map(k => ({ value: k, label: O2_LABELS[k] })),
        },
        ...(d.o2 === 'room-air' ? [] : [{
          id: 'o2FlowLpm', label: d.o2 === 'venturi' ? 'Valve' : 'O2 flow', name: d.o2 === 'venturi' ? 'Venturi valve' : 'Oxygen flow',
          unit: d.o2 === 'venturi' ? undefined : 'L/min', kind: 'list' as const,
          read: (x: DeviceSettings) => String(nearestFlow((x as { o2: O2Kind }).o2, (x as { o2FlowLpm: number }).o2FlowLpm)),
          write: (x: DeviceSettings, v: number | string) => set(x, { o2FlowLpm: Number(v) }),
          options: (x: DeviceSettings) => { const k = (x as { o2: O2Kind }).o2; return O2_FLOWS[k].map(f => ({ value: String(f), label: flowLabel(k, f) })); },
        }]),
      ];
  }
  return [];
}

/** Display text for a setting value. */
export function formatValue(spec: SettingSpec, d: DeviceSettings): string {
  const v = spec.read(d);
  if (v === undefined || v === null || v === '') return '--';
  if (spec.kind === 'list') {
    const opt = spec.options?.(d).find(o => o.value === String(v));
    if (spec.id === 'o2FlowLpm' && (d as { o2?: O2Kind }).o2 === 'venturi') {
      const valve = VENTURI_VALVES.find(x => x.flowLpm === Number(v));
      return valve ? `${Math.round(valve.fio2 * 100)}%` : String(v);
    }
    if (spec.id === 'o2FlowLpm' || spec.id === 'temperatureC') return String(v);
    return opt?.label ?? String(v);
  }
  return Number(v).toFixed(spec.decimals ?? 0);
}

export function clampToSpec(spec: SettingSpec, v: number): number {
  const step = spec.step ?? 1;
  const min = spec.min ?? -Infinity, max = spec.max ?? Infinity;
  const snapped = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

/** Setting combinations the engine rejects or that make no sense; shown before Confirm is allowed. */
export function settingProblems(d: DeviceSettings): string[] {
  const out: string[] = [];
  if (d.device === 'niv' && d.mode === 'ST' && d.ipap !== undefined && d.ipap <= d.epap) out.push('IPAP must be higher than EPAP.');
  const cycle = cycleProblem(d);
  if (cycle) out.push(cycle);
  return out;
}

/** Derived timing readouts (arithmetic on settings only). */
export function timingReadout(d: DeviceSettings): string | null {
  if (d.device === 'invasive' && d.mode === 'APRV') {
    const hi = d.thighSec ?? 5, lo = d.tlowSec ?? 0.6;
    return `Cycle ${(hi + lo).toFixed(1)} s · ${(60 / (hi + lo)).toFixed(1)} releases/min`;
  }
  if (d.device === 'invasive') {
    const f = d.rrSetBpm;
    let ti: number | undefined;
    if (d.mode === 'PC-AC') ti = d.tiSec;
    else if ((d.mode === 'VC-AC' || d.mode === 'SIMV-VC') && d.vtSetMl && d.inspFlowLpm) {
      const meanFlowLps = (d.inspFlowLpm / 60) * (d.flowPattern === 'decelerating' ? 0.5 : 1);
      ti = d.vtSetMl / 1000 / meanFlowLps;
    }
    if (ti === undefined || !f) return null;
    const te = 60 / f - ti;
    if (te <= 0) return `Ti ${ti.toFixed(2)} s exceeds the breath cycle at ${f} b/min`;
    return `Ti ${ti.toFixed(2)} s · I:E 1:${(te / ti).toFixed(1)}`;
  }
  if (d.device === 'niv' && d.mode === 'ST' && d.backupRrBpm && d.tiSec) {
    const te = 60 / d.backupRrBpm - d.tiSec;
    return te > 0 ? `Backup I:E 1:${(te / d.tiSec).toFixed(1)}` : null;
  }
  return null;
}

/** Content equality that ignores key order and undefined fields. */
export function sameSettings(a: DeviceSettings, b: DeviceSettings): boolean {
  return settingsKey(a) === settingsKey(b);
}
export function settingsKey(d: DeviceSettings): string {
  const o = d as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => [k, o[k]]));
}
