/**
 * Display alarms: compares monitored values and breath summaries with operator-set limits,
 * following IEC 60601-1-8 alarm priorities and behaviors.
 * Reads engine outputs only; computes no physiology.
 */
import type { DeviceSettings, MonitoredValues, BreathSummary } from '../shared/engineTypes';
import {
  ALARM_IDS,
  type ActiveAlarm,
  type AlarmPriority,
  type AlarmState,
  type Limit,
  type LimitDef,
  type Limits,
  type MetricId,
} from './types';

export const LIMIT_DEFS: readonly LimitDef[] = [
  {
    id: 'ppeak',
    name: 'Ppeak',
    unit: 'cmH2O',
    step: 1,
    min: 5,
    max: 80,
    ventOnly: true,
    read: m => m.ppeakCmH2O,
    highMsg: 'Pressure high',
    lowMsg: 'Pressure low',
    highPriority: 'high',
    lowPriority: 'high',
  },
  {
    id: 'peep',
    name: 'PEEP',
    unit: 'cmH2O',
    step: 1,
    min: 0,
    max: 30,
    ventOnly: true,
    read: m => m.peepSetCmH2O,
    lowMsg: 'PEEP low',
    lowPriority: 'high',
  },
  {
    id: 'vte',
    name: 'VTe',
    unit: 'mL',
    step: 10,
    min: 0,
    max: 2000,
    ventOnly: true,
    read: m => m.vteMl,
    lowMsg: 'Tidal volume low',
    highMsg: 'Tidal volume high',
    lowPriority: 'med',
    highPriority: 'med',
  },
  {
    id: 'mv',
    name: 'MVe',
    unit: 'L/min',
    step: 0.5,
    min: 0,
    max: 40,
    ventOnly: true,
    read: m => m.minuteVentLpm,
    lowMsg: 'Minute volume low',
    highMsg: 'Minute volume high',
    lowPriority: 'high',
    highPriority: 'med',
  },
  {
    id: 'ftotal',
    name: 'ftotal',
    unit: 'b/min',
    step: 1,
    min: 0,
    max: 80,
    read: m => m.rrTotalBpm,
    lowMsg: 'Rate low',
    highMsg: 'Rate high',
    lowPriority: 'med',
    highPriority: 'med',
  },
  {
    id: 'etco2',
    name: 'EtCO2',
    unit: 'mmHg',
    step: 1,
    min: 0,
    max: 120,
    read: m => m.etco2MmHg,
    lowMsg: 'EtCO2 low',
    highMsg: 'EtCO2 high',
    lowPriority: 'med',
    highPriority: 'med',
  },
  {
    id: 'leak',
    name: 'Leak',
    unit: 'L/min',
    step: 5,
    min: 0,
    max: 200,
    ventOnly: true,
    read: m => m.leakLpm,
    highMsg: 'Leak high',
    highPriority: 'med',
  },
  {
    id: 'spo2',
    name: 'SpO2',
    unit: '%',
    step: 1,
    min: 50,
    max: 100,
    read: m => m.spo2Pct,
    lowMsg: 'SpO2 low',
    highMsg: 'SpO2 high',
    lowPriority: 'high',
    highPriority: 'med',
  },
  {
    id: 'hr',
    name: 'HR',
    unit: '/min',
    step: 5,
    min: 20,
    max: 250,
    read: m => m.hrBpm,
    lowMsg: 'Heart rate low',
    highMsg: 'Heart rate high',
    lowPriority: 'high',
    highPriority: 'med',
  },
  {
    id: 'map',
    name: 'MAP',
    unit: 'mmHg',
    step: 5,
    min: 20,
    max: 200,
    read: m => m.mapMmHg,
    lowMsg: 'Mean arterial pressure low',
    highMsg: 'Mean arterial pressure high',
    lowPriority: 'high',
    highPriority: 'med',
  },
];

/** Standard adult limits for unconfigured baseline. */
export function defaultLimits(): Limits {
  return {
    ppeak: { low: 10, high: 40 },
    peep: { low: 3, high: null },
    vte: { low: 250, high: 900 },
    mv: { low: 4, high: 15 },
    ftotal: { low: 8, high: 35 },
    etco2: { low: 25, high: 60 },
    leak: { low: null, high: 40 },
    spo2: { low: 90, high: null },
    hr: { low: 45, high: 130 },
    map: { low: 65, high: 110 },
  };
}

/**
 * Standard clinical ventilator rule for setting default alarm limits relative to active settings
 * when a ventilation mode starts (e.g. Hamilton/Draeger practice):
 * - High pressure: set PEEP + driving pressure + 10 cmH2O (min 35, default 40)
 * - Low pressure / disconnection: set PEEP + 2 cmH2O
 * - Low PEEP: Math.max(0, set PEEP - 3) cmH2O
 * - Tidal volume: set VT * 0.7 low, set VT * 1.4 high (min delta 150 mL)
 * - Minute ventilation: set VE * 0.6 low, set VE * 1.5 high (clamped to realistic ICU range)
 * - Respiratory rate: set RR - 4 low, set RR + 15 high
 */
export function defaultLimitsFor(device: DeviceSettings): Limits {
  const base = defaultLimits();
  if (device.device === 'invasive') {
    const peep = device.peep;
    const pinsp = device.mode === 'PC-AC'
      ? (device.pinspAbovePeep ?? 15)
      : device.mode === 'PSV'
      ? (device.psAbovePeep ?? 10)
      : 15;
    base.ppeak = {
      low: Math.max(5, peep + 2),
      high: Math.max(35, peep + pinsp + 10),
    };
    base.peep = {
      low: Math.max(0, peep - 3),
      high: null,
    };
    if (device.vtSetMl) {
      base.vte = {
        low: Math.max(100, Math.round(device.vtSetMl * 0.7 / 10) * 10),
        high: Math.min(2000, Math.round(device.vtSetMl * 1.4 / 10) * 10),
      };
      if (device.rrSetBpm) {
        const expectedVe = (device.vtSetMl * device.rrSetBpm) / 1000;
        base.mv = {
          low: Math.max(1, Math.round(expectedVe * 0.6 * 2) / 2),
          high: Math.min(30, Math.round(expectedVe * 1.5 * 2) / 2),
        };
      }
    }
    if (device.rrSetBpm) {
      base.ftotal = {
        low: Math.max(4, device.rrSetBpm - 4),
        high: Math.min(60, device.rrSetBpm + 15),
      };
    }
  } else if (device.device === 'niv') {
    const epap = device.epap;
    const ipap = device.mode === 'ST' ? (device.ipap ?? epap + 10) : epap;
    base.ppeak = {
      low: Math.max(5, epap + 2),
      high: Math.max(25, ipap + 10),
    };
    base.peep = {
      low: Math.max(0, epap - 3),
      high: null,
    };
    base.leak = { low: null, high: 40 };
  }
  return base;
}

export const DEFAULT_APNOEA_TIME_SEC = 20;

export function evaluateAlarms(
  m: MonitoredValues,
  arg2: BreathSummary | null | DeviceSettings,
  arg3: DeviceSettings | Limits,
  arg4?: Limits | AlarmState,
  arg5?: AlarmState,
): AlarmState & ActiveAlarm[] {
  let lastBreath: BreathSummary | null = null;
  let device: DeviceSettings;
  let limits: Limits;
  let prevState: AlarmState | undefined;

  if (arg2 && typeof arg2 === 'object' && 'device' in arg2) {
    // Backwards-compatible signature: (m, device, limits, prevState?)
    device = arg2 as DeviceSettings;
    limits = (arg3 ?? defaultLimits()) as Limits;
    prevState = arg4 as AlarmState | undefined;
  } else {
    // Standard Deliverable 1 signature: (m, lastBreath, device, limits, prevState?)
    lastBreath = arg2 as BreathSummary | null;
    device = arg3 as DeviceSettings;
    limits = (arg4 ?? defaultLimits()) as Limits;
    prevState = arg5;
  }

  const vent = device.device === 'invasive' || device.device === 'niv';
  const now = m.simTimeSec;

  // Determine apnoea timing
  let lastBreathSimSec = prevState?.lastBreathSimSec;
  if (lastBreath && lastBreath.endTimeSec > (lastBreathSimSec ?? -1)) {
    lastBreathSimSec = lastBreath.endTimeSec;
  }
  if (lastBreathSimSec === undefined) {
    lastBreathSimSec = now;
  }

  // Active conditions map id -> { priority, message, metric?, side? }
  const currentConditions = new Map<string, { priority: AlarmPriority; message: string; metric?: MetricId; side?: 'low' | 'high' }>();

  // 1. Apnoea (no breath for apnoeaTimeSec, default 20s)
  if (vent) {
    const timeSinceBreath = now - lastBreathSimSec;
    if (m.apnoeaBackupActive || timeSinceBreath >= DEFAULT_APNOEA_TIME_SEC) {
      currentConditions.set(ALARM_IDS.APNOEA, {
        priority: 'high',
        message: m.apnoeaBackupActive ? 'Apnoea backup active' : 'Apnoea',
        metric: 'ftotal',
        side: 'low',
      });
    }
  }

  // 2. High peak airway pressure & pressure limit
  if (vent) {
    const ppeakLim = limits.ppeak;
    const isHigh = m.ppeakCmH2O !== null && ppeakLim.high !== null && m.ppeakCmH2O >= ppeakLim.high;
    const isLimited = Boolean(lastBreath?.pmaxLimited);
    if (isHigh || isLimited) {
      const message = lastBreath?.pmaxLimited ? 'Pressure limited' : 'Pressure high';
      currentConditions.set(ALARM_IDS.PPEAK_HIGH, {
        priority: 'high',
        message,
        metric: 'ppeak',
        side: 'high',
      });
    }
  }

  // 3. Low peak pressure or circuit disconnection
  if (device.device === 'invasive' && m.ppeakCmH2O !== null && Number.isFinite(m.ppeakCmH2O)) {
    const peep = m.peepSetCmH2O ?? (device.peep ?? 5);
    const ppeakLowLim = limits.ppeak.low ?? (peep + 2);
    // Severe circuit disconnect: peak pressure drops near PEEP or tidal volume nearly zero
    const disconnectSign = (m.ppeakCmH2O <= peep + 2) || (m.vteMl !== null && m.vteMl < 50 && m.rrTotalBpm > 0);
    if (m.ppeakCmH2O < ppeakLowLim || disconnectSign) {
      currentConditions.set(ALARM_IDS.DISCONNECT, {
        priority: 'high',
        message: disconnectSign ? 'Disconnection' : 'Pressure low',
        metric: 'ppeak',
        side: 'low',
      });
    }
  }

  // 4. Low PEEP
  if (vent && m.peepSetCmH2O !== null && Number.isFinite(m.peepSetCmH2O)) {
    const peepLim = limits.peep;
    if (peepLim.low !== null && m.peepSetCmH2O < peepLim.low) {
      currentConditions.set(ALARM_IDS.PEEP_LOW, {
        priority: 'high',
        message: 'PEEP low',
        metric: 'peep',
        side: 'low',
      });
    }
  }

  // 5. SpO2 not available
  if (m.spo2Pct === null || !Number.isFinite(m.spo2Pct) || m.spo2Pct <= 0) {
    currentConditions.set(ALARM_IDS.SPO2_UNAVAILABLE, {
      priority: 'low',
      message: 'SpO2 sensor off',
      metric: 'spo2',
      side: 'low',
    });
  }

  // 6. Evaluated limit definitions (VTe, MVe, ftotal, EtCO2, leak, SpO2, HR, MAP)
  for (const def of LIMIT_DEFS) {
    if (def.ventOnly && !vent) continue;
    // Skip ppeak and peep because they are handled with special clinical logic above
    if (def.id === 'ppeak' || def.id === 'peep') continue;
    const v = def.read(m);
    if (v === null || !Number.isFinite(v)) continue;
    const lim = limits[def.id];
    if (!lim) continue;

    if (lim.high !== null && def.highMsg && v > lim.high) {
      currentConditions.set(`${def.id}-high`, {
        priority: def.highPriority ?? 'med',
        message: def.highMsg,
        metric: def.id,
        side: 'high',
      });
    }
    if (lim.low !== null && def.lowMsg && v < lim.low) {
      currentConditions.set(`${def.id}-low`, {
        priority: def.lowPriority ?? 'med',
        message: def.lowMsg,
        metric: def.id,
        side: 'low',
      });
    }
  }

  // Build new active alarms list merging prevState for latching and acknowledgement
  const prevAlarmsMap = new Map<string, ActiveAlarm>();
  if (prevState?.alarms) {
    for (const a of prevState.alarms) {
      prevAlarmsMap.set(a.id, a);
    }
  }

  const resultAlarms: ActiveAlarm[] = [];

  // Handle current conditions
  for (const [id, cond] of currentConditions.entries()) {
    const prev = prevAlarmsMap.get(id);
    if (prev) {
      resultAlarms.push({
        ...prev,
        priority: cond.priority,
        message: cond.message,
        conditionActive: true,
        isLatched: false,
      });
    } else {
      resultAlarms.push({
        id,
        metric: cond.metric,
        side: cond.side,
        priority: cond.priority,
        message: cond.message,
        raisedAtSimSec: now,
        conditionActive: true,
        isLatched: false,
      });
    }
    prevAlarmsMap.delete(id);
  }

  // Handle previous alarms that cleared: high-priority alarms latch until acknowledged
  for (const [id, prev] of prevAlarmsMap.entries()) {
    if (prev.priority === 'high' && !prev.acknowledgedAtSimSec) {
      // Latched until acknowledged
      resultAlarms.push({
        ...prev,
        conditionActive: false,
        isLatched: true,
      });
    }
    // Medium and low priority alarms (and acknowledged high-priority alarms) clear immediately
  }

  // Sort: High priority first, then medium, then low. Within same priority, newest first.
  const priorityOrder: Record<AlarmPriority, number> = { high: 0, med: 1, low: 2 };
  resultAlarms.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.raisedAtSimSec - a.raisedAtSimSec;
  });

  const state: AlarmState = {
    alarms: resultAlarms,
    silencedUntilSimSec: prevState?.silencedUntilSimSec,
    lastBreathSimSec,
  };
  return Object.assign(resultAlarms, state) as unknown as AlarmState & ActiveAlarm[];
}

/**
 * Silences audio alarm for 2 minutes (120 seconds).
 */
export function silenceAlarms(state: AlarmState, simTimeSec: number, durationSec = 120): AlarmState {
  return {
    ...state,
    silencedUntilSimSec: simTimeSec + durationSec,
  };
}

/**
 * Checks if alarm audio is currently silenced.
 */
export function isAlarmSilenced(state: AlarmState | undefined, simTimeSec: number): boolean {
  if (!state?.silencedUntilSimSec) return false;
  return simTimeSec < state.silencedUntilSimSec;
}

/**
 * Acknowledges an alarm.
 * High priority alarms that were latched and condition cleared will be dismissed.
 * If the condition is still active, it is marked as acknowledged but remains visible.
 */
export function acknowledgeAlarm(state: AlarmState, id: string, simTimeSec: number): AlarmState {
  const updatedAlarms: ActiveAlarm[] = [];
  for (const a of state.alarms) {
    if (a.id === id) {
      if (a.conditionActive) {
        // Condition still present: mark acknowledged
        updatedAlarms.push({
          ...a,
          acknowledgedAtSimSec: simTimeSec,
          isLatched: false,
        });
      }
      // If conditionActive is false (was latched), acknowledging clears it from active alarms
    } else {
      updatedAlarms.push(a);
    }
  }

  return {
    ...state,
    alarms: updatedAlarms,
  };
}

/**
 * Acknowledges all currently active or latched alarms.
 */
export function acknowledgeAllAlarms(state: AlarmState, simTimeSec: number): AlarmState {
  const updatedAlarms: ActiveAlarm[] = [];
  for (const a of state.alarms) {
    if (a.conditionActive) {
      updatedAlarms.push({
        ...a,
        acknowledgedAtSimSec: simTimeSec,
        isLatched: false,
      });
    }
  }
  return {
    ...state,
    alarms: updatedAlarms,
  };
}

/**
 * Returns highest active alarm priority for a specific metric.
 */
export function alarmFor(alarms: ActiveAlarm[] | undefined, metric: MetricId): AlarmPriority | undefined {
  if (!alarms || alarms.length === 0) return undefined;
  const hit = alarms.filter(a => a.metric === metric);
  if (hit.length === 0) return undefined;
  if (hit.some(a => a.priority === 'high')) return 'high';
  if (hit.some(a => a.priority === 'med')) return 'med';
  return 'low';
}
