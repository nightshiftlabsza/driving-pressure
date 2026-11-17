import type { EvidenceType, Confidence } from '../shared/events';
import type { PatientParams, DeviceSettings, WaveformSample } from '../shared/engineTypes';

export type DrillAnswerFormat = 'single-choice' | 'multi-select' | 'direction';

export interface DrillOption {
  id: string;
  text: string;
}

export interface AlarmReadings {
  mode: string;
  setValues: Record<string, string | number | undefined>;
  ppeakCmH2O: number;
  pplatCmH2O?: number | null;
  vteMl: number;
  rrBpm: number;
  spo2Pct: number;
  bpMmHg?: string;
  alarmText: string;
}

export interface AbgValues {
  ph: number;
  paco2MmHg: number;
  pao2MmHg: number;
  hco3MmolL: number;
  fio2?: number;
  baseExcessMmolL?: number;
  lactateMmolL?: number;
}

export interface WaveformConfig {
  patient: PatientParams;
  device: DeviceSettings;
  nBreaths?: number;
}

export interface DrillItem {
  id: string;
  drillId: 'alarms' | 'abg' | 'waveforms';
  competency: string; // Valid competency id from competencies.json
  evidenceType: EvidenceType;
  category: 'alarm' | 'abg' | 'waveform';
  stem: string;
  answerFormat: DrillAnswerFormat;
  options: DrillOption[];
  answerKey: string | string[];
  explanation: string;

  // Optional contextual data
  vignette?: string;
  alarmReadings?: AlarmReadings;
  abgValues?: AbgValues;
  waveformConfig?: WaveformConfig;
}

export interface DrillSet {
  id: 'alarms' | 'abg' | 'waveforms';
  title: string;
  description: string;
  competencies: string[];
  items: DrillItem[];
}

export interface SyntheticWaveformTestData {
  description: string;
  samples: WaveformSample[];
}
