import { describe, it, expect } from 'vitest';
import { formatClinical } from './formatClinical';

describe('formatClinical', () => {
  it('rounds pH to 2 decimals', () => {
    expect(formatClinical('ph', 7.4029774575081335)).toBe('7.40');
  });
  it('rounds PaCO2 and PaO2 to whole numbers', () => {
    expect(formatClinical('paco2', 40.02333654307852)).toBe('40');
    expect(formatClinical('pao2', 82.6)).toBe('83');
  });
  it('rounds SpO2 to a whole number', () => {
    expect(formatClinical('spo2', 93.4)).toBe('93');
  });
  it('rounds pressures to whole numbers', () => {
    expect(formatClinical('pplat', 13.763500915736921)).toBe('14');
    expect(formatClinical('drivingPressure', 8.49)).toBe('8');
    expect(formatClinical('map', 11.5)).toBe('12');
  });
  it('rounds RR to a whole number', () => {
    expect(formatClinical('rr', 21.7)).toBe('22');
  });
  it('returns -- for null, undefined, NaN and infinity', () => {
    expect(formatClinical('ph', null)).toBe('--');
    expect(formatClinical('paco2', undefined)).toBe('--');
    expect(formatClinical('pplat', NaN)).toBe('--');
    expect(formatClinical('rr', Infinity)).toBe('--');
  });
});
