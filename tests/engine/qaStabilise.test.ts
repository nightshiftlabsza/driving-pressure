/** Regression tests for the 2026-11-09 QA bug hunt (docs/qa). Each name carries the QA finding ID. */
import { describe, it, expect } from 'vitest';
import { engine } from '../../src/engine/index';
import { passive, vc } from './fixtures';
import asthma from '../../src/cases/library/asthma-vent-01.json';

describe('QA1-002 / QA6-001 input validation', () => {
  it('rejects NaN, negative and out-of-range device settings', () => {
    expect(() => engine.createState(passive, vc({ peep: NaN }))).toThrow(/PEEP/);
    expect(() => engine.createState(passive, vc({ peep: -5 }))).toThrow(/PEEP/);
    expect(() => engine.createState(passive, vc({ vtSetMl: 100000 }))).toThrow(/VT/);
  });
  it('rejects zero or non-finite patient parameters instead of producing Infinity or NaN', () => {
    expect(() => engine.createState({ ...passive, complianceMlPerCmH2O: 0 }, vc({}))).toThrow(/compliance/i);
    expect(() => engine.createState({ ...passive, hbGPerDl: 0 }, vc({}))).toThrow(/hb/i);
    const s = engine.createState(passive, vc({}));
    expect(() => engine.setPatient(s, { complianceMlPerCmH2O: NaN })).toThrow();
  });
});

describe('QA2-003 impossible timing', () => {
  it('rejects a PC-AC inspiratory time that leaves no time to exhale', () => {
    expect(() => engine.createState(passive, { device: 'invasive', mode: 'PC-AC', fio2: 0.5, peep: 5, rrSetBpm: 30, pinspAbovePeep: 15, tiSec: 5 })).toThrow(/exhale/);
  });
  it('rejects VC settings whose flow and volume imply the same', () => {
    expect(() => engine.createState(passive, vc({ vtSetMl: 1000, inspFlowLpm: 10, rrSetBpm: 40 }))).toThrow(/exhale/);
  });
});

describe('QA1-003 / QA2-004 / QA4-002 stale monitors', () => {
  it('clears per-breath readings when breathing stops', () => {
    let s = engine.createState(passive, vc({ rrSetBpm: 12 }));
    s = engine.fastForward(s, 60);
    expect(s.monitored.vteMl).toBeGreaterThan(0);
    s = engine.setDevice(s, vc({ rrSetBpm: 0 }));
    s = engine.fastForward(s, 60);
    expect(s.monitored.vteMl).toBeNull();
    expect(s.monitored.ppeakCmH2O).toBeNull();
    expect(s.monitored.minuteVentLpm).toBe(0);
    expect(s.monitored.etco2MmHg).toBe(0);
  });
  it('clears ventilator readings when the circuit is removed', () => {
    let s = engine.createState(passive, vc({}));
    s = engine.fastForward(s, 60);
    s = engine.setDevice(s, { device: 'none', o2: 'room-air', o2FlowLpm: 0 });
    s = engine.fastForward(s, 5);
    expect(s.monitored.vteMl).toBeNull();
    expect(s.monitored.ppeakCmH2O).toBeNull();
  });
});

describe('QA2-006 circulation follows the present intrathoracic pressure', () => {
  it('a preload-dependent patient recovers blood pressure when taken off the ventilator', () => {
    const c: any = asthma;
    let s = engine.createState(c.patient.params, c.initialDevice, c.initialPhys);
    s = engine.fastForward(s, 120);
    const onVent = s.monitored.sbpMmHg;
    s = engine.setDevice(s, { device: 'none', o2: 'non-rebreather', o2FlowLpm: 15 });
    s = engine.fastForward(s, 300);
    expect(s.monitored.sbpMmHg).toBeGreaterThan(onVent);
  });
});
