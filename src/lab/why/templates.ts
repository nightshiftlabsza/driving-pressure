import type {
  DeviceSettings,
  EngineState,
  MonitoredValues,
  PatientParams,
  BreathSummary,
} from '../../shared/engineTypes';
import { lastTrace, truth, type Truth, type EngineTrace } from '../../engine';
import { type WhyTraceField, WHY_TRACE_FIELDS } from '../schema';

export type Direction = 'up' | 'down' | 'same';

export interface WhySnapshot {
  simTimeSec: number;
  deviceKind: DeviceSettings['device'];
  patient: PatientParams;
  device: DeviceSettings;
  trace: EngineTrace | null;
  truth: Truth;
  monitored: MonitoredValues;
  lastBreath: BreathSummary | null;
  values: Record<WhyTraceField, number | string | null>;
  compliance: number | string | null;
  expResistance: number | string | null;
  timeConstant: number | string | null;
  setPeep: number | string | null;
  setRr: number | string | null;
  setVt: number | string | null;
  setInspFlow: number | string | null;
  setTi: number | string | null;
  setPs: number | string | null;
  setTriggerFlow: number | string | null;
  setFio2: number | string | null;
  setHfncFlow: number | string | null;
  tiSec: number | string | null;
  teSec: number | string | null;
  endExpFlow: number | string | null;
  trappedVolume: number | string | null;
  autoPeep: number | string | null;
  ineffectiveEfforts: number | string | null;
  vte: number | string | null;
  ppeak: number | string | null;
  pplat: number | string | null;
  drivingPressure: number | string | null;
  pmean: number | string | null;
  minuteVent: number | string | null;
  deadSpaceFraction: number | string | null;
  alveolarVentilation: number | string | null;
  steadyPaco2Target: number | string | null;
  paco2Change: number | string | null;
  paco2: number | string | null;
  ph: number | string | null;
  recruitedFraction: number | string | null;
  shuntUsed: number | string | null;
  fio2Effective: number | string | null;
  pao2Alveolar: number | string | null;
  pao2: number | string | null;
  spo2: number | string | null;
  drive: number | string | null;
  unloading: number | string | null;
  ptp: number | string | null;
  fatigueChange: number | string | null;
  circulationMultiplier: number | string | null;
  map: number | string | null;
  sbp: number | string | null;
  hr: number | string | null;
  hfncPressure: number | string | null;
}

export interface CausalNode {
  field: WhyTraceField;
  label: string;
  unit: string;
  beforeValue: number | string | null;
  afterValue: number | string | null;
  formattedBefore: string;
  formattedAfter: string;
  direction: Direction;
  ruleBased: boolean;
  templateText: string;
}

export const WHY_FIELD_METADATA: Record<
  WhyTraceField,
  { label: string; unit: string }
> = {
  compliance: { label: 'Static compliance', unit: 'mL/cmH2O' },
  expResistance: { label: 'Expiratory resistance', unit: 'cmH2O/(L/s)' },
  timeConstant: { label: 'Expiratory time constant (RC)', unit: 's' },
  setPeep: { label: 'Set PEEP / EPAP', unit: 'cmH2O' },
  setRr: { label: 'Set respiratory rate', unit: 'bpm' },
  setVt: { label: 'Set tidal volume', unit: 'mL' },
  setInspFlow: { label: 'Set inspiratory flow', unit: 'L/min' },
  setTi: { label: 'Set inspiratory time', unit: 's' },
  setPs: { label: 'Pressure support', unit: 'cmH2O' },
  setTriggerFlow: { label: 'Trigger sensitivity', unit: 'L/min' },
  setFio2: { label: 'Set FiO2', unit: '' },
  setHfncFlow: { label: 'HFNC flow rate', unit: 'L/min' },
  tiSec: { label: 'Inspiratory time (Ti)', unit: 's' },
  teSec: { label: 'Expiratory time (Te)', unit: 's' },
  endExpFlow: { label: 'End-expiratory flow', unit: 'L/s' },
  trappedVolume: { label: 'Trapped gas volume', unit: 'mL' },
  autoPeep: { label: 'Intrinsic PEEP (auto-PEEP)', unit: 'cmH2O' },
  ineffectiveEfforts: { label: 'Ineffective efforts', unit: 'efforts/breath' },
  vte: { label: 'Expiratory tidal volume (Vte)', unit: 'mL' },
  ppeak: { label: 'Peak airway pressure (Ppeak)', unit: 'cmH2O' },
  pplat: { label: 'Plateau pressure (Pplat)', unit: 'cmH2O' },
  drivingPressure: { label: 'Driving pressure (ΔP)', unit: 'cmH2O' },
  pmean: { label: 'Mean airway pressure (Pmean)', unit: 'cmH2O' },
  minuteVent: { label: 'Minute ventilation (VE)', unit: 'L/min' },
  deadSpaceFraction: { label: 'Alveolar dead space fraction (VD/VT)', unit: '' },
  alveolarVentilation: { label: 'Alveolar ventilation (VA)', unit: 'L/min' },
  steadyPaco2Target: { label: 'Steady-state PaCO2 target', unit: 'mmHg' },
  paco2Change: { label: 'PaCO2 rate of change', unit: 'mmHg/s' },
  paco2: { label: 'Arterial PaCO2', unit: 'mmHg' },
  ph: { label: 'Arterial pH', unit: '' },
  recruitedFraction: { label: 'Recruited lung fraction', unit: '' },
  shuntUsed: { label: 'Effective shunt fraction (Qs/Qt)', unit: '' },
  fio2Effective: { label: 'Effective delivered FiO2', unit: '' },
  pao2Alveolar: { label: 'Alveolar oxygen tension (PAO2)', unit: 'mmHg' },
  pao2: { label: 'Arterial oxygen tension (PaO2)', unit: 'mmHg' },
  spo2: { label: 'Oxygen saturation (SpO2)', unit: '%' },
  drive: { label: 'Chemoreflex respiratory drive', unit: '×' },
  unloading: { label: 'Patient effort unloading factor', unit: '' },
  ptp: { label: 'Pressure-time product (PTP)', unit: 'cmH2O·s' },
  fatigueChange: { label: 'Diaphragmatic fatigue rate', unit: '/min' },
  circulationMultiplier: { label: 'Circulation multiplier', unit: '×' },
  map: { label: 'Mean arterial pressure (MAP)', unit: 'mmHg' },
  sbp: { label: 'Systolic blood pressure (SBP)', unit: 'mmHg' },
  hr: { label: 'Heart rate (HR)', unit: 'bpm' },
  hfncPressure: { label: 'HFNC pharyngeal PEEP', unit: 'cmH2O' },
};

/** Noise bands for evaluating directional change in trace / physiological values. */
export const WHY_FIELD_NOISE_BANDS: Partial<Record<WhyTraceField, number>> = {
  ph: 0.015,
  paco2: 0.5,
  pao2: 1.0,
  spo2: 0.5,
  compliance: 0.5,
  expResistance: 0.1,
  timeConstant: 0.02,
  setPeep: 0.1,
  setRr: 0.5,
  setVt: 5,
  setInspFlow: 1,
  setTi: 0.02,
  setPs: 0.5,
  setTriggerFlow: 0.1,
  setFio2: 0.005,
  setHfncFlow: 1,
  tiSec: 0.02,
  teSec: 0.02,
  endExpFlow: 0.02,
  trappedVolume: 2,
  autoPeep: 0.2,
  ineffectiveEfforts: 0.1,
  vte: 5,
  ppeak: 0.5,
  pplat: 0.5,
  drivingPressure: 0.5,
  pmean: 0.3,
  minuteVent: 0.1,
  deadSpaceFraction: 0.005,
  alveolarVentilation: 0.05,
  steadyPaco2Target: 0.5,
  paco2Change: 0.005,
  recruitedFraction: 0.005,
  shuntUsed: 0.005,
  fio2Effective: 0.005,
  pao2Alveolar: 1.0,
  drive: 0.02,
  unloading: 0.01,
  ptp: 0.1,
  fatigueChange: 0.0005,
  circulationMultiplier: 0.005,
  map: 1.0,
  sbp: 1.0,
  hr: 1.0,
  hfncPressure: 0.1,
};

export function formatTraceValue(field: WhyTraceField, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (Number.isNaN(value)) return '—';

  switch (field) {
    case 'ph':
      return value.toFixed(2);
    case 'compliance':
    case 'setVt':
    case 'vte':
    case 'trappedVolume':
    case 'setInspFlow':
    case 'setHfncFlow':
    case 'setRr':
    case 'hr':
    case 'sbp':
    case 'map':
    case 'pao2Alveolar':
      return Math.round(value).toString();
    case 'timeConstant':
    case 'tiSec':
    case 'teSec':
    case 'endExpFlow':
    case 'deadSpaceFraction':
    case 'recruitedFraction':
    case 'shuntUsed':
    case 'fio2Effective':
    case 'drive':
    case 'unloading':
    case 'circulationMultiplier':
      return value.toFixed(2);
    case 'setFio2':
      return value <= 1 ? value.toFixed(2) : Math.round(value).toString();
    case 'fatigueChange':
    case 'paco2Change':
      return (value >= 0 ? '+' : '') + value.toFixed(3);
    case 'expResistance':
    case 'setPeep':
    case 'setTi':
    case 'setPs':
    case 'setTriggerFlow':
    case 'autoPeep':
    case 'ineffectiveEfforts':
    case 'ppeak':
    case 'pplat':
    case 'drivingPressure':
    case 'pmean':
    case 'minuteVent':
    case 'alveolarVentilation':
    case 'steadyPaco2Target':
    case 'paco2':
    case 'pao2':
    case 'spo2':
    case 'ptp':
    case 'hfncPressure':
    default:
      return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  }
}

export function computeDirection(
  field: WhyTraceField,
  before: number | string | null | undefined,
  after: number | string | null | undefined,
): Direction {
  if (before === null || before === undefined || after === null || after === undefined) {
    return 'same';
  }
  if (typeof before !== 'number' || typeof after !== 'number') {
    return before === after ? 'same' : 'up';
  }
  const band = WHY_FIELD_NOISE_BANDS[field] ?? 0.0001;
  const diff = after - before;
  if (diff > band) return 'up';
  if (diff < -band) return 'down';
  return 'same';
}

export function isFieldRuleBased(
  field: WhyTraceField,
  baseline: WhySnapshot,
  after: WhySnapshot,
  experimentRuleBased?: boolean,
): boolean {
  switch (field) {
    case 'recruitedFraction':
    case 'unloading':
    case 'ptp':
    case 'fatigueChange':
    case 'circulationMultiplier':
    case 'map':
    case 'sbp':
    case 'hr':
    case 'hfncPressure':
      return true;

    case 'shuntUsed': {
      const baseRec = typeof baseline.recruitedFraction === 'number' ? baseline.recruitedFraction : 0;
      const afterRec = typeof after.recruitedFraction === 'number' ? after.recruitedFraction : 0;
      return Math.abs(baseRec - afterRec) > 0.001 || Math.abs(afterRec) > 0.001;
    }

    case 'fio2Effective': {
      const isHfncOrLowFlow = (s: WhySnapshot) =>
        s.deviceKind === 'hfnc' ||
        s.deviceKind === 'none' ||
        (s.device && (s.device.device === 'hfnc' || s.device.device === 'none'));
      return isHfncOrLowFlow(baseline) || isHfncOrLowFlow(after);
    }

    default:
      return experimentRuleBased === true;
  }
}

export function getWhyTemplateText(
  field: WhyTraceField,
  direction: Direction,
  formattedBefore: string,
  formattedAfter: string,
): string {
  if (formattedBefore === '—' && formattedAfter === '—') {
    return 'Quantity not measured or unavailable under current ventilation conditions.';
  }

  switch (field) {
    case 'compliance':
      if (direction === 'up') {
        return `Static compliance increased from ${formattedBefore} to ${formattedAfter} mL/cmH2O, allowing the lungs to accept volume at lower distending pressures.`;
      }
      if (direction === 'down') {
        return `Static compliance decreased from ${formattedBefore} to ${formattedAfter} mL/cmH2O (stiffer lungs/chest wall), requiring higher pressure to achieve the same volume.`;
      }
      return `Static compliance remained stable at ${formattedBefore} mL/cmH2O.`;

    case 'expResistance':
      if (direction === 'up') {
        return `Expiratory resistance increased from ${formattedBefore} to ${formattedAfter} cmH2O/(L/s), prolonging the expiratory time constant and impeding passive deflation.`;
      }
      if (direction === 'down') {
        return `Expiratory resistance decreased from ${formattedBefore} to ${formattedAfter} cmH2O/(L/s), speeding expiratory lung emptying.`;
      }
      return `Expiratory resistance remained unchanged at ${formattedBefore} cmH2O/(L/s).`;

    case 'timeConstant':
      if (direction === 'up') {
        return `Expiratory time constant (RC) lengthened from ${formattedBefore} to ${formattedAfter} s; complete passive exhalation requires ~3–5 time constants, increasing risk of dynamic hyperinflation.`;
      }
      if (direction === 'down') {
        return `Expiratory time constant shortened from ${formattedBefore} to ${formattedAfter} s, allowing faster passive lung emptying within available expiratory time.`;
      }
      return `Expiratory time constant remained unchanged at ${formattedBefore} s.`;

    case 'setPeep':
      if (direction === 'up') {
        return `Set PEEP increased from ${formattedBefore} to ${formattedAfter} cmH2O, raising end-expiratory alveolar pressure and baseline FRC.`;
      }
      if (direction === 'down') {
        return `Set PEEP reduced from ${formattedBefore} to ${formattedAfter} cmH2O, lowering baseline airway pressure and potentially permitting derecruitment.`;
      }
      return `Set PEEP remained at ${formattedBefore} cmH2O.`;

    case 'setRr':
      if (direction === 'up') {
        return `Set respiratory rate increased from ${formattedBefore} to ${formattedAfter} bpm, shortening total cycle time and curtailing available expiratory time.`;
      }
      if (direction === 'down') {
        return `Set respiratory rate decreased from ${formattedBefore} to ${formattedAfter} bpm, lengthening cycle time and granting more expiratory time per breath.`;
      }
      return `Set respiratory rate remained at ${formattedBefore} bpm.`;

    case 'setVt':
      if (direction === 'up') {
        return `Set tidal volume increased from ${formattedBefore} to ${formattedAfter} mL, delivering larger mandatory breaths.`;
      }
      if (direction === 'down') {
        return `Set tidal volume decreased from ${formattedBefore} to ${formattedAfter} mL, delivering smaller mandatory breaths.`;
      }
      return `Set tidal volume remained at ${formattedBefore} mL.`;

    case 'setInspFlow':
      if (direction === 'up') {
        return `Set inspiratory flow increased from ${formattedBefore} to ${formattedAfter} L/min, shortening inspiratory time and leaving more time for expiration.`;
      }
      if (direction === 'down') {
        return `Set inspiratory flow decreased from ${formattedBefore} to ${formattedAfter} L/min, prolonging inspiration and narrowing expiratory time.`;
      }
      return `Set inspiratory flow remained at ${formattedBefore} L/min.`;

    case 'setTi':
      if (direction === 'up') {
        return `Set inspiratory time lengthened from ${formattedBefore} to ${formattedAfter} s, leaving less of the breath cycle for passive exhalation.`;
      }
      if (direction === 'down') {
        return `Set inspiratory time shortened from ${formattedBefore} to ${formattedAfter} s, expanding expiratory time.`;
      }
      return `Set inspiratory time remained at ${formattedBefore} s.`;

    case 'setPs':
      if (direction === 'up') {
        return `Pressure support increased from ${formattedBefore} to ${formattedAfter} cmH2O, providing greater inspiratory assistance to unload spontaneous efforts.`;
      }
      if (direction === 'down') {
        return `Pressure support decreased from ${formattedBefore} to ${formattedAfter} cmH2O, reducing inspiratory assistance and increasing patient effort.`;
      }
      return `Pressure support remained at ${formattedBefore} cmH2O.`;

    case 'setTriggerFlow':
      if (direction === 'up') {
        return `Flow trigger sensitivity threshold increased from ${formattedBefore} to ${formattedAfter} L/min, requiring greater patient effort to initiate a breath.`;
      }
      if (direction === 'down') {
        return `Flow trigger sensitivity threshold decreased from ${formattedBefore} to ${formattedAfter} L/min, making triggering easier.`;
      }
      return `Flow trigger sensitivity remained at ${formattedBefore} L/min.`;

    case 'setFio2':
      if (direction === 'up') {
        return `Set FiO2 increased from ${formattedBefore} to ${formattedAfter}, increasing inspired oxygen fraction.`;
      }
      if (direction === 'down') {
        return `Set FiO2 decreased from ${formattedBefore} to ${formattedAfter}, lowering inspired oxygen fraction.`;
      }
      return `Set FiO2 remained at ${formattedBefore}.`;

    case 'setHfncFlow':
      if (direction === 'up') {
        return `HFNC flow increased from ${formattedBefore} to ${formattedAfter} L/min, enhancing pharyngeal dead space washout and positive airway pressure.`;
      }
      if (direction === 'down') {
        return `HFNC flow decreased from ${formattedBefore} to ${formattedAfter} L/min, reducing pharyngeal pressure and dead space flushing.`;
      }
      return `HFNC flow remained at ${formattedBefore} L/min.`;

    case 'tiSec':
      if (direction === 'up') {
        return `Measured inspiratory time lengthened from ${formattedBefore} to ${formattedAfter} s, reducing the time available for exhalation.`;
      }
      if (direction === 'down') {
        return `Measured inspiratory time shortened from ${formattedBefore} to ${formattedAfter} s, leaving more time for expiration.`;
      }
      return `Measured inspiratory time remained steady at ${formattedBefore} s.`;

    case 'teSec':
      if (direction === 'up') {
        return `Expiratory time widened from ${formattedBefore} to ${formattedAfter} s, providing more opportunity for expiratory flow to reach zero.`;
      }
      if (direction === 'down') {
        return `Expiratory time narrowed from ${formattedBefore} to ${formattedAfter} s, increasing vulnerability to breath truncation and air trapping.`;
      }
      return `Expiratory time remained steady at ${formattedBefore} s.`;

    case 'endExpFlow':
      if (direction === 'up') {
        return `End-expiratory flow rose from ${formattedBefore} to ${formattedAfter} L/s, demonstrating that exhalation was cut off before completion.`;
      }
      if (direction === 'down') {
        return `End-expiratory flow fell from ${formattedBefore} to ${formattedAfter} L/s toward zero, indicating more complete lung emptying.`;
      }
      return `End-expiratory flow remained unchanged at ${formattedBefore} L/s.`;

    case 'trappedVolume':
      if (direction === 'up') {
        return `Trapped gas volume increased from ${formattedBefore} to ${formattedAfter} mL due to incomplete exhalation across consecutive breaths.`;
      }
      if (direction === 'down') {
        return `Trapped gas volume fell from ${formattedBefore} to ${formattedAfter} mL as increased expiratory time permitted fuller deflation.`;
      }
      return `Trapped gas volume remained steady at ${formattedBefore} mL.`;

    case 'autoPeep':
      if (direction === 'up') {
        return `Intrinsic PEEP (auto-PEEP) rose from ${formattedBefore} to ${formattedAfter} cmH2O from elastic recoil of trapped gas at end-expiration.`;
      }
      if (direction === 'down') {
        return `Intrinsic PEEP decreased from ${formattedBefore} to ${formattedAfter} cmH2O as trapped gas emptied and alveolar end-expiratory pressure fell.`;
      }
      return `Intrinsic PEEP remained stable at ${formattedBefore} cmH2O.`;

    case 'ineffectiveEfforts':
      if (direction === 'up') {
        return `Ineffective efforts increased from ${formattedBefore} to ${formattedAfter}, as spontaneous efforts failed to overcome intrinsic PEEP to reach the trigger threshold.`;
      }
      if (direction === 'down') {
        return `Ineffective efforts decreased from ${formattedBefore} to ${formattedAfter}, because reduced intrinsic PEEP or easier triggering allowed efforts to cycle the ventilator.`;
      }
      return `Ineffective efforts remained unchanged at ${formattedBefore}.`;

    case 'vte':
      if (direction === 'up') {
        return `Expiratory tidal volume increased from ${formattedBefore} to ${formattedAfter} mL, reflecting larger tidal volume delivery.`;
      }
      if (direction === 'down') {
        return `Expiratory tidal volume decreased from ${formattedBefore} to ${formattedAfter} mL, reflecting smaller tidal volume delivery.`;
      }
      return `Expiratory tidal volume remained stable at ${formattedBefore} mL.`;

    case 'ppeak':
      if (direction === 'up') {
        return `Peak airway pressure rose from ${formattedBefore} to ${formattedAfter} cmH2O, reflecting higher resistive or elastic loading during inspiration.`;
      }
      if (direction === 'down') {
        return `Peak airway pressure fell from ${formattedBefore} to ${formattedAfter} cmH2O due to lower inspiratory flow, lower resistance, or smaller volume.`;
      }
      return `Peak airway pressure remained stable at ${formattedBefore} cmH2O.`;

    case 'pplat':
      if (direction === 'up') {
        return `Plateau pressure increased from ${formattedBefore} to ${formattedAfter} cmH2O, indicating higher end-inspiratory alveolar distension.`;
      }
      if (direction === 'down') {
        return `Plateau pressure decreased from ${formattedBefore} to ${formattedAfter} cmH2O, indicating reduced end-inspiratory alveolar stretch.`;
      }
      return `Plateau pressure remained stable at ${formattedBefore} cmH2O.`;

    case 'drivingPressure':
      if (direction === 'up') {
        return `Driving pressure (ΔP = Pplat − PEEP) increased from ${formattedBefore} to ${formattedAfter} cmH2O, reflecting greater cyclic strain on aerated lung.`;
      }
      if (direction === 'down') {
        return `Driving pressure (ΔP = Pplat − PEEP) decreased from ${formattedBefore} to ${formattedAfter} cmH2O, reflecting reduced cyclic lung strain.`;
      }
      return `Driving pressure remained unchanged at ${formattedBefore} cmH2O.`;

    case 'pmean':
      if (direction === 'up') {
        return `Mean airway pressure rose from ${formattedBefore} to ${formattedAfter} cmH2O, increasing average intrathoracic distending pressure.`;
      }
      if (direction === 'down') {
        return `Mean airway pressure fell from ${formattedBefore} to ${formattedAfter} cmH2O, reducing average intrathoracic distending pressure.`;
      }
      return `Mean airway pressure remained stable at ${formattedBefore} cmH2O.`;

    case 'minuteVent':
      if (direction === 'up') {
        return `Minute ventilation increased from ${formattedBefore} to ${formattedAfter} L/min, increasing total gas clearance.`;
      }
      if (direction === 'down') {
        return `Minute ventilation fell from ${formattedBefore} to ${formattedAfter} L/min, reducing total gas clearance.`;
      }
      return `Minute ventilation remained stable at ${formattedBefore} L/min.`;

    case 'deadSpaceFraction':
      if (direction === 'up') {
        return `Alveolar dead space fraction rose from ${formattedBefore} to ${formattedAfter}, increasing the proportion of wasted ventilation.`;
      }
      if (direction === 'down') {
        return `Alveolar dead space fraction decreased from ${formattedBefore} to ${formattedAfter}, improving ventilatory efficiency.`;
      }
      return `Alveolar dead space fraction remained stable at ${formattedBefore}.`;

    case 'alveolarVentilation':
      if (direction === 'up') {
        return `Effective alveolar ventilation increased from ${formattedBefore} to ${formattedAfter} L/min, enhancing CO2 clearance from gas-exchanging units.`;
      }
      if (direction === 'down') {
        return `Effective alveolar ventilation fell from ${formattedBefore} to ${formattedAfter} L/min, reducing CO2 clearance.`;
      }
      return `Effective alveolar ventilation remained steady at ${formattedBefore} L/min.`;

    case 'steadyPaco2Target':
      if (direction === 'up') {
        return `Steady-state PaCO2 target rose from ${formattedBefore} to ${formattedAfter} mmHg as alveolar ventilation fell relative to metabolic production.`;
      }
      if (direction === 'down') {
        return `Steady-state PaCO2 target shifted downward from ${formattedBefore} to ${formattedAfter} mmHg because alveolar ventilation exceeded metabolic production.`;
      }
      return `Steady-state PaCO2 target remained at ${formattedBefore} mmHg.`;

    case 'paco2Change':
      if (direction === 'up') {
        return `PaCO2 rate of change increased from ${formattedBefore} to ${formattedAfter} mmHg/s, accelerating arterial CO2 accumulation.`;
      }
      if (direction === 'down') {
        return `PaCO2 rate of change fell from ${formattedBefore} to ${formattedAfter} mmHg/s, reflecting active arterial CO2 clearance or decelerating rise.`;
      }
      return `PaCO2 rate of change remained constant at ${formattedBefore} mmHg/s.`;

    case 'paco2':
      if (direction === 'up') {
        return `Arterial PaCO2 rose from ${formattedBefore} to ${formattedAfter} mmHg due to net alveolar hypoventilation relative to metabolic CO2 production.`;
      }
      if (direction === 'down') {
        return `Arterial PaCO2 fell from ${formattedBefore} to ${formattedAfter} mmHg driven by increased alveolar ventilation.`;
      }
      return `Arterial PaCO2 remained stable at ${formattedBefore} mmHg.`;

    case 'ph':
      if (direction === 'up') {
        return `Arterial pH rose from ${formattedBefore} to ${formattedAfter} (alkalaemic shift) as PaCO2 decreased, shifting bicarbonate-carbonic acid equilibrium.`;
      }
      if (direction === 'down') {
        return `Arterial pH fell from ${formattedBefore} to ${formattedAfter} (acidaemic shift) as carbonic acid accumulated from hypercapnia.`;
      }
      return `Arterial pH remained stable at ${formattedBefore}.`;

    case 'recruitedFraction':
      if (direction === 'up') {
        return `Recruited lung fraction increased from ${formattedBefore} to ${formattedAfter}, opening previously collapsed units via positive pressure.`;
      }
      if (direction === 'down') {
        return `Recruited lung fraction decreased from ${formattedBefore} to ${formattedAfter}, indicating alveolar derecruitment and loss of aerated lung.`;
      }
      return `Recruited lung fraction remained unchanged at ${formattedBefore}.`;

    case 'shuntUsed':
      if (direction === 'up') {
        return `Effective shunt fraction increased from ${formattedBefore} to ${formattedAfter}, causing more venous blood to bypass ventilated alveoli.`;
      }
      if (direction === 'down') {
        return `Effective shunt fraction decreased from ${formattedBefore} to ${formattedAfter} as alveolar recruitment restored ventilation to perfused units.`;
      }
      return `Effective shunt fraction remained stable at ${formattedBefore}.`;

    case 'fio2Effective':
      if (direction === 'up') {
        return `Effective delivered FiO2 rose from ${formattedBefore} to ${formattedAfter}, increasing inspired oxygen fraction delivered to the airways.`;
      }
      if (direction === 'down') {
        return `Effective delivered FiO2 fell from ${formattedBefore} to ${formattedAfter}, lowering inspired oxygen fraction.`;
      }
      return `Effective delivered FiO2 remained unchanged at ${formattedBefore}.`;

    case 'pao2Alveolar':
      if (direction === 'up') {
        return `Alveolar oxygen tension (PAO2) rose from ${formattedBefore} to ${formattedAfter} mmHg following the alveolar gas equation.`;
      }
      if (direction === 'down') {
        return `Alveolar oxygen tension (PAO2) fell from ${formattedBefore} to ${formattedAfter} mmHg due to lower inspired oxygen or higher alveolar PCO2.`;
      }
      return `Alveolar oxygen tension (PAO2) remained unchanged at ${formattedBefore} mmHg.`;

    case 'pao2':
      if (direction === 'up') {
        return `Arterial oxygen tension (PaO2) rose from ${formattedBefore} to ${formattedAfter} mmHg due to higher alveolar PO2 or reduced shunt fraction.`;
      }
      if (direction === 'down') {
        return `Arterial oxygen tension (PaO2) fell from ${formattedBefore} to ${formattedAfter} mmHg from impaired oxygen transfer or increased intrapulmonary shunt.`;
      }
      return `Arterial oxygen tension (PaO2) remained stable at ${formattedBefore} mmHg.`;

    case 'spo2':
      if (direction === 'up') {
        return `Oxygen saturation (SpO2) rose from ${formattedBefore}% to ${formattedAfter}% along the oxyhaemoglobin dissociation curve.`;
      }
      if (direction === 'down') {
        return `Oxygen saturation (SpO2) fell from ${formattedBefore}% to ${formattedAfter}% along the oxyhaemoglobin dissociation curve.`;
      }
      return `Oxygen saturation (SpO2) remained stable at ${formattedBefore}%.`;

    case 'drive':
      if (direction === 'up') {
        return `Chemoreflex respiratory drive multiplier rose from ${formattedBefore}× to ${formattedAfter}× stimulated by hypercapnia or acidaemia.`;
      }
      if (direction === 'down') {
        return `Chemoreflex respiratory drive multiplier fell from ${formattedBefore}× to ${formattedAfter}× as ventilatory assistance normalized arterial blood gases.`;
      }
      return `Chemoreflex respiratory drive multiplier remained at ${formattedBefore}×.`;

    case 'unloading':
      if (direction === 'up') {
        return `Patient effort unloading factor increased from ${formattedBefore} to ${formattedAfter}, transferring more work of breathing onto the patient's respiratory muscles.`;
      }
      if (direction === 'down') {
        return `Patient effort unloading factor decreased from ${formattedBefore} to ${formattedAfter}, with ventilator assistance taking on more of the total work of breathing.`;
      }
      return `Patient effort unloading factor remained unchanged at ${formattedBefore}.`;

    case 'ptp':
      if (direction === 'up') {
        return `Diaphragmatic pressure-time product (PTP) rose from ${formattedBefore} to ${formattedAfter} cmH2O·s, reflecting increased energetic expenditure per breath.`;
      }
      if (direction === 'down') {
        return `Diaphragmatic pressure-time product (PTP) fell from ${formattedBefore} to ${formattedAfter} cmH2O·s, confirming reduced muscular mechanical effort.`;
      }
      return `Diaphragmatic pressure-time product (PTP) remained steady at ${formattedBefore} cmH2O·s.`;

    case 'fatigueChange':
      if (direction === 'up') {
        return `Diaphragmatic fatigue accumulation rate increased from ${formattedBefore} to ${formattedAfter}/min as muscular effort exceeded sustainable energy balance.`;
      }
      if (direction === 'down') {
        return `Diaphragmatic fatigue rate decreased from ${formattedBefore} to ${formattedAfter}/min as ventilatory unloading reduced muscle expenditure.`;
      }
      return `Diaphragmatic fatigue rate remained steady at ${formattedBefore}/min.`;

    case 'circulationMultiplier':
      if (direction === 'up') {
        return `Circulation multiplier rose from ${formattedBefore}× to ${formattedAfter}×, indicating improved venous return or reduced afterload.`;
      }
      if (direction === 'down') {
        return `Circulation multiplier fell from ${formattedBefore}× to ${formattedAfter}× as elevated intrathoracic pressure impeded right ventricular venous return.`;
      }
      return `Circulation multiplier remained at ${formattedBefore}×.`;

    case 'map':
      if (direction === 'up') {
        return `Mean arterial pressure rose from ${formattedBefore} to ${formattedAfter} mmHg.`;
      }
      if (direction === 'down') {
        return `Mean arterial pressure fell from ${formattedBefore} to ${formattedAfter} mmHg due to decreased venous return and cardiac output under positive intrathoracic pressure.`;
      }
      return `Mean arterial pressure remained steady at ${formattedBefore} mmHg.`;

    case 'sbp':
      if (direction === 'up') {
        return `Systolic blood pressure rose from ${formattedBefore} to ${formattedAfter} mmHg.`;
      }
      if (direction === 'down') {
        return `Systolic blood pressure fell from ${formattedBefore} to ${formattedAfter} mmHg as stroke volume decreased with higher mean airway pressure.`;
      }
      return `Systolic blood pressure remained steady at ${formattedBefore} mmHg.`;

    case 'hr':
      if (direction === 'up') {
        return `Heart rate rose from ${formattedBefore} to ${formattedAfter} bpm, reflecting baroreflex compensation for lower stroke volume or increased sympathetic tone.`;
      }
      if (direction === 'down') {
        return `Heart rate decreased from ${formattedBefore} to ${formattedAfter} bpm as sympathetic stress lessened.`;
      }
      return `Heart rate remained steady at ${formattedBefore} bpm.`;

    case 'hfncPressure':
      if (direction === 'up') {
        return `HFNC pharyngeal PEEP increased from ${formattedBefore} to ${formattedAfter} cmH2O driven by higher nasal cannula flow.`;
      }
      if (direction === 'down') {
        return `HFNC pharyngeal PEEP decreased from ${formattedBefore} to ${formattedAfter} cmH2O as cannula flow was reduced.`;
      }
      return `HFNC pharyngeal PEEP remained at ${formattedBefore} cmH2O.`;

    default:
      return `${field} changed from ${formattedBefore} to ${formattedAfter}.`;
  }
}

export function captureWhySnapshot(state: EngineState): WhySnapshot {
  const trace = lastTrace(state);
  let truthObj: Truth;
  try {
    truthObj = truth(state);
  } catch {
    truthObj = {
      ph: 7.4,
      paco2: state.phys?.paco2MmHg ?? 40,
      pao2: state.phys?.pao2MmHg ?? 95,
      pfRatio: 450,
      fatigue: state.phys?.fatigue ?? 0,
      pplat: null,
      autoPeep: null,
      drivingPressure: null,
      vteMlKgPbw: null,
      alveolarVentLpm: null,
      trappedVolumeMl: state.phys?.trappedVolumeMl ?? 0,
    };
  }

  const patient = state.patient;
  const device = state.device;
  const monitored = state.monitored;
  const lastBreath = state.lastBreath;

  const compliance = patient.complianceMlPerCmH2O;
  const expResistance = patient.expResistanceCmH2OPerLps;
  const timeConstant = (compliance / 1000) * expResistance;

  const setPeep = device.device === 'invasive'
    ? device.peep
    : device.device === 'niv'
    ? device.epap
    : null;

  const setRr = device.device === 'invasive'
    ? device.rrSetBpm
    : device.device === 'niv'
    ? (device.backupRrBpm ?? null)
    : null;

  const setVt = device.device === 'invasive' ? (device.vtSetMl ?? null) : null;
  const setInspFlow = device.device === 'invasive' ? (device.inspFlowLpm ?? null) : null;
  const setTi = device.device === 'invasive'
    ? (device.tiSec ?? null)
    : device.device === 'niv'
    ? (device.tiSec ?? null)
    : null;

  const setPs = device.device === 'invasive'
    ? (device.psAbovePeep ?? null)
    : device.device === 'niv' && device.ipap !== undefined
    ? device.ipap - device.epap
    : null;

  const setTriggerFlow = device.device === 'invasive' ? (device.triggerFlowLpm ?? null) : null;
  const setFio2 = 'fio2' in device ? device.fio2 : null;
  const setHfncFlow = device.device === 'hfnc' ? device.flowLpm : null;

  const tiSec = lastBreath?.tiSec ?? null;
  const teSec = lastBreath?.teSec ?? null;
  const endExpFlow = lastBreath ? Math.abs(lastBreath.endExpFlowLps) : null;
  const trappedVolume = truthObj.trappedVolumeMl ?? state.phys?.trappedVolumeMl ?? 0;
  const autoPeep = truthObj.autoPeep ?? null;
  const ineffectiveEfforts = lastBreath?.ineffectiveEfforts ?? 0;
  const vte = lastBreath?.vteMl ?? monitored.vteMl ?? null;
  const ppeak = monitored.ppeakCmH2O ?? lastBreath?.ppeakCmH2O ?? null;
  const pplat = truthObj.pplat ?? null;
  const drivingPressure = truthObj.drivingPressure ?? null;
  const pmean = monitored.pmeanCmH2O ?? lastBreath?.pmeanCmH2O ?? null;
  const minuteVent = monitored.minuteVentLpm ?? null;

  const deadSpaceFraction = trace?.deadSpaceFraction ?? patient.alveolarDeadSpaceFraction;
  const alveolarVentilation = trace?.alveolarVentilation ?? truthObj.alveolarVentLpm ?? null;
  const steadyPaco2Target = trace?.steadyPaco2Target ?? null;
  const paco2Change = trace?.paco2Change ?? null;
  const paco2 = state.phys?.paco2MmHg ?? truthObj.paco2;
  const ph = truthObj.ph ?? trace?.ph ?? 7.4;
  const recruitedFraction = trace?.recruitedFraction ?? state.phys?.recruitedFraction ?? 0;
  const shuntUsed = trace?.shuntUsed ?? patient.shuntFraction;
  const fio2Effective = trace?.fio2Effective ?? monitored.fio2;
  const pao2Alveolar = trace?.pao2Alveolar ?? null;
  const pao2 = state.phys?.pao2MmHg ?? truthObj.pao2 ?? trace?.pao2 ?? 95;
  const spo2 = monitored.spo2Pct;
  const drive = trace?.drive ?? 1.0;
  const unloading = trace?.unloading ?? 1.0;
  const ptp = trace?.ptp ?? 0;
  const fatigueChange = trace?.fatigueChange ?? 0;
  const circulationMultiplier = trace?.circulationMultiplier ?? 1.0;
  const map = monitored.mapMmHg;
  const sbp = monitored.sbpMmHg;
  const hr = monitored.hrBpm;
  const hfncPressure = monitored.hfncPressureCmH2O ?? (device.device === 'hfnc' ? 0.05 * device.flowLpm : null);

  const values: Record<WhyTraceField, number | string | null> = {
    compliance,
    expResistance,
    timeConstant,
    setPeep,
    setRr,
    setVt,
    setInspFlow,
    setTi,
    setPs,
    setTriggerFlow,
    setFio2,
    setHfncFlow,
    tiSec,
    teSec,
    endExpFlow,
    trappedVolume,
    autoPeep,
    ineffectiveEfforts,
    vte,
    ppeak,
    pplat,
    drivingPressure,
    pmean,
    minuteVent,
    deadSpaceFraction,
    alveolarVentilation,
    steadyPaco2Target,
    paco2Change,
    paco2,
    ph,
    recruitedFraction,
    shuntUsed,
    fio2Effective,
    pao2Alveolar,
    pao2,
    spo2,
    drive,
    unloading,
    ptp,
    fatigueChange,
    circulationMultiplier,
    map,
    sbp,
    hr,
    hfncPressure,
  };

  return {
    simTimeSec: state.simTimeSec,
    deviceKind: device.device,
    patient,
    device,
    trace,
    truth: truthObj,
    monitored,
    lastBreath,
    values,
    ...values,
  };
}

export function buildCausalChain(
  fields: WhyTraceField[],
  baseline: WhySnapshot,
  after: WhySnapshot,
  options?: { experimentRuleBased?: boolean },
): CausalNode[] {
  return fields.map((field) => {
    const meta = WHY_FIELD_METADATA[field] ?? { label: field, unit: '' };
    const beforeValue = baseline.values?.[field] ?? baseline[field] ?? null;
    const afterValue = after.values?.[field] ?? after[field] ?? null;
    const formattedBefore = formatTraceValue(field, beforeValue);
    const formattedAfter = formatTraceValue(field, afterValue);
    const direction = computeDirection(field, beforeValue, afterValue);
    const ruleBased = isFieldRuleBased(field, baseline, after, options?.experimentRuleBased);
    const templateText = getWhyTemplateText(field, direction, formattedBefore, formattedAfter);

    return {
      field,
      label: meta.label,
      unit: meta.unit,
      beforeValue,
      afterValue,
      formattedBefore,
      formattedAfter,
      direction,
      ruleBased,
      templateText,
    };
  });
}
