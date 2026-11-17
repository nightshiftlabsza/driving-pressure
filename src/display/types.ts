/**
 * FROZEN CONTRACT (Phase 4): Shared ventilator display types and test IDs.
 *
 * Owned by the phase orchestrator. Sub-agents may import from this file but must not edit it.
 */
import type { WaveformSample, BreathSummary } from '../shared/engineTypes';

export interface CursorSample {
  tSec: number;
  pawCmH2O: number;
  flowLpm: number;
  volumeMl: number;
}

export type LoopType = 'pv' | 'fv';

export type DisplayScaleMode = 'auto' | 'fixed';

export interface BreathLoopData {
  samples: WaveformSample[];
  summary?: BreathSummary;
}

export const DISPLAY_TEST_IDS = {
  // Waveforms & loops
  SWEEP_WAVEFORMS: 'sweep-waveforms',
  WAVEFORM_CURSOR: 'waveform-cursor',
  CURSOR_READOUT: 'cursor-readout',
  BTN_FREEZE: 'btn-freeze',
  BTN_UNFREEZE: 'btn-unfreeze',
  BTN_SCALE_AUTO: 'btn-scale-auto',
  BTN_SCALE_FIXED: 'btn-scale-fixed',
  TAB_WAVEFORMS: 'tab-waveforms',
  TAB_LOOPS: 'tab-loops',
  LOOP_PV: 'loop-pv',
  LOOP_FV: 'loop-fv',

  // Alarms
  ALARM_BANNER: 'alarm-banner',
  ALARM_MESSAGE: 'alarm-message',
  ALARM_SILENCE_BTN: 'btn-alarm-silence',
  ALARM_ACK_BTN: 'btn-alarm-ack',

  // Numerics & monitor
  VENT_NUMERICS: 'vent-numerics',
  MONITOR_STRIP: 'monitor',
  TILE_PPEAK: 'vent-ppeak',
  TILE_PMEAN: 'vent-pmean',
  TILE_PEEP: 'vent-peep',
  TILE_PPLAT: 'vent-pplat',
  TILE_VTE: 'vent-vte',
  TILE_RR: 'vent-rr',
  TILE_MV: 'vent-mv',
  TILE_FIO2: 'vent-fio2',
  TILE_SPO2: 'vent-spo2',
  TILE_HFNC_PRESSURE: 'tile-hfnc-pressure',

  // Controls (matching bedside & case runner)
  VENT_CONTROLS: 'vent-controls',
  SETTING_KEYS: 'setting-keys',
  CONTROL_MODE: 'control-mode',
  CONTROL_PEEP: 'control-peep',
  CONTROL_VT: 'control-vt',
  CONTROL_RR: 'control-rr',
  CONTROL_FIO2: 'control-fio2',
  CONTROL_PINSP: 'control-pinsp',
  CONTROL_PS: 'control-ps',
  CONTROL_APPLY: 'control-apply',
  PATIENT_PRESET: 'patient-preset',
} as const;
