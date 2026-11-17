// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveGuidance,
  getScaffoldsForGuidance,
  SCAFFOLD_CONFIG_BY_LEVEL,
} from './scaffolds';
import { useScaffolds } from './useScaffolds';
import { renderHook } from '@testing-library/react';

describe('Scaffold fading logic', () => {
  it('resolves effective guidance level based on lowest autonomy among relevant competencies', () => {
    // If any competency is guided -> guided
    expect(
      resolveEffectiveGuidance({
        'mech.driving-pressure': 'guided',
        'disease.ards': 'independent',
      })
    ).toBe('guided');

    // If no guided but has prompted -> prompted
    expect(
      resolveEffectiveGuidance({
        'mech.driving-pressure': 'prompted',
        'disease.ards': 'independent',
      })
    ).toBe('prompted');

    // If all independent -> independent
    expect(
      resolveEffectiveGuidance({
        'mech.driving-pressure': 'independent',
        'disease.ards': 'independent',
      })
    ).toBe('independent');
  });

  it('scaffold configuration matches required progressive autonomy rules', () => {
    const guided = getScaffoldsForGuidance('guided');
    expect(guided.showComputedDrivingPressure).toBe(true);
    expect(guided.showComputedAutoPeep).toBe(true);
    expect(guided.showPedagogicalNotes).toBe(true);
    expect(guided.requireIrreversibleConfirmation).toBe(true);

    const independent = getScaffoldsForGuidance('independent');
    expect(independent.showComputedDrivingPressure).toBe(false);
    expect(independent.showComputedAutoPeep).toBe(false);
    expect(independent.showPedagogicalNotes).toBe(false);
    expect(independent.requireIrreversibleConfirmation).toBe(false);
  });
});

describe('useScaffolds Hook', () => {
  it('formats inspiratory hold with driving pressure in guided mode, but raw in independent mode', () => {
    const { result: guidedRes } = renderHook(() =>
      useScaffolds({ 'mech.driving-pressure': 'guided' })
    );
    expect(guidedRes.current.effectiveGuidance).toBe('guided');
    expect(guidedRes.current.formatInspHold(24, 10)).toBe(
      'Pplat 24.0 cmH2O · driving pressure 14.0'
    );

    const { result: indepRes } = renderHook(() =>
      useScaffolds({ 'mech.driving-pressure': 'independent' })
    );
    expect(indepRes.current.effectiveGuidance).toBe('independent');
    expect(indepRes.current.formatInspHold(24, 10)).toBe('Pplat 24.0 cmH2O');
  });

  it('formats expiratory hold with auto-PEEP in guided mode, but raw in independent mode', () => {
    const { result: guidedRes } = renderHook(() =>
      useScaffolds({ 'mech.auto-peep': 'guided' })
    );
    expect(guidedRes.current.formatExpHold(12, 7)).toBe(
      'Total PEEP 12.0 · auto-PEEP 7.0 cmH2O'
    );

    const { result: indepRes } = renderHook(() =>
      useScaffolds({ 'mech.auto-peep': 'independent' })
    );
    expect(indepRes.current.formatExpHold(12, 7)).toBe('Total PEEP 12.0');
  });
});
