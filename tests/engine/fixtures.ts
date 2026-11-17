import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';

export const passive: PatientParams = {
  sex: 'M', ageYears: 50, heightCm: 175, actualWeightKg: 75,
  complianceMlPerCmH2O: 50, inspResistanceCmH2OPerLps: 10, expResistanceCmH2OPerLps: 10,
  spontRateBpm: 0, pmusAmplitudeCmH2O: 0, pmusInspTimeSec: 1,
  vco2MlPerMin: 200, vo2MlPerMin: 250, anatomicDeadSpaceMl: 150, alveolarDeadSpaceFraction: 0.1,
  shuntFraction: 0.05, recruitability: 0.3, hbGPerDl: 14, temperatureC: 37, baselineHco3MmolL: 24,
  hrBaselineBpm: 80, sbpBaselineMmHg: 120, dbpBaselineMmHg: 70, ppvResponse: 'unhelpful', ppvSeverity: 0.3,
  respiratoryReserve: 1,
};
export const vc = (o: Partial<Extract<DeviceSettings, { device: 'invasive' }>> = {}): DeviceSettings =>
  ({ device: 'invasive', mode: 'VC-AC', fio2: 0.4, peep: 5, rrSetBpm: 16, vtSetMl: 500, inspFlowLpm: 60, flowPattern: 'square', ...o });

