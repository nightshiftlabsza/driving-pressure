// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { DrillRunner } from './DrillRunner';
import { MemoryEventSink } from '../shared/eventSink';
import type { DrillItem } from './types';
import type { EngineApi, StepResult } from '../shared/engineTypes';

afterEach(() => {
  cleanup();
});

const MOCK_ITEMS: DrillItem[] = [
  {
    id: 'test-alarm-01',
    drillId: 'alarms',
    competency: 'safety.alarm-response',
    evidenceType: 'decision',
    category: 'alarm',
    stem: 'Patient has high peak pressure with normal plateau pressure. Audible secretions.',
    answerFormat: 'single-choice',
    options: [
      { id: 'opt-suction', text: 'Endotracheal suctioning' },
      { id: 'opt-chest-tube', text: 'Chest tube insertion' },
    ],
    answerKey: 'opt-suction',
    explanation: 'A widened peak-to-plateau gradient indicates high airway resistance from secretions.',
  },
  {
    id: 'test-wave-01',
    drillId: 'waveforms',
    competency: 'wave.incomplete-exhalation',
    evidenceType: 'interpretation',
    category: 'waveform',
    stem: 'What is shown by this waveform?',
    waveformConfig: {
      patient: {
        sex: 'M',
        ageYears: 65,
        heightCm: 175,
        actualWeightKg: 75,
        complianceMlPerCmH2O: 50,
        inspResistanceCmH2OPerLps: 12,
        expResistanceCmH2OPerLps: 28,
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        pmusInspTimeSec: 0,
        vco2MlPerMin: 200,
        vo2MlPerMin: 250,
        anatomicDeadSpaceMl: 150,
        alveolarDeadSpaceFraction: 0.2,
        shuntFraction: 0.1,
        recruitability: 0.2,
        hbGPerDl: 13,
        temperatureC: 37,
        baselineHco3MmolL: 24,
        hrBaselineBpm: 85,
        sbpBaselineMmHg: 120,
        dbpBaselineMmHg: 75,
        ppvResponse: 'unhelpful',
        ppvSeverity: 0.3,
        respiratoryReserve: 0.8,
      },
      device: {
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 5,
        rrSetBpm: 20,
        vtSetMl: 500,
      },
      nBreaths: 2,
    },
    answerFormat: 'single-choice',
    options: [
      { id: 'opt-auto-peep', text: 'Incomplete exhalation (auto-PEEP)' },
      { id: 'opt-leak', text: 'Circuit leak' },
    ],
    answerKey: 'opt-auto-peep',
    explanation: 'Flow does not reach zero before inspiration.',
  },
];

describe('DrillRunner Component', () => {
  it('ensures feedback is NOT in the DOM before submit', () => {
    const sink = new MemoryEventSink();
    render(
      <DrillRunner
        items={MOCK_ITEMS}
        sink={sink}
        sessionId="test-session-123"
        drillId="alarms"
      />
    );

    // Stem is visible
    expect(screen.getByText(/Patient has high peak pressure with normal plateau/i)).toBeTruthy();

    // Feedback elements must NOT be in the DOM before submit
    expect(screen.queryByTestId('drill-feedback-section')).toBeNull();
    expect(screen.queryByTestId('feedback-correct')).toBeNull();
    expect(screen.queryByTestId('feedback-incorrect')).toBeNull();
    expect(screen.queryByTestId('drill-explanation')).toBeNull();
    expect(screen.queryByText(/widened peak-to-plateau gradient/i)).toBeNull();

    // Submit button is disabled until both answer and confidence are selected
    const submitBtn = screen.getByTestId('submit-button');
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('records exactly one correct event with chosen confidence into MemoryEventSink on submit', async () => {
    const sink = new MemoryEventSink();
    render(
      <DrillRunner
        items={MOCK_ITEMS}
        sink={sink}
        sessionId="test-session-123"
        drillId="alarms"
      />
    );

    // Pick answer
    const option = screen.getByTestId('option-opt-suction');
    fireEvent.click(option);

    // Pick confidence
    const confidenceBtn = screen.getByTestId('confidence-certain');
    fireEvent.click(confidenceBtn);

    // Submit button should now be enabled
    const submitBtn = screen.getByTestId('submit-button');
    expect(submitBtn.hasAttribute('disabled')).toBe(false);

    // Click submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(sink.events.some((e) => e.type === 'drill_answer')).toBe(true);
    });

    const recordedEvent = sink.events.find((e) => e.type === 'drill_answer')!;
    expect(recordedEvent.type).toBe('drill_answer');
    if (recordedEvent.type === 'drill_answer') {
      expect(recordedEvent.competency).toBe('safety.alarm-response');
      expect(recordedEvent.evidenceType).toBe('decision');
      expect(recordedEvent.correct).toBe(true);
      expect(recordedEvent.confidence).toBe('certain');
      expect(recordedEvent.guidance).toBe('independent');
      expect(recordedEvent.hidden).toBe(false);
      expect(recordedEvent.hintsUsed).toBe(0);
      expect(recordedEvent.itemId).toBe('test-alarm-01');
      expect(recordedEvent.drillId).toBe('alarms');
      expect(recordedEvent.sessionId).toBe('test-session-123');
      expect(typeof recordedEvent.latencyMs).toBe('number');
    }

    // Now feedback is visible in the DOM
    expect(screen.getByTestId('drill-feedback-section')).toBeTruthy();
    expect(screen.getByTestId('feedback-correct')).toBeTruthy();
    expect(screen.getByTestId('drill-explanation')).toBeTruthy();
    expect(screen.getByText(/widened peak-to-plateau gradient/i)).toBeTruthy();
  });

  it('shows an honest data-error message when the engine throws', () => {
    const sink = new MemoryEventSink();

    // Engine double that throws "not implemented"
    const throwingEngine: EngineApi = {
      createState: vi.fn(),
      step: vi.fn(),
      fastForward: vi.fn(),
      setDevice: vi.fn(),
      setPatient: vi.fn(),
      startManoeuvre: vi.fn(),
      drawAbg: vi.fn(),
      simulateBreaths: () => {
        throw new Error('engine.simulateBreaths is not implemented yet');
      },
    };

    // Render starting with the waveform item (index 1)
    render(
      <DrillRunner
        items={[MOCK_ITEMS[1]]}
        sink={sink}
        engine={throwingEngine}
        sessionId="test-session-123"
        drillId="waveforms"
      />
    );

    // Honest message must be shown
    const errorBanner = screen.getByTestId('waveform-error-banner');
    expect(errorBanner).toBeTruthy();
    expect(
      screen.getByText('This waveform could not be drawn (item data error). Skip this item and report it.')
    ).toBeTruthy();

    // Skip button is provided
    const skipBtn = screen.getByTestId('skip-waveform-button');
    expect(skipBtn).toBeTruthy();

    // No fake SVG paths are rendered
    expect(screen.queryByTestId('waveform-path-pressure')).toBeNull();
  });

  it('renders waveform plot when a working engine double returns valid samples', () => {
    const sink = new MemoryEventSink();

    const mockStepResult: StepResult = {
      state: {} as any, // engine double internal
      breaths: [],
      samples: [
        {
          tSec: 0.0,
          pawCmH2O: 5,
          flowLps: 0,
          volumeMl: 0,
          pmusCmH2O: 0,
          phase: 'insp',
          breathType: 'mandatory',
        },
        {
          tSec: 0.5,
          pawCmH2O: 20,
          flowLps: 1.0,
          volumeMl: 300,
          pmusCmH2O: 0,
          phase: 'insp',
          breathType: 'mandatory',
        },
      ],
    };

    const workingEngine: EngineApi = {
      createState: vi.fn(),
      step: vi.fn(),
      fastForward: vi.fn(),
      setDevice: vi.fn(),
      setPatient: vi.fn(),
      startManoeuvre: vi.fn(),
      drawAbg: vi.fn(),
      simulateBreaths: vi.fn().mockReturnValue(mockStepResult),
    };

    render(
      <DrillRunner
        items={[MOCK_ITEMS[1]]}
        sink={sink}
        engine={workingEngine}
        sessionId="test-session-123"
        drillId="waveforms"
      />
    );

    // Waveform plot channels are rendered
    expect(screen.getByTestId('waveform-path-pressure')).toBeTruthy();
    expect(screen.getByTestId('waveform-path-flow')).toBeTruthy();
    expect(screen.getByTestId('waveform-path-volume')).toBeTruthy();
    expect(screen.queryByTestId('waveform-error-banner')).toBeNull();
  });

  it('handles multi-select items and computes correctness accordingly', async () => {
    const multiSelectItem: DrillItem = {
      id: 'test-multi-01',
      drillId: 'alarms',
      competency: 'safety.alarm-response',
      evidenceType: 'decision',
      category: 'alarm',
      stem: 'Select all immediate interventions for tension pneumothorax.',
      answerFormat: 'multi-select',
      options: [
        { id: 'opt-needle', text: 'Perform needle thoracostomy' },
        { id: 'opt-chest-tube', text: 'Prepare chest drainage tube' },
        { id: 'opt-paralyze', text: 'Paralyse and increase PEEP' },
      ],
      answerKey: ['opt-needle', 'opt-chest-tube'],
      explanation: 'Needle or finger decompression relieves tension immediately, followed by formal chest drain insertion.',
    };

    const sink = new MemoryEventSink();
    render(
      <DrillRunner
        items={[multiSelectItem]}
        sink={sink}
        sessionId="test-session-multi"
        drillId="alarms"
      />
    );

    // Toggle both correct options
    fireEvent.click(screen.getByTestId('option-opt-needle'));
    fireEvent.click(screen.getByTestId('option-opt-chest-tube'));

    // Select confidence
    fireEvent.click(screen.getByTestId('confidence-certain'));

    // Submit
    fireEvent.click(screen.getByTestId('submit-button'));

    await waitFor(() => {
      expect(sink.events.some((e) => e.type === 'drill_answer')).toBe(true);
    });

    const recorded = sink.events.find((e) => e.type === 'drill_answer')!;
    expect(recorded.type).toBe('drill_answer');
    if (recorded.type === 'drill_answer') {
      expect(recorded.correct).toBe(true);
      expect(recorded.answer).toEqual(['opt-needle', 'opt-chest-tube']);
    }
    expect(screen.getByTestId('feedback-correct')).toBeTruthy();
  });

  it('navigates through items and calls onFinish callback upon completing all drills', async () => {
    const sink = new MemoryEventSink();
    const onFinishSpy = vi.fn();

    render(
      <DrillRunner
        items={[MOCK_ITEMS[0]]}
        sink={sink}
        sessionId="test-finish-session"
        drillId="alarms"
        onFinish={onFinishSpy}
      />
    );

    // Answer and submit
    fireEvent.click(screen.getByTestId('option-opt-suction'));
    fireEvent.click(screen.getByTestId('confidence-fairly_sure'));
    fireEvent.click(screen.getByTestId('submit-button'));

    // Wait for submission to complete and Next button to appear
    const nextBtn = await screen.findByTestId('next-button');
    expect(nextBtn.textContent).toContain('View Results');
    fireEvent.click(nextBtn);

    // Finish screen should now be shown
    const finishBtn = screen.getByTestId('finish-button');
    expect(finishBtn).toBeTruthy();
    expect(screen.getByText(/1 \/ 1 \(100%\)/i)).toBeTruthy();

    fireEvent.click(finishBtn);
    expect(onFinishSpy).toHaveBeenCalledTimes(1);
  });

  it('handles missing engine gracefully by showing not-finished message', () => {
    const sink = new MemoryEventSink();

    render(
      <DrillRunner
        items={[MOCK_ITEMS[1]]}
        sink={sink}
        sessionId="test-session-123"
        drillId="waveforms"
      />
    );

    // Notice shown without throwing
    expect(
      screen.getByText('This waveform could not be drawn (item data error). Skip this item and report it.')
    ).toBeTruthy();

    // Options and submit button are hidden while waveform error is active
    expect(screen.queryByTestId('drill-options')).toBeNull();
    expect(screen.queryByTestId('submit-button')).toBeNull();
  });

  it('displays human-readable option text for expected answers on multi-select mistakes', async () => {
    const multiSelectItem: DrillItem = {
      id: 'test-multi-mistake',
      drillId: 'alarms',
      competency: 'safety.alarm-response',
      evidenceType: 'decision',
      category: 'alarm',
      stem: 'Select all immediate interventions.',
      answerFormat: 'multi-select',
      options: [
        { id: 'opt-a', text: 'Action Alpha' },
        { id: 'opt-b', text: 'Action Beta' },
        { id: 'opt-c', text: 'Action Gamma' },
      ],
      answerKey: ['opt-a', 'opt-b'],
      explanation: 'Both Alpha and Beta are required.',
    };

    const sink = new MemoryEventSink();
    render(
      <DrillRunner
        items={[multiSelectItem]}
        sink={sink}
        sessionId="test-session-multi-wrong"
        drillId="alarms"
      />
    );

    // Pick only one (incomplete) answer
    fireEvent.click(screen.getByTestId('option-opt-a'));
    fireEvent.click(screen.getByTestId('confidence-guess'));
    fireEvent.click(screen.getByTestId('submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-incorrect')).toBeTruthy();
    });

    // Feedback should show option texts "Action Alpha; Action Beta", NOT raw IDs "opt-a, opt-b"
    const feedbackEl = screen.getByTestId('feedback-incorrect');
    expect(feedbackEl.textContent).toContain('Action Alpha; Action Beta');
    expect(feedbackEl.textContent).not.toContain('opt-a, opt-b');
  });

  it('tracks skipped items when engine is unavailable and shows message on results screen', async () => {
    const sink = new MemoryEventSink();

    render(
      <DrillRunner
        items={[MOCK_ITEMS[1]]}
        sink={sink}
        sessionId="test-session-skip"
        drillId="waveforms"
      />
    );

    const skipBtn = screen.getByTestId('skip-waveform-button');
    fireEvent.click(skipBtn);

    // Reaches finished screen and shows skipped note
    expect(screen.getByText(/Drill Complete!/i)).toBeTruthy();
    expect(screen.getByText(/1 item skipped \(physiology engine not finished yet\)/i)).toBeTruthy();
  });

  it('records run_start, drill_answer with runId, and run_end on drill set completion so learner.listRuns() marks the drill Done', async () => {
    const sink = new MemoryEventSink();
    render(
      <DrillRunner
        items={[MOCK_ITEMS[0]]}
        sink={sink}
        sessionId="test-session-record-run"
        drillId="alarms"
      />
    );

    // Initial run_start event recorded
    expect(sink.events.length).toBeGreaterThanOrEqual(1);
    const startEvent = sink.events[0];
    expect(startEvent.type).toBe('run_start');
    expect(startEvent.activity).toBe('drill');
    expect(startEvent.activityId).toBe('alarms');
    expect(startEvent.runId).toBeTruthy();
    const runId = startEvent.runId!;

    // Answer item
    fireEvent.click(screen.getByTestId('option-opt-suction'));
    fireEvent.click(screen.getByTestId('confidence-certain'));
    fireEvent.click(screen.getByTestId('submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-correct')).toBeTruthy();
    });

    const answerEvent = sink.events.find((e) => e.type === 'drill_answer');
    expect(answerEvent).toBeTruthy();
    expect(answerEvent?.runId).toBe(runId);

    // Advance to end
    fireEvent.click(screen.getByTestId('next-button'));

    expect(screen.getByText(/Drill Complete!/i)).toBeTruthy();

    const endEvent = sink.events.find((e) => e.type === 'run_end');
    expect(endEvent).toBeTruthy();
    expect(endEvent?.runId).toBe(runId);
    expect(endEvent?.activity).toBe('drill');
    expect(endEvent?.activityId).toBe('alarms');
    if (endEvent?.type === 'run_end') {
      expect(endEvent.outcome).toBe('completed');
    }
  });
});
