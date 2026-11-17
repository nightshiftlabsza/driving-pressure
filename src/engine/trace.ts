/**
 * Causal trace: records intermediate physiological quantities calculated
 * during each slowUpdate in the engine.
 * Useful for debugging, explanations, causal tracing, and validation.
 */

export interface EngineTrace {
  /** Alveolar ventilation in L/min, or null if insufficient breath history. */
  alveolarVentilation: number | null;
  /** Fractional alveolar dead space (0..1). */
  deadSpaceFraction: number;
  /** Mixed steady-state PaCO2 target (60% ventilation + 40% tissue), mmHg. */
  steadyPaco2Target: number | null;
  /** PaCO2 change increment applied in the slow update step, mmHg. */
  paco2Change: number | null;
  /** Arterial pH. */
  ph: number;
  /** Shunt fraction used after recruitment adjustment. */
  shuntUsed: number;
  /** Recruited lung fraction (-0.5..1.0). */
  recruitedFraction: number;
  /** Effective delivered FiO2 accounting for device dilution. */
  fio2Effective: number;
  /** Alveolar oxygen tension (PAO2) from alveolar gas equation, mmHg. */
  pao2Alveolar: number;
  /** Target arterial oxygen tension (PaO2) from shunt equation, mmHg. */
  pao2: number;
  /** Chemoreflex drive multiplier. */
  drive: number;
  /** Patient effort unloading factor (0.5..1.0) from pressure assistance. */
  unloading: number;
  /** Pressure-time product (PTP) of patient inspiratory effort. */
  ptp: number;
  /** Increment/decrement of fatigue in this step. */
  fatigueChange: number;
  /** Hemodynamic circulation multiplier applied to baseline blood pressure (1 + mapFrac). */
  circulationMultiplier: number;
}
