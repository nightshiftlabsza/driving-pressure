import type {
  DeviceSettings,
  EngineState,
  PatientParams,
  WaveformSample,
  BreathSummary,
  ManoeuvreResult,
} from '../shared/engineTypes';

export const BEDSIDE_TEST_IDS = {
  VENT_PPEAK: 'vent-ppeak',
  VENT_PMEAN: 'vent-pmean',
  VENT_PEEP: 'vent-peep',
  VENT_VTE: 'vent-vte',
  VENT_RR: 'vent-rr',
  VENT_MV: 'vent-mv',
  VENT_FIO2: 'vent-fio2',
  VENT_SPO2: 'vent-spo2',
  VENT_PPLAT: 'vent-pplat',
  CONTROL_MODE: 'control-mode',
  CONTROL_PEEP: 'control-peep',
  CONTROL_VT: 'control-vt',
  CONTROL_RR: 'control-rr',
  CONTROL_FIO2: 'control-fio2',
  CONTROL_PINSP: 'control-pinsp',
  CONTROL_PS: 'control-ps',
  CONTROL_APPLY: 'control-apply',
  BTN_INSP_HOLD: 'btn-insp-hold',
  BTN_EXP_HOLD: 'btn-exp-hold',
  PATIENT_PRESET: 'patient-preset',
  WAVEFORM_PLOT: 'waveform-plot',
} as const;

export type PatientPresetKey =
  | 'Normal'
  | 'ARDS'
  | 'COPD'
  | 'Obesity'
  | 'COVID'
  | 'Anaphylaxis'
  | 'PulmonaryEdema'
  | 'Pneumonia';

export interface UseEngineVentilatorOptions {
  initialPatient?: PatientParams;
  initialDevice?: DeviceSettings;
  presetKey?: PatientPresetKey;
  isPaused?: boolean;
}

export interface EngineVentilatorHook {
  state: EngineState;
  samples: WaveformSample[];
  lastBreath: BreathSummary | null;
  lastManoeuvre: ManoeuvreResult | null;
  isPaused: boolean;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
  setDevice: (device: DeviceSettings) => void;
  setPatientPreset: (presetKey: PatientPresetKey) => void;
  setPatient: (patch: Partial<PatientParams>) => void;
  startHold: (kind: 'insp-hold' | 'exp-hold', durationSec?: number) => void;
  reset: () => void;
}
