export type ClinicalKind =
  | 'ph'
  | 'paco2'
  | 'pao2'
  | 'spo2'
  | 'pplat'
  | 'drivingPressure'
  | 'map'
  | 'rr';

const DECIMALS: Record<ClinicalKind, number> = {
  ph: 2,
  paco2: 0,
  pao2: 0,
  spo2: 0,
  pplat: 0,
  drivingPressure: 0,
  map: 0,
  rr: 0,
};

/** Format a monitored or lab value for display. Returns '--' for missing or non-finite input. */
export function formatClinical(kind: ClinicalKind, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(DECIMALS[kind]);
}
