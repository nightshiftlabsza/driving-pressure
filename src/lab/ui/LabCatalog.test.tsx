// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { LabCatalog } from './LabCatalog';
import type { LabExperiment } from '../schema';
import { LAB_TEST_IDS } from '../schema';
import type { LearnerApi, Recommendation } from '../../shared/learnerApi';

afterEach(() => {
  cleanup();
});

const sampleExperiments: LabExperiment[] = [
  {
    schemaVersion: '1.0',
    id: '01-peep-titration',
    number: 1,
    title: 'PEEP Titration in ARDS',
    subtitle: 'Observe changes in driving pressure and compliance',
    difficulty: 2,
    competencies: ['mechanics.driving-pressure'],
    contextTags: ['ards', 'peep'],
    ruleBased: false,
    patient: {
      displayName: 'Patient 1',
      summary: 'ARDS',
      params: {
        sex: 'M',
        ageYears: 55,
        heightCm: 175,
        actualWeightKg: 75,
        complianceMlPerCmH2O: 20,
        inspResistanceCmH2OPerLps: 8,
        expResistanceCmH2OPerLps: 10,
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        pmusInspTimeSec: 1,
        vco2MlPerMin: 200,
        vo2MlPerMin: 250,
        anatomicDeadSpaceMl: 150,
        alveolarDeadSpaceFraction: 0.2,
        shuntFraction: 0.3,
        recruitability: 0.3,
        hbGPerDl: 12,
        temperatureC: 37,
        baselineHco3MmolL: 24,
        hrBaselineBpm: 80,
        sbpBaselineMmHg: 120,
        dbpBaselineMmHg: 80,
        ppvResponse: 'unhelpful',
        ppvSeverity: 0.5,
        respiratoryReserve: 0.8,
      },
    },
    initialDevice: {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.6,
      peep: 5,
      rrSetBpm: 20,
      vtSetMl: 420,
      inspFlowLpm: 60,
      flowPattern: 'square',
      triggerFlowLpm: 2,
    },
    baselineSimSec: 10,
    variable: {
      target: 'device',
      field: 'peep',
      label: 'PEEP',
      unit: 'cmH2O',
      baselineValue: 5,
      options: [{ label: 'PEEP 12', value: 12 }],
    },
    prediction: {
      question: 'Will driving pressure improve?',
      metrics: ['ppeak', 'drivingPressure'],
    },
    observeSimSec: 10,
    whatToLookAtHint: 'Look at Pplat and PEEP.',
    reflection: {
      question: 'What explains the change?',
      options: [
        { id: 'opt-rec', text: 'Recruitment' },
        { id: 'opt-over', text: 'Overdistension' },
      ],
      correctOptionId: 'opt-rec',
      explanation: 'Recruitment occurred.',
    },
    causalChainFields: ['setPeep', 'recruitedFraction', 'compliance'],
    evidence: [
      {
        claim: 'PEEP recruitment',
        source: 'Amato 2015',
        year: 2015,
        kind: 'observational',
      },
    ],
  },
  {
    schemaVersion: '1.0',
    id: '02-flow-starvation',
    number: 2,
    title: 'Flow Starvation in VC-AC',
    subtitle: 'Observe patient work and airway pressure dip',
    difficulty: 1,
    competencies: ['asynchrony.flow-starvation'],
    contextTags: ['copd', 'asynchrony'],
    ruleBased: true,
    ruleBasedNote: 'Simulated patient effort with flow mismatch',
    patient: {
      displayName: 'Patient 2',
      summary: 'High drive',
      params: {
        sex: 'F',
        ageYears: 48,
        heightCm: 165,
        actualWeightKg: 65,
        complianceMlPerCmH2O: 50,
        inspResistanceCmH2OPerLps: 15,
        expResistanceCmH2OPerLps: 15,
        spontRateBpm: 25,
        pmusAmplitudeCmH2O: 12,
        pmusInspTimeSec: 0.8,
        vco2MlPerMin: 220,
        vo2MlPerMin: 260,
        anatomicDeadSpaceMl: 130,
        alveolarDeadSpaceFraction: 0.15,
        shuntFraction: 0.1,
        recruitability: 0.1,
        hbGPerDl: 13,
        temperatureC: 37,
        baselineHco3MmolL: 24,
        hrBaselineBpm: 85,
        sbpBaselineMmHg: 125,
        dbpBaselineMmHg: 80,
        ppvResponse: 'unhelpful',
        ppvSeverity: 0.3,
        respiratoryReserve: 0.6,
      },
    },
    initialDevice: {
      device: 'invasive',
      mode: 'VC-AC',
      fio2: 0.4,
      peep: 5,
      rrSetBpm: 15,
      vtSetMl: 450,
      inspFlowLpm: 35,
      flowPattern: 'square',
      triggerFlowLpm: 2,
    },
    baselineSimSec: 10,
    variable: {
      target: 'device',
      field: 'inspFlowLpm',
      label: 'Inspiratory Flow',
      unit: 'L/min',
      baselineValue: 35,
      options: [{ label: 'Flow 65 L/min', value: 65 }],
    },
    prediction: {
      question: 'How will increasing flow affect Paw waveform dipping?',
      metrics: ['ppeak', 'pmean'],
    },
    observeSimSec: 10,
    whatToLookAtHint: 'Look at the Paw curve during inspiration.',
    reflection: {
      question: 'Why did the patient feel more comfortable?',
      options: [
        { id: 'opt-flow', text: 'Flow matched patient demand' },
        { id: 'opt-peep', text: 'PEEP was higher' },
      ],
      correctOptionId: 'opt-flow',
      explanation: 'Matching peak inspiratory flow relieves flow hunger.',
    },
    causalChainFields: ['setInspFlow', 'tiSec', 'drivingPressure'],
    evidence: [
      {
        claim: 'Flow starvation causes scalloping',
        source: 'Tobin 2006',
        year: 2006,
        kind: 'textbook',
      },
    ],
  },
];

describe('LabCatalog', () => {
  it('renders the experiment list and individual cards', () => {
    const handleSelect = vi.fn();
    render(<LabCatalog experiments={sampleExperiments} onSelectExperiment={handleSelect} />);

    expect(screen.getByTestId(LAB_TEST_IDS.LAB_LIST)).toBeTruthy();
    expect(screen.getByTestId(`${LAB_TEST_IDS.LAB_CARD_PREFIX}01-peep-titration`)).toBeTruthy();
    expect(screen.getByTestId(`${LAB_TEST_IDS.LAB_CARD_PREFIX}02-flow-starvation`)).toBeTruthy();

    expect(screen.getByText('PEEP Titration in ARDS')).toBeTruthy();
    expect(screen.getByText('Flow Starvation in VC-AC')).toBeTruthy();
    expect(screen.getByText('mechanics.driving-pressure')).toBeTruthy();
  });

  it('renders the rule-based badge for experiments marked ruleBased', () => {
    render(<LabCatalog experiments={sampleExperiments} onSelectExperiment={vi.fn()} />);

    const badge = screen.getByTestId(LAB_TEST_IDS.LAB_RULE_BASED_BADGE);
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Rule-based');
  });

  it('calls onSelectExperiment when Start Experiment is clicked', () => {
    const handleSelect = vi.fn();
    render(<LabCatalog experiments={sampleExperiments} onSelectExperiment={handleSelect} />);

    const startButtons = screen.getAllByRole('button', { name: /start experiment/i });
    fireEvent.click(startButtons[0]);
    expect(handleSelect).toHaveBeenCalledWith(sampleExperiments[0]);
  });

  it('fetches and displays recommendations from learner model', async () => {
    const mockRecs: Recommendation[] = [
      {
        id: '02-flow-starvation',
        score: 0.95,
        reasons: ['Asynchrony is due for review', 'High yield topic'],
      },
    ];

    const mockLearner: Partial<LearnerApi> = {
      recommend: vi.fn().mockResolvedValue(mockRecs),
    };

    render(
      <LabCatalog
        experiments={sampleExperiments}
        onSelectExperiment={vi.fn()}
        learner={mockLearner as LearnerApi}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Recommended')).toBeTruthy();
    });

    expect(screen.getByText(/Asynchrony is due for review/)).toBeTruthy();
  });
});
