// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { LAB_TEST_IDS, type WhyTraceField } from '../schema';
import {
  WhyView,
  captureWhySnapshot,
  buildCausalChain,
  formatTraceValue,
  computeDirection,
  isFieldRuleBased,
  getWhyTemplateText,
  type WhySnapshot,
  type CausalNode,
} from './index';
import { engine } from '../../engine';
import type { DeviceSettings, PatientParams } from '../../shared/engineTypes';

afterEach(() => {
  cleanup();
});

const mockPatient: PatientParams = {
  sex: 'M',
  ageYears: 55,
  heightCm: 175,
  actualWeightKg: 75,
  complianceMlPerCmH2O: 50,
  inspResistanceCmH2OPerLps: 8,
  expResistanceCmH2OPerLps: 10,
  spontRateBpm: 0,
  pmusAmplitudeCmH2O: 0,
  pmusInspTimeSec: 1,
  vco2MlPerMin: 200,
  vo2MlPerMin: 250,
  anatomicDeadSpaceMl: 150,
  alveolarDeadSpaceFraction: 0.1,
  shuntFraction: 0.05,
  recruitability: 0.3,
  hbGPerDl: 14,
  temperatureC: 37,
  baselineHco3MmolL: 24,
  hrBaselineBpm: 75,
  sbpBaselineMmHg: 120,
  dbpBaselineMmHg: 80,
  ppvResponse: 'unhelpful',
  ppvSeverity: 0.2,
  respiratoryReserve: 1,
};

const mockDevice: DeviceSettings = {
  device: 'invasive',
  mode: 'VC-AC',
  fio2: 0.4,
  peep: 5,
  rrSetBpm: 14,
  vtSetMl: 450,
  inspFlowLpm: 60,
  flowPattern: 'square',
};

function createSyntheticSnapshot(overrides: Partial<WhySnapshot['values']> = {}): WhySnapshot {
  const dummyState = engine.createState(mockPatient, mockDevice);
  const snap = captureWhySnapshot(dummyState);
  return {
    ...snap,
    values: {
      ...snap.values,
      ...overrides,
    },
    ...overrides,
  };
}

describe('WhyView - Locked state (Requirement 1)', () => {
  it('renders LAB_WHY_LOCKED and zero causal nodes when committed is false', () => {
    const baseline = createSyntheticSnapshot({ setVt: 400, vte: 400, paco2: 44, ph: 7.36 });
    const after = createSyntheticSnapshot({ setVt: 500, vte: 500, paco2: 38, ph: 7.42 });
    const chainFields: WhyTraceField[] = ['setVt', 'vte', 'paco2', 'ph'];

    render(
      <WhyView
        committed={false}
        baseline={baseline}
        after={after}
        causalChainFields={chainFields}
      />,
    );

    // 1. Must render locked notice
    const lockedEl = screen.getByTestId(LAB_TEST_IDS.LAB_WHY_LOCKED);
    expect(lockedEl).toBeDefined();
    expect(lockedEl.textContent).toContain('Complete your prediction');

    // 2. Must NOT render unlocked container
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeNull();

    // 3. Must NEVER render any causal nodes, numbers, or templates when committed === false
    for (const field of chainFields) {
      expect(screen.queryByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}${field}`)).toBeNull();
    }
    expect(screen.queryByText(/400/)).toBeNull();
    expect(screen.queryByText(/500/)).toBeNull();
  });
});

describe('WhyView - Unlocked visual chain (Requirement 2 & 4)', () => {
  it('renders LAB_WHY_VIEW and each node in causalChainFields with accurate numbers and templates when committed is true', () => {
    const baseline = createSyntheticSnapshot({
      setVt: 400,
      vte: 395,
      alveolarVentilation: 4.2,
      paco2: 46.0,
      ph: 7.34,
    });
    const after = createSyntheticSnapshot({
      setVt: 550,
      vte: 545,
      alveolarVentilation: 6.1,
      paco2: 36.5,
      ph: 7.44,
    });
    const chainFields: WhyTraceField[] = ['setVt', 'vte', 'alveolarVentilation', 'paco2', 'ph'];

    render(
      <WhyView
        committed={true}
        baseline={baseline}
        after={after}
        causalChainFields={chainFields}
      />,
    );

    // Container is present
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeDefined();
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_WHY_LOCKED)).toBeNull();

    // Each node is present with testid, label, formatted before/after numbers, and direction indicator
    const vtNode = screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}setVt`);
    expect(vtNode).toBeDefined();
    expect(vtNode.textContent).toContain('Set tidal volume');
    expect(vtNode.textContent).toContain('400 mL → 550 mL');
    expect(vtNode.textContent).toContain('delivering larger mandatory breaths');
    expect(screen.getAllByLabelText('Increased').length).toBeGreaterThanOrEqual(1);

    const paco2Node = screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}paco2`);
    expect(paco2Node).toBeDefined();
    expect(paco2Node.textContent).toContain('Arterial PaCO2');
    expect(paco2Node.textContent).toContain('46 mmHg → 36.5 mmHg');
    expect(paco2Node.textContent).toContain('Arterial PaCO2 fell');

    const phNode = screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}ph`);
    expect(phNode).toBeDefined();
    expect(phNode.textContent).toContain('Arterial pH');
    expect(phNode.textContent).toContain('7.34 → 7.44');
    expect(phNode.textContent).toContain('alkalaemic shift');
  });

  it('accepts precomputed nodes directly', () => {
    const nodes: CausalNode[] = [
      {
        field: 'compliance',
        label: 'Static compliance',
        unit: 'mL/cmH2O',
        beforeValue: 40,
        afterValue: 40,
        formattedBefore: '40',
        formattedAfter: '40',
        direction: 'same',
        ruleBased: false,
        templateText: 'Static compliance remained stable at 40 mL/cmH2O.',
      },
    ];

    render(<WhyView committed={true} nodes={nodes} />);
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeDefined();
    const nodeEl = screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}compliance`);
    expect(nodeEl.textContent).toContain('Static compliance');
    expect(nodeEl.textContent).toContain('40 mL/cmH2O → 40 mL/cmH2O');
    expect(screen.getByLabelText('Unchanged')).toBeDefined();
  });
});

describe('WhyView - Rule-based badges (Requirement 3)', () => {
  it('marks rule-based fields with ruleBased: true and renders LAB_RULE_BASED_BADGE', () => {
    const baseline = createSyntheticSnapshot({
      recruitedFraction: 0,
      circulationMultiplier: 1.0,
      unloading: 1.0,
      ptp: 0,
      fatigueChange: 0,
      map: 85,
      sbp: 125,
      hr: 72,
      hfncPressure: 0,
    });
    const after = createSyntheticSnapshot({
      recruitedFraction: 0.15,
      circulationMultiplier: 0.88,
      unloading: 0.72,
      ptp: 4.5,
      fatigueChange: -0.002,
      map: 74,
      sbp: 112,
      hr: 84,
      hfncPressure: 3.0,
    });

    const ruleFields: WhyTraceField[] = [
      'recruitedFraction',
      'circulationMultiplier',
      'unloading',
      'ptp',
      'fatigueChange',
      'map',
      'sbp',
      'hr',
      'hfncPressure',
    ];

    const chain = buildCausalChain(ruleFields, baseline, after);
    for (const node of chain) {
      expect(node.ruleBased).toBe(true);
    }

    render(
      <WhyView
        committed={true}
        baseline={baseline}
        after={after}
        causalChainFields={ruleFields}
      />,
    );

    const badges = screen.getAllByTestId(LAB_TEST_IDS.LAB_RULE_BASED_BADGE);
    expect(badges.length).toBeGreaterThanOrEqual(ruleFields.length);
    for (const badge of badges) {
      expect(badge.textContent).toContain('Rule-based approximation');
    }
  });

  it('marks shuntUsed as ruleBased when recruitment changed, but false when recruitment unchanged', () => {
    const baseNoRec = createSyntheticSnapshot({ recruitedFraction: 0, shuntUsed: 0.2 });
    const afterNoRec = createSyntheticSnapshot({ recruitedFraction: 0, shuntUsed: 0.2 });
    expect(isFieldRuleBased('shuntUsed', baseNoRec, afterNoRec)).toBe(false);

    const baseWithRec = createSyntheticSnapshot({ recruitedFraction: 0, shuntUsed: 0.2 });
    const afterWithRec = createSyntheticSnapshot({ recruitedFraction: 0.2, shuntUsed: 0.12 });
    expect(isFieldRuleBased('shuntUsed', baseWithRec, afterWithRec)).toBe(true);
  });

  it('marks fio2Effective as ruleBased on HFNC or low-flow device', () => {
    const invSnap = createSyntheticSnapshot({});
    expect(isFieldRuleBased('fio2Effective', invSnap, invSnap)).toBe(false);

    const hfncSnap: WhySnapshot = {
      ...invSnap,
      deviceKind: 'hfnc',
      device: { device: 'hfnc', flowLpm: 40, fio2: 0.5, temperatureC: 37 },
    };
    expect(isFieldRuleBased('fio2Effective', hfncSnap, hfncSnap)).toBe(true);
  });

  it('renders experiment-level ruleBased badge when ruleBased prop is true', () => {
    const baseline = createSyntheticSnapshot({ setPeep: 5, pplat: 18, drivingPressure: 13 });
    const after = createSyntheticSnapshot({ setPeep: 10, pplat: 22, drivingPressure: 12 });
    const fields: WhyTraceField[] = ['setPeep', 'pplat', 'drivingPressure'];

    render(
      <WhyView
        committed={true}
        baseline={baseline}
        after={after}
        causalChainFields={fields}
        ruleBased={true}
        ruleBasedNote="Recruitment and hemodynamics rely on simplified empirical rules."
      />,
    );

    const badges = screen.getAllByTestId(LAB_TEST_IDS.LAB_RULE_BASED_BADGE);
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('captureWhySnapshot helper', () => {
  it('extracts truth, trace, patient, device, and monitored values from an engine state', () => {
    const st = engine.createState(mockPatient, mockDevice);
    const stepped = engine.step(st, 2).state;
    const snap = captureWhySnapshot(stepped);

    expect(snap.simTimeSec).toBeGreaterThan(0);
    expect(snap.deviceKind).toBe('invasive');
    expect(snap.values.setVt).toBe(450);
    expect(snap.values.setRr).toBe(14);
    expect(snap.values.setPeep).toBe(5);
    expect(typeof snap.values.compliance).toBe('number');
    expect(typeof snap.values.paco2).toBe('number');
    expect(typeof snap.values.ph).toBe('number');
    expect(typeof snap.values.spo2).toBe('number');
  });
});

describe('Templates & formatting edge cases', () => {
  it('formats numbers according to clinical precision rules', () => {
    expect(formatTraceValue('ph', 7.352)).toBe('7.35');
    expect(formatTraceValue('setVt', 450.2)).toBe('450');
    expect(formatTraceValue('vte', 423.8)).toBe('424');
    expect(formatTraceValue('paco2', 42.45)).toBe('42.5');
    expect(formatTraceValue('paco2Change', 0.05)).toBe('+0.050');
    expect(formatTraceValue('paco2Change', -0.025)).toBe('-0.025');
    expect(formatTraceValue('setFio2', 0.4)).toBe('0.40');
    expect(formatTraceValue('ph', null)).toBe('—');
  });

  it('computes direction properly respecting noise bands', () => {
    expect(computeDirection('paco2', 40.0, 42.0)).toBe('up');
    expect(computeDirection('paco2', 40.0, 38.0)).toBe('down');
    expect(computeDirection('paco2', 40.0, 40.2)).toBe('same'); // within noise band 0.5
    expect(computeDirection('ph', 7.40, 7.44)).toBe('up');
    expect(computeDirection('ph', 7.40, 7.36)).toBe('down');
    expect(computeDirection('ph', 7.40, 7.405)).toBe('same'); // within noise band 0.015
  });

  it('generates non-empty deterministic templates for every direction of all 45 fields', () => {
    const allFields: WhyTraceField[] = [
      'compliance',
      'expResistance',
      'timeConstant',
      'setPeep',
      'setRr',
      'setVt',
      'setInspFlow',
      'setTi',
      'setPs',
      'setTriggerFlow',
      'setFio2',
      'setHfncFlow',
      'tiSec',
      'teSec',
      'endExpFlow',
      'trappedVolume',
      'autoPeep',
      'ineffectiveEfforts',
      'vte',
      'ppeak',
      'pplat',
      'drivingPressure',
      'pmean',
      'minuteVent',
      'deadSpaceFraction',
      'alveolarVentilation',
      'steadyPaco2Target',
      'paco2Change',
      'paco2',
      'ph',
      'recruitedFraction',
      'shuntUsed',
      'fio2Effective',
      'pao2Alveolar',
      'pao2',
      'spo2',
      'drive',
      'unloading',
      'ptp',
      'fatigueChange',
      'circulationMultiplier',
      'map',
      'sbp',
      'hr',
      'hfncPressure',
    ];

    for (const field of allFields) {
      const upText = getWhyTemplateText(field, 'up', '10', '20');
      const downText = getWhyTemplateText(field, 'down', '20', '10');
      const sameText = getWhyTemplateText(field, 'same', '15', '15');

      expect(upText.length).toBeGreaterThan(15);
      expect(downText.length).toBeGreaterThan(15);
      expect(sameText.length).toBeGreaterThan(15);
      expect(upText).toContain('10');
      expect(upText).toContain('20');
      expect(downText).toContain('20');
      expect(downText).toContain('10');
      expect(sameText).toContain('15');
    }
  });
});
