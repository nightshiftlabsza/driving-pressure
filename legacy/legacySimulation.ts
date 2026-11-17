// LEGACY PHYSIOLOGY MATHS - NOT USED BY ICU OR HFNC MODES
// Preserved exclusively for Anaesthesia mode. ICU and HFNC modes use src/engine.

import { VentilationMode, AllParameters } from '../types';
import { GAS_CONFIG } from '../constants';

export interface LegacySimOptions {
  activeMode: VentilationMode;
  operatingMode: string | null;
  icuSubMode: string | null;
  isMechanicalVentilation: boolean;
  activeManeuver: string | null;
  maneuverStartTime: number | null;
  heldVolumeInspired: number;
  heldInspManeuverParams: any;
  heldExpManeuverParams: any;
  capturedPpeakForResistance: number | null;
  capturedAvgInspFlowLPS: number | null;
  selectedAnestheticGases: any[];
  patientWeight?: number | null;
  isO2FlushActive: boolean;
  valueNotAvailable: string;
}

export function calculateLegacySimulation(
  params: AllParameters,
  options: LegacySimOptions
): Partial<AllParameters> {
  const {
    activeMode,
    operatingMode,
    icuSubMode,
    isMechanicalVentilation,
    activeManeuver,
    selectedAnestheticGases,
    patientWeight,
    isO2FlushActive,
    valueNotAvailable,
  } = options;

  const newMonitoredParams: Partial<AllParameters> = {};

  const patientCompliance = Number(params.compliance) || 50;
  const patientResistance = Number(params.resistance) || 10;

  const ratio = String(params.ratio || '1:2').split(':').map(Number);
  const iPart = ratio[0] || 1;
  const ePart = ratio[1] || 2;
  const inspiratoryFraction = iPart / (iPart + ePart || 3);
  newMonitoredParams.tiTtot = parseFloat(inspiratoryFraction.toFixed(2));

  const freqForMV = Number(params.measuredFrequency);
  const breathPeriodMs = freqForMV > 0 ? (60 / freqForMV) * 1000 : 5000;
  const inspPausePercent =
    activeMode === VentilationMode.VC ||
    (activeMode === VentilationMode.SIMV && Number(params.psLevel) === 0)
      ? Number(params.inspiratoryPausePercent) || 0
      : 0;
  const Ti = breathPeriodMs * inspiratoryFraction;
  const Tip = Ti * (inspPausePercent / 100);
  const Tif = Ti - Tip;

  if (
    activeMode === VentilationMode.VC ||
    (activeMode === VentilationMode.SIMV && Number(params.psLevel) === 0)
  ) {
    const V_target = Number(params.volume);
    const Pplat_calc = Number(params.peep) + V_target / patientCompliance;
    const peakInspFlowLPS = Tif > 0 ? V_target / 1000 / (Tif / 1000) : 0;
    const Ppeak_calc = Pplat_calc + peakInspFlowLPS * patientResistance;
    newMonitoredParams.pPeak = Math.max(
      Number(params.peep),
      parseFloat(Ppeak_calc.toFixed(1))
    );
    newMonitoredParams.pPlateau =
      inspPausePercent > 0
        ? Math.max(Number(params.peep), parseFloat(Pplat_calc.toFixed(1)))
        : (valueNotAvailable as any);
  } else if (
    activeMode === VentilationMode.PC ||
    activeMode === VentilationMode.PS ||
    (activeMode === VentilationMode.SIMV && Number(params.psLevel) > 0)
  ) {
    const drivingPressure =
      activeMode === VentilationMode.PC ||
      (activeMode === VentilationMode.SIMV && Number(params.psLevel) === 0)
        ? Number(params.pressureTarget)
        : Number(params.psLevel);
    const Ppeak_calc = Number(params.peep) + drivingPressure;
    newMonitoredParams.pPeak = parseFloat(Ppeak_calc.toFixed(1));
    if (
      activeMode === VentilationMode.PC ||
      (activeMode === VentilationMode.SIMV && Number(params.psLevel) === 0)
    ) {
      newMonitoredParams.pPlateau = newMonitoredParams.pPeak;
    } else {
      newMonitoredParams.pPlateau = valueNotAvailable as any;
    }
  } else if (activeMode === VentilationMode.CPAP) {
    newMonitoredParams.pPeak = Number(params.peep) + Math.random() * 2;
    newMonitoredParams.pPlateau = Number(params.peep);
  }

  newMonitoredParams.pMean = Math.max(
    Number(params.peep),
    parseFloat(
      (
        (Number(newMonitoredParams.pPeak) + Number(params.peep)) / 2.2 +
        (Math.random() * 1 - 0.5)
      ).toFixed(1)
    )
  );

  let VTi_delivered = 0;
  if (
    activeMode === VentilationMode.VC ||
    (activeMode === VentilationMode.SIMV &&
      Number(params.volume) > 0 &&
      Number(params.psLevel) === 0)
  ) {
    VTi_delivered = Number(params.volume);
  } else if (
    activeMode === VentilationMode.PC ||
    activeMode === VentilationMode.PS ||
    (activeMode === VentilationMode.SIMV &&
      ((Number(params.pressureTarget) > 0 && Number(params.psLevel) === 0) ||
        Number(params.psLevel) > 0))
  ) {
    const drivingPressure =
      activeMode === VentilationMode.PC ||
      (activeMode === VentilationMode.SIMV &&
        Number(params.pressureTarget) > 0 &&
        Number(params.psLevel) === 0)
        ? Number(params.pressureTarget)
        : Number(params.psLevel);
    VTi_delivered = drivingPressure * patientCompliance * 0.9;
  } else if (activeMode === VentilationMode.CPAP && freqForMV > 0) {
    VTi_delivered = (5 + Math.random() * 5) * patientCompliance * 0.5;
  }

  newMonitoredParams.volumeInspired = Math.round(VTi_delivered);

  const isNivOrLeakyMode =
    operatingMode === 'icu' &&
    icuSubMode === 'non-invasive' &&
    activeMode !== VentilationMode.CPAP &&
    activeMode !== VentilationMode.HIGH_FLOW;
  const currentSimulatedLeakFraction = isNivOrLeakyMode
    ? Math.random() * 0.2 + 0.05
    : 0;

  if (VTi_delivered > 0) {
    newMonitoredParams.volumeExpired = Math.max(
      0,
      Math.round(VTi_delivered * (1 - currentSimulatedLeakFraction))
    );
    newMonitoredParams.leakPercentage = parseFloat(
      (currentSimulatedLeakFraction * 100).toFixed(1)
    );
  } else {
    newMonitoredParams.volumeExpired = Math.round(Math.random() * 50);
    newMonitoredParams.leakPercentage = 0;
  }

  if (
    icuSubMode === 'high-flow' ||
    (activeMode === VentilationMode.CPAP && VTi_delivered === 0)
  ) {
    newMonitoredParams.volumeExpired = 0;
    newMonitoredParams.leakPercentage = 0;
  }

  if (activeMode !== VentilationMode.HIGH_FLOW) {
    if (freqForMV > 0 && Number(newMonitoredParams.volumeExpired) > 0) {
      newMonitoredParams.volumeMinute = parseFloat(
        (
          (freqForMV * Number(newMonitoredParams.volumeExpired)) /
          1000
        ).toFixed(1)
      );
    } else {
      newMonitoredParams.volumeMinute = 0;
    }
  } else {
    newMonitoredParams.volumeMinute = 0;
  }

  if (
    patientWeight &&
    patientWeight > 0 &&
    Number(newMonitoredParams.volumeExpired) > 0
  ) {
    newMonitoredParams.mlPerKg = parseFloat(
      (Number(newMonitoredParams.volumeExpired) / patientWeight).toFixed(1)
    );
  } else {
    newMonitoredParams.mlPerKg = patientWeight ? 0 : ('--' as any);
  }

  if (operatingMode !== 'anesthesia') {
    newMonitoredParams.etco2 = Number(params.etco2) > 0 ? params.etco2 : 35;
    newMonitoredParams.spo2 = Number(params.spo2) > 0 ? params.spo2 : 98;
  } else {
    const etco2Change = (38 - Number(params.etco2)) * 0.1 + (Math.random() * 2 - 1);
    newMonitoredParams.etco2 = Math.min(
      60,
      Math.max(20, Number(params.etco2) + etco2Change)
    );
    let spo2Change = (98 - Number(params.spo2)) * 0.1 + (Math.random() * 0.8 - 0.4);
    const totalAchievedMac =
      (Number(params.etAgentConcentration) /
        GAS_CONFIG[selectedAnestheticGases[0]]?.mac || 0) +
      ((selectedAnestheticGases[1] &&
        Number(params.etSecondaryAgentConcentration) /
          GAS_CONFIG[selectedAnestheticGases[1]]?.mac) ||
        0);
    if (totalAchievedMac > 1.5) spo2Change -= 0.2;
    newMonitoredParams.spo2 = Math.min(
      100,
      Math.max(85, Number(params.spo2) + spo2Change)
    );
    newMonitoredParams.etco2 = parseFloat(
      Number(newMonitoredParams.etco2).toFixed(0)
    );
    newMonitoredParams.spo2 = parseFloat(
      Number(newMonitoredParams.spo2).toFixed(0)
    );
  }

  if (isO2FlushActive) {
    newMonitoredParams.fio2 = 100;
  }

  return newMonitoredParams;
}
