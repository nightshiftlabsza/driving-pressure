import { describe, it, expect } from 'vitest';
import {
  labMetricOf,
  markDirection,
  applyVariableOption,
  runExperimentHeadless,
  toActivityCandidate,
  recordLabRunStart,
  recordLabPrediction,
  recordLabReflection,
  recordLabRunEnd,
} from './runner';
import type { LabExperiment } from './schema';
import { engine } from '../engine';
import { MemoryEventSink } from '../shared/eventSink';
import type { EngineState } from '../shared/engineTypes';

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
  baselineSimSec: 10,
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
    question: 'How will increasing PEEP to 12 cmH2O affect Ppeak and Driving Pressure?',
    metrics: ['ppeak', 'drivingPressure'],
  },
  observeSimSec: 10,
  whatToLookAtHint: 'Check the plateau pressure and end-expiratory baseline.',
  reflection: {
    question: 'Why did driving pressure change?',
    options: [
      { id: 'opt-recruitment', text: 'Alveolar recruitment reduced elastance' },
      { id: 'opt-overdistension', text: 'Overdistension occurred' },
    ],
    correctOptionId: 'opt-recruitment',
    explanation: 'Recruitment increased the aerated lung volume.',
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

describe('lab runner', () => {
  it('evaluates lab metrics including base metrics and extended breath metrics', () => {
    const s = engine.createState(sampleExperiment.patient.params, sampleExperiment.initialDevice);
    // Baseline state
    expect(typeof labMetricOf(s, 'peep')).toBe('number');
    expect(typeof labMetricOf(s, 'ppeak')).toBe('number');

    // Synthetic breath for breath-level metrics
    const fakeState: EngineState = {
      ...s,
      lastBreath: {
        endTimeSec: 3,
        breathType: 'mandatory',
        vtiMl: 420,
        vteMl: 420,
        ppeakCmH2O: 25,
        pmeanCmH2O: 10,
        tiSec: 1,
        teSec: 2,
        endExpFlowLps: -0.15,
        leakLpm: 0,
        ineffectiveEfforts: 2,
      },
    };

    expect(labMetricOf(fakeState, 'endExpFlow')).toBeCloseTo(0.15);
    expect(labMetricOf(fakeState, 'ineffectiveEfforts')).toBe(2);

    const noBreathState: EngineState = { ...s, lastBreath: null };
    expect(labMetricOf(noBreathState, 'endExpFlow')).toBeNull();
    expect(labMetricOf(noBreathState, 'ineffectiveEfforts')).toBe(0);
  });

  it('marks direction according to LAB_NOISE_BAND', () => {
    // peep noise band is 0.5
    expect(markDirection(5, 5.2, 'peep')).toBe('same');
    expect(markDirection(5, 5.8, 'peep')).toBe('up');
    expect(markDirection(5, 4.2, 'peep')).toBe('down');
    expect(markDirection(null, 5, 'peep')).toBe('same');
    expect(markDirection(5, null, 'peep')).toBe('same');
  });

  it('applies variable options for device and patient targets and overrides', () => {
    const s = engine.createState(sampleExperiment.patient.params, sampleExperiment.initialDevice);
    // Default option (index 0: PEEP 12)
    const applied0 = applyVariableOption(engine, s, sampleExperiment.variable, 0);
    expect((applied0.device as { peep: number }).peep).toBe(12);

    // Option index 1 (PEEP 16)
    const applied1 = applyVariableOption(engine, s, sampleExperiment.variable, 1);
    expect((applied1.device as { peep: number }).peep).toBe(16);

    // Patient variable
    const patientVar = {
      target: 'patient' as const,
      field: 'complianceMlPerCmH2O',
      label: 'Compliance',
      unit: 'mL/cmH2O',
      baselineValue: 20,
      options: [{ label: 'Stiff lung', value: 15 }],
    };
    const appliedPatient = applyVariableOption(engine, s, patientVar, 0);
    expect(appliedPatient.patient.complianceMlPerCmH2O).toBe(15);

    // Override option
    const overrideVar = {
      target: 'device' as const,
      field: 'unused',
      label: 'Combined Override',
      unit: '',
      baselineValue: 0,
      options: [
        {
          label: 'Combo',
          value: 0,
          deviceOverride: { ...s.device, fio2: 0.9 },
          patientOverride: { actualWeightKg: 80 },
        },
      ],
    };
    const appliedOverride = applyVariableOption(engine, s, overrideVar, 0);
    expect((appliedOverride.device as { fio2: number }).fio2).toBe(0.9);
    expect(appliedOverride.patient.actualWeightKg).toBe(80);
  });

  it('runs an experiment headlessly and returns deterministic metrics and answer key', () => {
    const res = runExperimentHeadless(engine, sampleExperiment, 0);
    expect(res.baselineState).toBeDefined();
    expect(res.afterState).toBeDefined();
    expect(res.baselineSamples.length).toBeGreaterThan(0);
    expect(res.afterSamples.length).toBeGreaterThan(0);
    expect(res.baselineMetrics.peep).toBeDefined();
    expect(res.afterMetrics.peep).toBeDefined();
    expect(res.answerKey).toBeDefined();
    expect(res.answerKey.ppeak).toMatch(/^(up|down|same)$/);
    expect(res.answerKey.drivingPressure).toMatch(/^(up|down|same)$/);
  });

  it('converts experiment to ActivityCandidate', () => {
    const candidate = toActivityCandidate(sampleExperiment);
    expect(candidate.activity).toBe('lab');
    expect(candidate.id).toBe(sampleExperiment.id);
    expect(candidate.competencies).toEqual(sampleExperiment.competencies);
    expect(candidate.contextTags).toEqual(sampleExperiment.contextTags);
    expect(candidate.difficulty).toBe(sampleExperiment.difficulty);
    expect(candidate.hiddenCompetencies).toEqual([]);
  });

  it('records lab events to EventSink correctly', async () => {
    const sink = new MemoryEventSink();

    // 1. Run start
    const runId = await recordLabRunStart(sink, sampleExperiment, 'run-123');
    expect(runId).toBe('run-123');
    expect(sink.events.length).toBe(1);
    const startEvent = sink.events[0];
    expect(startEvent.type).toBe('run_start');
    expect(startEvent.activity).toBe('lab');
    expect(startEvent.activityId).toBe(sampleExperiment.id);

    // 2. Prediction (correct)
    await recordLabPrediction(sink, sampleExperiment, {
      runId,
      answer: { ppeak: 'up', drivingPressure: 'down' },
      expected: { ppeak: 'up', drivingPressure: 'down' },
      correct: true,
      confidence: 'fairly_sure',
    });
    expect(sink.events.length).toBe(2);
    const predEvent = sink.events[1];
    expect(predEvent.type).toBe('prediction');
    if (predEvent.type === 'prediction') {
      expect(predEvent.evidenceType).toBe('prediction');
      expect(predEvent.correct).toBe(true);
      expect(predEvent.confidence).toBe('fairly_sure');
      expect(predEvent.guidance).toBe('independent');
      expect(predEvent.hidden).toBe(false);
    }

    // 3. Prediction with calibration error (certain + incorrect -> emits mistake)
    await recordLabPrediction(sink, sampleExperiment, {
      runId,
      answer: { ppeak: 'down', drivingPressure: 'up' },
      expected: { ppeak: 'up', drivingPressure: 'down' },
      correct: false,
      confidence: 'certain',
    });
    // Two new events: prediction + mistake
    expect(sink.events.length).toBe(4);
    const mistakeEvent = sink.events[3];
    expect(mistakeEvent.type).toBe('mistake');
    if (mistakeEvent.type === 'mistake') {
      expect(mistakeEvent.mistake).toBe('calibration_error');
      expect(mistakeEvent.competency).toBe(sampleExperiment.competencies[0]);
    }

    // 4. Reflection
    await recordLabReflection(sink, sampleExperiment, {
      runId,
      selectedOptionId: 'opt-recruitment',
    });
    expect(sink.events.length).toBe(5);
    const reflEvent = sink.events[4];
    expect(reflEvent.type).toBe('prediction');
    if (reflEvent.type === 'prediction') {
      expect(reflEvent.predictionId).toBe(`${sampleExperiment.id}-reflection`);
      expect(reflEvent.evidenceType).toBe('interpretation');
      expect(reflEvent.competency).toBe(sampleExperiment.competencies[1]);
      expect(reflEvent.correct).toBe(true);
    }

    // 5. Run end
    await recordLabRunEnd(sink, sampleExperiment, { runId, outcome: 'completed' });
    expect(sink.events.length).toBe(6);
    const endEvent = sink.events[5];
    expect(endEvent.type).toBe('run_end');
    if (endEvent.type === 'run_end') {
      expect(endEvent.outcome).toBe('completed');
    }
  });
});
