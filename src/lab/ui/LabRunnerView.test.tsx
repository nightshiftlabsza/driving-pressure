// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { LabRunnerView } from './LabRunnerView';
import type { LabExperiment } from '../schema';
import { LAB_TEST_IDS } from '../schema';
import { engine } from '../../engine';
import { MemoryEventSink } from '../../shared/eventSink';
import type { LearnerApi } from '../../shared/learnerApi';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 0 }),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
});

const sampleExperiment: LabExperiment = {
  schemaVersion: '1.0',
  id: '01-peep-titration',
  number: 1,
  title: 'PEEP Titration in ARDS',
  subtitle: 'Observe changes in driving pressure and compliance',
  difficulty: 2,
  competencies: ['mechanics.driving-pressure', 'oxygenation.peep-titration'],
  contextTags: ['ards', 'peep'],
  ruleBased: false,
  patient: {
    displayName: 'Test Patient',
    summary: 'Severe ARDS with low compliance',
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
  baselineSimSec: 5,
  variable: {
    target: 'device',
    field: 'peep',
    label: 'PEEP',
    unit: 'cmH2O',
    baselineValue: 5,
    options: [
      { label: 'PEEP 12', value: 12 },
      { label: 'PEEP 16', value: 16 },
    ],
  },
  prediction: {
    question: 'How will increasing PEEP to 12 affect Ppeak and Driving Pressure?',
    metrics: ['ppeak', 'drivingPressure'],
  },
  observeSimSec: 5,
  whatToLookAtHint: 'Check the plateau pressure and end-expiratory baseline.',
  reflection: {
    question: 'Why did driving pressure change?',
    options: [
      { id: 'opt-recruitment', text: 'Alveolar recruitment reduced elastance' },
      { id: 'opt-overdistension', text: 'Overdistension occurred' },
    ],
    correctOptionId: 'opt-recruitment',
    explanation: 'Recruitment increased the aerated lung volume and compliance.',
  },
  causalChainFields: ['setPeep', 'recruitedFraction', 'compliance', 'drivingPressure'],
  evidence: [
    {
      claim: 'PEEP titration reduces driving pressure in recruitable ARDS',
      source: 'Amato MB et al. N Engl J Med',
      year: 2015,
      kind: 'observational',
    },
  ],
};

function createMockLearner(sink: MemoryEventSink): LearnerApi {
  return {
    ...sink,
    record: (e) => sink.record(e),
    getCompetencyStates: vi.fn().mockResolvedValue([]),
    setGuidanceOverride: vi.fn().mockResolvedValue(undefined),
    getRun: vi.fn().mockResolvedValue(null),
    listRuns: vi.fn().mockResolvedValue([]),
    recommend: vi.fn().mockResolvedValue([]),
    exportJson: vi.fn().mockResolvedValue('{}'),
    importJson: vi.fn().mockResolvedValue(undefined),
    resetAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe('LabRunnerView', () => {
  it('renders initial baseline and predict stage without spoon-feeding answers', () => {
    const handleBack = vi.fn();
    render(
      <LabRunnerView
        experiment={sampleExperiment}
        engine={engine}
        onBack={handleBack}
      />
    );

    // 1. Runner and Stage Badge
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_RUNNER)).toBeTruthy();
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_STAGE_BADGE).textContent).toContain('1. Baseline & Predict');

    // 2. Hint & Variable select
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_HINT)).toBeTruthy();
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_HINT).textContent).toContain('Check the plateau pressure');
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_VARIABLE_SELECT)).toBeTruthy();

    // 3. Prediction panel & Commit button
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_PREDICTION_PANEL)).toBeTruthy();
    const commitBtn = screen.getByTestId(LAB_TEST_IDS.LAB_COMMIT_BTN) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);

    // 4. CRITICAL NO SPOON-FEEDING:
    // Before commit, Before/After table and Reflection panel MUST NOT exist
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_BEFORE_AFTER_TABLE)).toBeNull();
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_REFLECTION_PANEL)).toBeNull();

    // Causal Why view MUST be strictly locked
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_WHY_LOCKED)).toBeTruthy();
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeNull();

    // Explanation text MUST NOT be visible anywhere
    expect(screen.queryByText(/Recruitment increased the aerated lung volume/)).toBeNull();

    // 5. Back button
    fireEvent.click(screen.getByTestId(LAB_TEST_IDS.LAB_BACK_BTN));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('enables commit button only after all directions and confidence are selected', () => {
    render(<LabRunnerView experiment={sampleExperiment} engine={engine} />);

    const commitBtn = screen.getByTestId(LAB_TEST_IDS.LAB_COMMIT_BTN) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);

    // Select direction for ppeak (Increase)
    const incButtons = screen.getAllByRole('button', { name: /↑ Increase/i });
    fireEvent.click(incButtons[0]);
    expect(commitBtn.disabled).toBe(true);

    // Select direction for drivingPressure (Decrease)
    const decButtons = screen.getAllByRole('button', { name: /↓ Decrease/i });
    fireEvent.click(decButtons[1]);
    expect(commitBtn.disabled).toBe(true);

    // Select confidence
    fireEvent.click(screen.getByTestId(`${LAB_TEST_IDS.LAB_CONFIDENCE_PREFIX}fairly_sure`));

    // Now commit button should be enabled
    expect(commitBtn.disabled).toBe(false);
  });

  it('progresses to Observe and Reflection on Commit and records learner events', async () => {
    const sink = new MemoryEventSink();
    const learner = createMockLearner(sink);

    render(
      <LabRunnerView
        experiment={sampleExperiment}
        engine={engine}
        learner={learner}
      />
    );

    // 1. Verify run_start was recorded
    expect(sink.events.length).toBeGreaterThanOrEqual(1);
    expect(sink.events[0].type).toBe('run_start');

    // 2. Make predictions and choose confidence
    const incButtons = screen.getAllByRole('button', { name: /↑ Increase/i });
    fireEvent.click(incButtons[0]); // ppeak up

    const decButtons = screen.getAllByRole('button', { name: /↓ Decrease/i });
    fireEvent.click(decButtons[1]); // drivingPressure down

    fireEvent.click(screen.getByTestId(`${LAB_TEST_IDS.LAB_CONFIDENCE_PREFIX}certain`));

    // 3. Commit
    const commitBtn = screen.getByTestId(LAB_TEST_IDS.LAB_COMMIT_BTN);
    fireEvent.click(commitBtn);

    // Stage changes to Observe
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_STAGE_BADGE).textContent).toContain('2. Apply & Observe');

    // Prediction event recorded to sink
    const predictionEvents = sink.events.filter((e) => e.type === 'prediction');
    expect(predictionEvents.length).toBeGreaterThanOrEqual(1);

    // Before / After table is now rendered
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_BEFORE_AFTER_TABLE)).toBeTruthy();

    // Reflection panel is now rendered
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_REFLECTION_PANEL)).toBeTruthy();

    // In Stage 2, Causal Why view remains locked until reflection submission (P0-4)
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_WHY_LOCKED)).toBeTruthy();
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeNull();

    // 4. Submit Reflection
    const submitReflBtn = screen.getByTestId(LAB_TEST_IDS.LAB_REFLECTION_SUBMIT) as HTMLButtonElement;
    expect(submitReflBtn.disabled).toBe(true);

    // Click option
    fireEvent.click(screen.getByTestId(`${LAB_TEST_IDS.LAB_REFLECTION_OPT_PREFIX}opt-recruitment`));
    expect(submitReflBtn.disabled).toBe(false);

    fireEvent.click(submitReflBtn);

    // Stage changes to Reflect / Synthesis
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_STAGE_BADGE).textContent).toContain('3. Reflection & Synthesis');

    // Causal Why view is now unlocked after reflection submission!
    expect(screen.queryByTestId(LAB_TEST_IDS.LAB_WHY_LOCKED)).toBeNull();
    expect(screen.getByTestId(LAB_TEST_IDS.LAB_WHY_VIEW)).toBeTruthy();
    expect(screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}setPeep`)).toBeTruthy();
    expect(screen.getByTestId(`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}drivingPressure`)).toBeTruthy();

    // Reflection explanation is now displayed
    expect(screen.getByText(/Recruitment increased the aerated lung volume and compliance/)).toBeTruthy();

    // Reflection event and run_end recorded
    const runEndEvents = sink.events.filter((e) => e.type === 'run_end');
    expect(runEndEvents.length).toBe(1);
    expect(runEndEvents[0].type === 'run_end' && runEndEvents[0].outcome).toBe('completed');
  });

  it('supports custom renderWhyView prop when provided', () => {
    const customWhySpy = vi.fn().mockImplementation(({ committed }: { committed: boolean }) => (
      <div data-testid="custom-why">{committed ? 'Unlocked Why' : 'Locked Why'}</div>
    ));

    render(
      <LabRunnerView
        experiment={sampleExperiment}
        engine={engine}
        renderWhyView={customWhySpy}
      />
    );

    expect(screen.getByTestId('custom-why')).toBeTruthy();
    expect(screen.getByTestId('custom-why').textContent).toBe('Locked Why');
    expect(customWhySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        committed: false,
        experiment: sampleExperiment,
      })
    );
  });
});
