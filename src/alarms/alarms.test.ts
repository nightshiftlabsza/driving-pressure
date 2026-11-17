import { describe, it, expect } from 'vitest';
import {
  evaluateAlarms,
  silenceAlarms,
  isAlarmSilenced,
  acknowledgeAlarm,
  acknowledgeAllAlarms,
  defaultLimits,
  defaultLimitsFor,
  alarmFor,
} from './alarms';
import { ALARM_IDS, type AlarmState } from './types';
import type { MonitoredValues, DeviceSettings, BreathSummary } from '../shared/engineTypes';

function baseMonitored(patch?: Partial<MonitoredValues>): MonitoredValues {
  return {
    simTimeSec: 100,
    ppeakCmH2O: 20,
    pmeanCmH2O: 10,
    peepSetCmH2O: 5,
    vteMl: 450,
    minuteVentLpm: 6.0,
    rrTotalBpm: 12,
    rrSpontBpm: 0,
    fio2: 0.4,
    leakLpm: 0,
    hrBpm: 75,
    sbpMmHg: 120,
    dbpMmHg: 75,
    mapMmHg: 90,
    spo2Pct: 98,
    etco2MmHg: 38,
    temperatureC: 37,
    ...patch,
  };
}

function vcDevice(patch?: Partial<DeviceSettings>): DeviceSettings {
  return {
    device: 'invasive',
    mode: 'VC-AC',
    fio2: 0.4,
    peep: 5,
    rrSetBpm: 12,
    vtSetMl: 450,
    inspFlowLpm: 60,
    ...patch,
  } as DeviceSettings;
}

function nivDevice(patch?: Partial<DeviceSettings>): DeviceSettings {
  return {
    device: 'niv',
    mode: 'ST',
    fio2: 0.4,
    epap: 5,
    ipap: 15,
    backupRrBpm: 12,
    interface: 'oronasal',
    maskFit: 'good',
    ...patch,
  } as DeviceSettings;
}

describe('Alarm Engine Unit Tests (Deliverable 1)', () => {
  it('raises high Ppeak alarm when pressure exceeds high limit', () => {
    const limits = defaultLimits();
    limits.ppeak.high = 35;
    const m = baseMonitored({ ppeakCmH2O: 42 });
    const state = evaluateAlarms(m, null, vcDevice(), limits);
    const alarm = state.alarms.find(a => a.id === ALARM_IDS.PPEAK_HIGH);
    expect(alarm).toBeDefined();
    expect(alarm?.priority).toBe('high');
    expect(alarm?.message).toBe('Pressure high');
  });

  it('sets "Pressure limited" message when pmaxLimited is flagged on last breath', () => {
    const limits = defaultLimits();
    limits.ppeak.high = 35;
    const m = baseMonitored({ ppeakCmH2O: 42 });
    const lastBreath: BreathSummary = {
      endTimeSec: 99,
      breathType: 'mandatory',
      vtiMl: 250,
      vteMl: 240,
      ppeakCmH2O: 40,
      pmeanCmH2O: 15,
      tiSec: 0.5,
      teSec: 2.0,
      endExpFlowLps: 0,
      leakLpm: 0,
      ineffectiveEfforts: 0,
      pmaxLimited: true,
    };
    const state = evaluateAlarms(m, lastBreath, vcDevice(), limits);
    const alarm = state.alarms.find(a => a.id === ALARM_IDS.PPEAK_HIGH);
    expect(alarm).toBeDefined();
    expect(alarm?.message).toBe('Pressure limited');
  });

  it('raises disconnection / low pressure alarm on circuit disconnect', () => {
    const limits = defaultLimits();
    const m = baseMonitored({ ppeakCmH2O: 6, peepSetCmH2O: 5, vteMl: 20 });
    const state = evaluateAlarms(m, null, vcDevice(), limits);
    const alarm = state.alarms.find(a => a.id === ALARM_IDS.DISCONNECT);
    expect(alarm).toBeDefined();
    expect(alarm?.priority).toBe('high');
    expect(alarm?.message).toBe('Disconnection');
  });

  it('raises low PEEP alarm when PEEP falls below limit', () => {
    const limits = defaultLimits();
    limits.peep.low = 4;
    const m = baseMonitored({ peepSetCmH2O: 2 });
    const state = evaluateAlarms(m, null, vcDevice(), limits);
    const alarm = state.alarms.find(a => a.id === ALARM_IDS.PEEP_LOW);
    expect(alarm).toBeDefined();
    expect(alarm?.priority).toBe('high');
    expect(alarm?.message).toBe('PEEP low');
  });

  it('raises high and low VTe alarms', () => {
    const limits = defaultLimits();
    limits.vte = { low: 300, high: 600 };
    // low VTe
    let state = evaluateAlarms(baseMonitored({ vteMl: 200 }), null, vcDevice(), limits);
    expect(state.alarms.some(a => a.id === 'vte-low' && a.priority === 'med')).toBe(true);
    // high VTe
    state = evaluateAlarms(baseMonitored({ vteMl: 700 }), null, vcDevice(), limits);
    expect(state.alarms.some(a => a.id === 'vte-high' && a.priority === 'med')).toBe(true);
  });

  it('raises high and low minute ventilation alarms with correct IEC priorities', () => {
    const limits = defaultLimits();
    limits.mv = { low: 4.0, high: 12.0 };
    // low minute ventilation is high priority (IEC 60601-1-8 life safety)
    let state = evaluateAlarms(baseMonitored({ minuteVentLpm: 2.5 }), null, vcDevice(), limits);
    const lowMv = state.alarms.find(a => a.id === 'mv-low');
    expect(lowMv).toBeDefined();
    expect(lowMv?.priority).toBe('high');

    // high minute ventilation is medium priority
    state = evaluateAlarms(baseMonitored({ minuteVentLpm: 15.0 }), null, vcDevice(), limits);
    const highMv = state.alarms.find(a => a.id === 'mv-high');
    expect(highMv).toBeDefined();
    expect(highMv?.priority).toBe('med');
  });

  it('raises high RR alarm', () => {
    const limits = defaultLimits();
    limits.ftotal.high = 25;
    const state = evaluateAlarms(baseMonitored({ rrTotalBpm: 32 }), null, vcDevice(), limits);
    expect(state.alarms.some(a => a.id === 'ftotal-high' && a.priority === 'med')).toBe(true);
  });

  it('raises apnoea alarm after default 20 s without breath', () => {
    const limits = defaultLimits();
    const lastBreath: BreathSummary = {
      endTimeSec: 10,
      breathType: 'spontaneous',
      vtiMl: 400,
      vteMl: 400,
      ppeakCmH2O: 15,
      pmeanCmH2O: 7,
      tiSec: 0.8,
      teSec: 2.0,
      endExpFlowLps: 0,
      leakLpm: 0,
      ineffectiveEfforts: 0,
    };
    // At sim time 25s (15s elapsed): no apnoea yet
    let s = evaluateAlarms(baseMonitored({ simTimeSec: 25, rrTotalBpm: 0 }), lastBreath, vcDevice(), limits);
    expect(s.alarms.some(a => a.id === ALARM_IDS.APNOEA)).toBe(false);

    // At sim time 32s (22s elapsed): apnoea triggered
    s = evaluateAlarms(baseMonitored({ simTimeSec: 32, rrTotalBpm: 0 }), null, vcDevice(), limits, s);
    const apnoea = s.alarms.find(a => a.id === ALARM_IDS.APNOEA);
    expect(apnoea).toBeDefined();
    expect(apnoea?.priority).toBe('high');
    expect(apnoea?.message).toBe('Apnoea');
  });

  it('raises low SpO2 alarm and SpO2 sensor off (low priority) when missing', () => {
    const limits = defaultLimits();
    limits.spo2.low = 92;
    let s = evaluateAlarms(baseMonitored({ spo2Pct: 88 }), null, vcDevice(), limits);
    expect(s.alarms.some(a => a.id === ALARM_IDS.SPO2_LOW && a.priority === 'high')).toBe(true);

    s = evaluateAlarms(baseMonitored({ spo2Pct: 0 }), null, vcDevice(), limits);
    expect(s.alarms.some(a => a.id === ALARM_IDS.SPO2_UNAVAILABLE && a.priority === 'low')).toBe(true);
  });

  it('raises high leak alarm on NIV', () => {
    const limits = defaultLimits();
    limits.leak.high = 50;
    const s = evaluateAlarms(baseMonitored({ leakLpm: 68 }), null, nivDevice(), limits);
    expect(s.alarms.some(a => a.id === ALARM_IDS.LEAK_HIGH && a.priority === 'med')).toBe(true);
  });

  it('latches high-priority alarms until acknowledged after condition clears', () => {
    const limits = defaultLimits();
    limits.ppeak.high = 35;
    // Step 1: condition active
    let s: AlarmState = evaluateAlarms(baseMonitored({ simTimeSec: 10, ppeakCmH2O: 45 }), null, vcDevice(), limits);
    expect(s.alarms.some(a => a.id === ALARM_IDS.PPEAK_HIGH && a.conditionActive)).toBe(true);

    // Step 2: condition clears at simTime 15
    s = evaluateAlarms(baseMonitored({ simTimeSec: 15, ppeakCmH2O: 22 }), null, vcDevice(), limits, s);
    const latched = s.alarms.find(a => a.id === ALARM_IDS.PPEAK_HIGH);
    expect(latched).toBeDefined();
    expect(latched?.isLatched).toBe(true);
    expect(latched?.conditionActive).toBe(false);

    // Step 3: acknowledge clears the latched alarm
    s = acknowledgeAlarm(s, ALARM_IDS.PPEAK_HIGH, 16);
    expect(s.alarms.some(a => a.id === ALARM_IDS.PPEAK_HIGH)).toBe(false);
  });

  it('clears medium and low priority alarms immediately when condition clears', () => {
    const limits = defaultLimits();
    limits.vte.high = 600;
    let s = evaluateAlarms(baseMonitored({ simTimeSec: 10, vteMl: 700 }), null, vcDevice(), limits);
    expect(s.alarms.some(a => a.id === 'vte-high')).toBe(true);

    // condition clears
    s = evaluateAlarms(baseMonitored({ simTimeSec: 12, vteMl: 450 }), null, vcDevice(), limits, s);
    expect(s.alarms.some(a => a.id === 'vte-high')).toBe(false);
  });

  it('handles two-minute silence and silence expiry', () => {
    let s: AlarmState = { alarms: [] };
    s = silenceAlarms(s, 100, 120);
    expect(isAlarmSilenced(s, 150)).toBe(true);
    expect(isAlarmSilenced(s, 220)).toBe(false);
  });

  it('derives setting-relative default limits for new modes', () => {
    const dev = vcDevice({ peep: 8, vtSetMl: 500, rrSetBpm: 15 });
    const lim = defaultLimitsFor(dev);
    expect(lim.ppeak.high).toBeGreaterThanOrEqual(35);
    expect(lim.ppeak.low).toBe(10);
    expect(lim.peep.low).toBe(5);
    expect(lim.vte.low).toBe(350); // 500 * 0.7
    expect(lim.vte.high).toBe(700); // 500 * 1.4
  });

  it('returns highest priority for a given metric via alarmFor', () => {
    const alarms = [
      { id: 'vte-high', metric: 'vte' as const, priority: 'med' as const, message: 'VT high', raisedAtSimSec: 1, conditionActive: true },
      { id: 'ppeak-high', metric: 'ppeak' as const, priority: 'high' as const, message: 'Ppeak high', raisedAtSimSec: 1, conditionActive: true },
    ];
    expect(alarmFor(alarms, 'ppeak')).toBe('high');
    expect(alarmFor(alarms, 'vte')).toBe('med');
    expect(alarmFor(alarms, 'hr')).toBeUndefined();
  });
});
