import { describe, it, expect } from 'vitest';
import { engine, lastTrace, truth } from '../../src/engine/index';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';

// Normal healthy resting adult (Guyton & Hall 14th ed, Ch. 31)
const normalPatient: PatientParams = {
  sex: 'M',
  ageYears: 35,
  heightCm: 175,
  actualWeightKg: 70,
  complianceMlPerCmH2O: 60,
  inspResistanceCmH2OPerLps: 5,
  expResistanceCmH2OPerLps: 5,
  spontRateBpm: 14,
  pmusAmplitudeCmH2O: 10.0,
  pmusInspTimeSec: 1.0,
  vco2MlPerMin: 200,
  vo2MlPerMin: 250,
  anatomicDeadSpaceMl: 150,
  alveolarDeadSpaceFraction: 0.05,
  shuntFraction: 0.05,
  recruitability: 0.1,
  hbGPerDl: 14,
  temperatureC: 37,
  baselineHco3MmolL: 24,
  hrBaselineBpm: 72,
  sbpBaselineMmHg: 120,
  dbpBaselineMmHg: 80,
  ppvResponse: 'unhelpful',
  ppvSeverity: 0.1,
  respiratoryReserve: 1.0,
};

const roomAir: DeviceSettings = {
  device: 'none',
  o2: 'room-air',
  o2FlowLpm: 0,
};

describe('Respiratory chemoreflex drive and setpoint (Part B)', () => {
  it('normal patient on room air: drive is 1.0 ± 0.05 at steady state', () => {
    let s = engine.createState(normalPatient, roomAir, { paco2MmHg: 40, hco3MmolL: 24 });
    s = engine.fastForward(s, 1200); // 20 min
    const trace = lastTrace(s);
    expect(trace).not.toBeNull();
    expect(trace!.drive).toBeGreaterThanOrEqual(0.95);
    expect(trace!.drive).toBeLessThanOrEqual(1.05);
  });

  it('metabolic acidosis (measured HCO3 12) raises minute ventilation within 10 minutes', () => {
    const s0 = engine.createState(normalPatient, roomAir, { paco2MmHg: 40, hco3MmolL: 24 });
    const s0Run = engine.fastForward(s0, 60);
    const baselineVA = truth(s0Run).alveolarVentLpm ?? 4.5;

    let sAcid = engine.createState(normalPatient, roomAir, { paco2MmHg: 40, hco3MmolL: 12 });
    sAcid = engine.fastForward(sAcid, 600); // 10 min
    const trace = lastTrace(sAcid);
    const acidVA = truth(sAcid).alveolarVentLpm;

    expect(trace!.drive).toBeGreaterThanOrEqual(1.25);
    expect(acidVA).not.toBeNull();
    expect(acidVA!).toBeGreaterThan(baselineVA * 1.25);
    expect(sAcid.phys.paco2MmHg).toBeLessThan(35);
  });

  it('chronic retainer with chronicPaco2MmHg 55 settles near PaCO2 55 (±5) on room air', () => {
    const retainer: PatientParams = {
      sex: 'M',
      ageYears: 68,
      heightCm: 172,
      actualWeightKg: 70,
      complianceMlPerCmH2O: 50,
      inspResistanceCmH2OPerLps: 8,
      expResistanceCmH2OPerLps: 10,
      spontRateBpm: 16,
      pmusAmplitudeCmH2O: 11.5,
      pmusInspTimeSec: 0.9,
      vco2MlPerMin: 200,
      vo2MlPerMin: 250,
      anatomicDeadSpaceMl: 130,
      alveolarDeadSpaceFraction: 0.20,
      shuntFraction: 0.10,
      recruitability: 0.1,
      hbGPerDl: 15,
      temperatureC: 37,
      baselineHco3MmolL: 30,
      chronicPaco2MmHg: 55,
      hrBaselineBpm: 80,
      sbpBaselineMmHg: 130,
      dbpBaselineMmHg: 80,
      ppvResponse: 'unhelpful',
      ppvSeverity: 0.2,
      respiratoryReserve: 0.8,
    };

    let s = engine.createState(retainer, roomAir, { paco2MmHg: 55, hco3MmolL: 30 });
    s = engine.fastForward(s, 1800); // 30 min
    const finalPaco2 = s.phys.paco2MmHg;
    expect(finalPaco2).toBeGreaterThanOrEqual(50);
    expect(finalPaco2).toBeLessThanOrEqual(60);
  });

  it('patient starting acidotic who is ventilated to PaCO2 40 does not become underdriven (drive >= 0.8)', () => {
    const psv: DeviceSettings = {
      device: 'invasive',
      mode: 'PSV',
      peep: 5,
      psAbovePeep: 10,
      rrSetBpm: 0,
      fio2: 0.35,
    };
    // Patient starts with acute respiratory acidosis (pH ~ 7.20, PaCO2 70)
    let s = engine.createState(normalPatient, psv, { paco2MmHg: 70, hco3MmolL: 26.5 });
    // Ventilated to normal PaCO2 40 over 15 min
    s = engine.fastForward(s, 900);
    const trace = lastTrace(s);
    expect(trace).not.toBeNull();
    expect(trace!.drive).toBeGreaterThanOrEqual(0.8);
  });

  it('VC-AC spontaneous effort unloading: set flow 80 unloads, set flow 30 gives flow starvation', () => {
    const triggeringPatient: PatientParams = {
      sex: 'M',
      ageYears: 50,
      heightCm: 175,
      actualWeightKg: 75,
      complianceMlPerCmH2O: 50,
      inspResistanceCmH2OPerLps: 8,
      expResistanceCmH2OPerLps: 8,
      spontRateBpm: 24,
      pmusAmplitudeCmH2O: 16.0,
      pmusInspTimeSec: 0.8,
      vco2MlPerMin: 220,
      vo2MlPerMin: 260,
      anatomicDeadSpaceMl: 150,
      alveolarDeadSpaceFraction: 0.1,
      shuntFraction: 0.05,
      recruitability: 0.1,
      hbGPerDl: 14,
      temperatureC: 37,
      baselineHco3MmolL: 24,
      hrBaselineBpm: 90,
      sbpBaselineMmHg: 125,
      dbpBaselineMmHg: 80,
      ppvResponse: 'unhelpful',
      ppvSeverity: 0.1,
      respiratoryReserve: 0.4,
    };

    const cpap: DeviceSettings = {
      device: 'invasive',
      mode: 'CPAP',
      peep: 5,
      fio2: 0.4,
      rrSetBpm: 0,
      psAbovePeep: 0,
    };
    const vcHighFlow: DeviceSettings = {
      device: 'invasive',
      mode: 'VC-AC',
      peep: 5,
      fio2: 0.4,
      rrSetBpm: 0,
      vtSetMl: 450,
      inspFlowLpm: 80,
      flowPattern: 'square',
    };
    const vcLowFlow: DeviceSettings = {
      device: 'invasive',
      mode: 'VC-AC',
      peep: 5,
      fio2: 0.4,
      rrSetBpm: 0,
      vtSetMl: 450,
      inspFlowLpm: 30,
      flowPattern: 'square',
    };

    const sCpap = engine.fastForward(engine.createState(triggeringPatient, cpap, { paco2MmHg: 40, fatigue: 0.2 }), 120);
    const sVcHigh = engine.fastForward(engine.createState(triggeringPatient, vcHighFlow, { paco2MmHg: 40, fatigue: 0.2 }), 120);
    const sVcLow = engine.fastForward(engine.createState(triggeringPatient, vcLowFlow, { paco2MmHg: 40, fatigue: 0.1 }), 600);
    const sCpapLow = engine.fastForward(engine.createState(triggeringPatient, cpap, { paco2MmHg: 40, fatigue: 0.1 }), 600);

    // High flow unloads -> lower fatigue than CPAP
    expect(sVcHigh.phys.fatigue).toBeLessThan(sCpap.phys.fatigue);
    // Low flow (30 L/min) -> flow starvation -> fatigue no lower than CPAP
    expect(sVcLow.phys.fatigue).toBeGreaterThanOrEqual(sCpapLow.phys.fatigue);
  });
});
