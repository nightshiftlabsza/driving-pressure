/**
 * FROZEN CONTRACT (Phase 4): Display alarm engine types.
 *
 * Owned by the phase orchestrator. Sub-agents may import from this file but must not edit it.
 * Priority follows IEC 60601-1-8 categories (high, medium, low).
 */
import type { DeviceSettings, MonitoredValues, BreathSummary } from '../shared/engineTypes';

export type AlarmPriority = 'high' | 'med' | 'low';

export type MetricId =
  | 'ppeak'
  | 'vte'
  | 'mv'
  | 'ftotal'
  | 'spo2'
  | 'hr'
  | 'map'
  | 'etco2'
  | 'leak'
  | 'peep';

export interface LimitDef {
  id: MetricId;
  name: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  /** Only meaningful with a ventilator circuit (invasive or NIV). */
  ventOnly?: boolean;
  read: (m: MonitoredValues) => number | null;
  lowMsg?: string;
  highMsg?: string;
  lowPriority?: AlarmPriority;
  highPriority?: AlarmPriority;
}

export interface Limit {
  low: number | null;
  high: number | null;
}

export type Limits = Record<MetricId, Limit>;

export const ALARM_IDS = {
  PPEAK_HIGH: 'ppeak-high',
  PPEAK_LOW: 'ppeak-low',
  DISCONNECT: 'disconnect',
  VTE_HIGH: 'vte-high',
  VTE_LOW: 'vte-low',
  MV_HIGH: 'mv-high',
  MV_LOW: 'mv-low',
  RR_HIGH: 'ftotal-high',
  APNOEA: 'apnoea',
  SPO2_LOW: 'spo2-low',
  LEAK_HIGH: 'leak-high',
  PEEP_LOW: 'peep-low',
  SPO2_UNAVAILABLE: 'spo2-na',
} as const;

export type StandardAlarmId = typeof ALARM_IDS[keyof typeof ALARM_IDS];

export interface ActiveAlarm {
  id: string;
  metric?: MetricId;
  side?: 'low' | 'high';
  priority: AlarmPriority;
  message: string;
  raisedAtSimSec: number;
  acknowledgedAtSimSec?: number;
  /** True when the underlying physiological condition is still active. */
  conditionActive: boolean;
  /** True if condition cleared but alarm is latched awaiting acknowledgement. */
  isLatched?: boolean;
}

export interface AlarmState {
  /** Currently active or latched alarms, sorted by priority (high, med, low). */
  alarms: ActiveAlarm[];
  /** Sim time until which audio alarms are silenced. */
  silencedUntilSimSec?: number;
  /** Timestamp in sim seconds when the last breath occurred (for apnoea detection). */
  lastBreathSimSec?: number;
  /** Sim seconds when apnoea limit was reached (if currently in apnoea). */
  apnoeaDetectedSimSec?: number;
}
