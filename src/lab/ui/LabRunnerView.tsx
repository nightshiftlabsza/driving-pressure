import React, { useEffect, useMemo, useState } from 'react';
import type {
  EngineApi,
  EngineState,
  WaveformSample,
} from '../../shared/engineTypes';
import {
  LAB_TEST_IDS,
  type Direction,
  type LabExperiment,
  type LabMetric,
} from '../schema';
import {
  runExperimentHeadless,
  recordLabRunStart,
  recordLabPrediction,
  recordLabReflection,
  recordLabRunEnd,
  type HeadlessExperimentResult,
} from '../runner';
import type { LearnerApi } from '../../shared/learnerApi';
import type { Confidence } from '../../shared/events';
import { newId } from '../../shared/eventSink';
import { SharedVentDisplay } from '../../display/SharedVentDisplay';
import { defaultLimitsFor, acknowledgeAlarm, isAlarmSilenced, silenceAlarms, type AlarmState } from '../../alarms';
import { WhyView, captureWhySnapshot, buildCausalChain } from '../why';
import { TutorPanel } from '../../tutor/TutorPanel';
import { buildLabContext } from '../../tutor/context';
import { computeHelpLevelCap } from '../../tutor/policy';

export interface LabRunnerViewProps {
  experiment: LabExperiment;
  engine: EngineApi;
  learner?: LearnerApi;
  onBack?: () => void;
  renderWhyView?: (props: {
    experiment: LabExperiment;
    committed: boolean;
    baselineState: EngineState;
    afterState: EngineState | null;
  }) => React.ReactNode;
}

export type LabStage = 'predict' | 'observe' | 'reflect';

function formatMetricName(metric: LabMetric): string {
  const map: Record<string, string> = {
    ppeak: 'Ppeak (Peak Airway Pressure)',
    pplat: 'Pplat (Plateau Pressure)',
    drivingPressure: 'Driving Pressure (ΔP)',
    peep: 'PEEP',
    pmean: 'Mean Airway Pressure (Pmean)',
    vte: 'Exhaled Tidal Volume (VTe)',
    vteMlKgPbw: 'VTe / kg PBW',
    minuteVent: 'Minute Ventilation (VE)',
    rrTotal: 'Total Respiratory Rate',
    spo2: 'SpO2 (Oxygen Saturation)',
    pao2: 'PaO2',
    paco2: 'PaCO2',
    ph: 'Arterial pH',
    etco2: 'End-Tidal CO2 (EtCO2)',
    autoPeep: 'Intrinsic PEEP (Auto-PEEP)',
    endExpFlow: 'End-Expiratory Flow',
    ineffectiveEfforts: 'Ineffective Trigger Efforts',
    hfncPressure: 'HFNC CPAP Effect',
  };
  return map[metric] ?? metric;
}

function formatMetricValue(m: string, val: number | null): string {
  if (val === null || val === undefined) return '—';
  switch (m) {
    case 'ph':
      return val.toFixed(2);
    case 'spo2':
      return `${val.toFixed(0)}%`;
    case 'paco2':
    case 'pao2':
    case 'etco2':
    case 'map':
    case 'sbp':
      return `${val.toFixed(0)} mmHg`;
    case 'ppeak':
    case 'pplat':
    case 'peep':
    case 'drivingPressure':
    case 'pmean':
    case 'autoPeep':
    case 'hfncPressure':
    case 'hfncPaw':
      return `${val.toFixed(1)} cmH2O`;
    case 'vte':
      return `${val.toFixed(0)} mL`;
    case 'vteMlKgPbw':
      return `${val.toFixed(1)} mL/kg`;
    case 'minuteVent':
      return `${val.toFixed(1)} L/min`;
    case 'rrTotal':
    case 'rrSpont':
    case 'hr':
      return `${val.toFixed(0)} bpm`;
    case 'fio2':
      return `${Math.round(val <= 1 ? val * 100 : val)}%`;
    case 'endExpFlow':
      return `${val.toFixed(2)} L/s`;
    case 'ineffectiveEfforts':
      return `${val.toFixed(0)}`;
    default:
      return typeof val === 'number' ? val.toFixed(1) : String(val);
  }
}

function directionSymbol(dir: Direction): string {
  switch (dir) {
    case 'up':
      return '↑ Increase';
    case 'down':
      return '↓ Decrease';
    case 'same':
      return '↔ No change';
  }
}

export const LabRunnerView: React.FC<LabRunnerViewProps> = ({
  experiment,
  engine,
  learner,
  onBack,
  renderWhyView,
}) => {
  const [runId] = useState<string>(() => newId());
  const [sessionId] = useState<string>('lab-session');
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number>(0);
  const [stage, setStage] = useState<LabStage>('predict');
  const [predictions, setPredictions] = useState<Record<string, Direction>>({});
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [committed, setCommitted] = useState<boolean>(false);
  const [selectedReflectionOpt, setSelectedReflectionOpt] = useState<string | null>(null);
  const [reflectionSubmitted, setReflectionSubmitted] = useState<boolean>(false);
  const [startMs] = useState<number>(() => Date.now());
  const [commitMs, setCommitMs] = useState<number | null>(null);
  const [alarmState, setAlarmState] = useState<AlarmState>({ alarms: [] });

  // Compute deterministic simulation for the chosen option
  const simResult: HeadlessExperimentResult = useMemo(() => {
    return runExperimentHeadless(engine, experiment, selectedOptionIndex);
  }, [engine, experiment, selectedOptionIndex]);

  // Snapshots for the Causal "Why" view
  const baselineSnapshot = useMemo(
    () => captureWhySnapshot(simResult.baselineState),
    [simResult.baselineState]
  );
  const afterSnapshot = useMemo(
    () => (committed ? captureWhySnapshot(simResult.afterState) : null),
    [committed, simResult.afterState]
  );

  // Record run_start on mount
  useEffect(() => {
    if (learner) {
      recordLabRunStart(learner, experiment, runId, sessionId).catch((err) => {
        console.warn('Failed to record lab run start:', err);
      });
    }
  }, [learner, experiment, runId, sessionId]);

  // Active ventilator display state: baseline before commit, afterState after commit
  const activeEngineState: EngineState = committed
    ? simResult.afterState
    : simResult.baselineState;

  const activeSamples: WaveformSample[] = committed
    ? simResult.afterSamples
    : simResult.baselineSamples;

  const allMetricsPredicted = useMemo(() => {
    return experiment.prediction.metrics.every(
      (m) => predictions[m] === 'up' || predictions[m] === 'down' || predictions[m] === 'same'
    );
  }, [experiment.prediction.metrics, predictions]);

  const canCommit = allMetricsPredicted && confidence !== null && !committed;

  const handleCommit = () => {
    if (!canCommit) return;
    const now = Date.now();
    setCommitMs(now);
    setCommitted(true);
    setStage('observe');

    const isPredictionCorrect = experiment.prediction.metrics.every(
      (m) => predictions[m] === simResult.answerKey[m]
    );

    if (learner && confidence) {
      recordLabPrediction(learner, experiment, {
        runId,
        sessionId,
        answer: predictions,
        expected: simResult.answerKey,
        correct: isPredictionCorrect,
        confidence,
        latencyMs: now - startMs,
      }).catch((err) => {
        console.warn('Failed to record lab prediction:', err);
      });
    }
  };

  const handleReflectionSubmit = () => {
    if (!selectedReflectionOpt || reflectionSubmitted) return;
    setReflectionSubmitted(true);
    setStage('reflect');

    if (learner) {
      const now = Date.now();
      const latencyMs = commitMs ? now - commitMs : undefined;

      recordLabReflection(learner, experiment, {
        runId,
        sessionId,
        selectedOptionId: selectedReflectionOpt,
        latencyMs,
      }).catch((err) => {
        console.warn('Failed to record lab reflection:', err);
      });

      recordLabRunEnd(learner, experiment, {
        runId,
        sessionId,
        outcome: 'completed',
      }).catch((err) => {
        console.warn('Failed to record lab run end:', err);
      });
    }
  };

  const stageLabel = useMemo(() => {
    switch (stage) {
      case 'predict':
        return '1. Baseline & Predict';
      case 'observe':
        return '2. Apply & Observe';
      case 'reflect':
        return '3. Reflection & Synthesis';
    }
  }, [stage]);

  return (
    <div
      data-testid={LAB_TEST_IDS.LAB_RUNNER}
      className="flex flex-col w-full h-full overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Top Navbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b text-xs"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid={LAB_TEST_IDS.LAB_BACK_BTN}
            onClick={onBack}
            className="px-2.5 py-1 rounded transition-colors flex items-center gap-1 font-medium border"
            style={{
              background: 'var(--surface-3)',
              borderColor: 'var(--line)',
              color: 'var(--text-2)',
            }}
          >
            <span>←</span>
            <span>Back to Experiments</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
              Lab #{experiment.number}: {experiment.title}
            </span>
            <span
              data-testid={LAB_TEST_IDS.LAB_STAGE_BADGE}
              className="px-2 py-0.5 rounded text-[11px] font-semibold"
              style={{
                background: 'var(--sel-subtle)',
                color: 'var(--sel)',
                border: '1px solid var(--line-strong)',
              }}
            >
              {stageLabel}
            </span>
            {experiment.ruleBased && (
              <span
                data-testid={LAB_TEST_IDS.LAB_RULE_BASED_BADGE}
                title={experiment.ruleBasedNote}
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  background: 'var(--surface-3)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--line)',
                }}
              >
                Rule-based
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={LAB_TEST_IDS.LAB_WHY_TAB_BTN}
            onClick={() => {
              document.getElementById('lab-why-anchor')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-3 py-1 rounded font-semibold transition-colors flex items-center gap-1 border"
            style={{
              background: 'var(--surface-3)',
              borderColor: 'var(--line-strong)',
              color: 'var(--sel)',
            }}
          >
            <span>Mechanism (Why)</span>
            <span>{committed ? '🔓' : '🔒'}</span>
          </button>
        </div>
      </div>

      {/* Main split: Left 60% Simulator, Right 40% Interactive Experiment Panel */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Left: Ventilator Graphics & Numerics */}
        <div
          className="flex-1 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r"
          style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
        >
          <SharedVentDisplay
            engineState={activeEngineState}
            samples={activeSamples}
            alarmState={alarmState}
            limits={defaultLimitsFor(activeEngineState.device)}
            onSilenceAlarms={() =>
              setAlarmState((prev) => {
                const now = activeEngineState.monitored?.simTimeSec ?? 0;
                return isAlarmSilenced(prev, now) ? { ...prev, silencedUntilSimSec: undefined } : silenceAlarms(prev, now, 120);
              })
            }
            onAcknowledgeAlarm={(id) =>
              setAlarmState((prev) => acknowledgeAlarm(prev, id, activeEngineState.monitored?.simTimeSec ?? 0))
            }
          />
        </div>

        {/* Right: Lab Guided Workflow */}
        <div
          className="w-full lg:w-[460px] xl:w-[500px] min-[2200px]:w-[760px] min-[3000px]:w-[900px] flex-none overflow-y-auto p-4 flex flex-col gap-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          {/* Patient Card */}
          <div
            className="p-3 rounded border text-xs"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold" style={{ color: 'var(--text)' }}>
                Patient: {experiment.patient.displayName}
              </span>
              <span style={{ color: 'var(--text-3)' }}>
                {experiment.patient.params.sex}, {experiment.patient.params.ageYears}y
              </span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {experiment.patient.summary}
            </p>
          </div>

          {/* Intervention Selection */}
          <div
            className="p-3 rounded border flex flex-col gap-2"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Intervention Variable: <span style={{ color: 'var(--sel)' }}>{experiment.variable.label}</span>
              </span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                Baseline: {experiment.variable.baselineValue} {experiment.variable.unit}
              </span>
            </div>

            <div>
              <label
                htmlFor="lab-variable-select"
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-3)' }}
              >
                Choose target setting to test:
              </label>
              <select
                id="lab-variable-select"
                data-testid={LAB_TEST_IDS.LAB_VARIABLE_SELECT}
                disabled={committed}
                value={selectedOptionIndex}
                onChange={(e) => setSelectedOptionIndex(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded text-xs focus:outline-none disabled:opacity-60 border"
                style={{
                  background: 'var(--surface-3)',
                  borderColor: 'var(--line)',
                  color: 'var(--text)',
                }}
              >
                {experiment.variable.options.map((opt, i) => (
                  <option key={opt.label} value={i}>
                    {opt.label} ({opt.value} {experiment.variable.unit})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* What to look at Hint */}
          <div
            data-testid={LAB_TEST_IDS.LAB_HINT}
            className="p-3 rounded text-xs flex items-start gap-2 border"
            style={{
              background: 'var(--sel-subtle)',
              borderColor: 'var(--line-strong)',
              color: 'var(--text)',
            }}
          >
            <span className="text-sm shrink-0">💡</span>
            <div>
              <span className="font-bold" style={{ color: 'var(--sel)' }}>What to look at: </span>
              <span style={{ color: 'var(--text-2)' }}>{experiment.whatToLookAtHint}</span>
            </div>
          </div>

          {/* Prediction Panel */}
          <div
            data-testid={LAB_TEST_IDS.LAB_PREDICTION_PANEL}
            className="p-3.5 rounded-lg border flex flex-col gap-3"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
          >
            <div
              className="flex items-center justify-between border-b pb-2"
              style={{ borderColor: 'var(--line)' }}
            >
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                Hypothesis & Prediction
              </span>
              {committed && (
                <span className="text-[11px] font-semibold text-[var(--ok-ink)]">
                  ✓ Committed
                </span>
              )}
            </div>

            <div className="text-xs font-medium leading-snug" style={{ color: 'var(--text)' }}>
              {experiment.prediction.question}
            </div>

            {/* Metrics direction choices */}
            <div className="flex flex-col gap-2.5">
              {experiment.prediction.metrics.map((metric) => {
                const currentVal = predictions[metric];
                return (
                  <div
                    key={metric}
                    className="p-2.5 rounded border flex flex-col gap-1.5"
                    style={{ background: 'var(--surface-3)', borderColor: 'var(--line)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                        {formatMetricName(metric)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 mt-0.5">
                      {(['up', 'same', 'down'] as const).map((dir) => {
                        const isSelected = currentVal === dir;
                        let btnClass = 'vt-btn !min-h-[28px] !text-xs';
                        if (isSelected) {
                          btnClass += ' vt-btn--primary !font-bold';
                        }
                        return (
                          <button
                            key={dir}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={committed}
                            onClick={() =>
                              setPredictions((prev) => ({ ...prev, [metric]: dir }))
                            }
                            className={`${btnClass} disabled:cursor-not-allowed`}
                          >
                            {directionSymbol(dir)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Confidence Choice */}
            <div className="mt-1 flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                Confidence level:
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['guess', 'fairly_sure', 'certain'] as const).map((lvl) => {
                  const isSelected = confidence === lvl;
                  const labelMap: Record<Confidence, string> = {
                    guess: 'Guess',
                    fairly_sure: 'Fairly sure',
                    certain: 'Certain',
                  };
                  let btnClass = 'vt-btn !min-h-[28px] !text-xs';
                  if (isSelected) {
                    btnClass += ' vt-btn--primary !font-bold';
                  }
                  return (
                    <button
                      key={lvl}
                      type="button"
                      data-testid={`${LAB_TEST_IDS.LAB_CONFIDENCE_PREFIX}${lvl}`}
                      aria-pressed={isSelected}
                      disabled={committed}
                      onClick={() => setConfidence(lvl)}
                      className={`${btnClass} disabled:cursor-not-allowed`}
                    >
                      {labelMap[lvl]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Commit Button */}
            {!committed && (
              <button
                type="button"
                data-testid={LAB_TEST_IDS.LAB_COMMIT_BTN}
                disabled={!canCommit}
                onClick={handleCommit}
                className="w-full mt-2 py-2 px-3 vt-btn vt-btn--primary text-xs font-bold rounded"
              >
                {allMetricsPredicted
                  ? confidence
                    ? 'Commit Prediction & Observe Response'
                    : 'Select Confidence to Commit'
                  : 'Select Predictions to Commit'}
              </button>
            )}
          </div>

          {/* Before / After Table (CRITICAL NO SPOON-FEEDING: ONLY SHOWN AFTER COMMIT) */}
          {committed && (
            <div
              data-testid={LAB_TEST_IDS.LAB_BEFORE_AFTER_TABLE}
              className="p-3.5 rounded-lg border flex flex-col gap-2.5 animate-fadeIn"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
            >
              <div
                className="flex items-center justify-between border-b pb-2"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="text-xs font-bold text-[var(--ok-ink)] uppercase tracking-wider">
                  Observed Response vs Prediction
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Deterministic Engine Output</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr
                      className="border-b text-[11px]"
                      style={{ borderColor: 'var(--line)', color: 'var(--text-3)' }}
                    >
                      <th className="py-1 px-1.5 font-semibold">Metric</th>
                      <th className="py-1 px-1.5 font-semibold">Baseline</th>
                      <th className="py-1 px-1.5 font-semibold">After</th>
                      <th className="py-1 px-1.5 font-semibold">Actual</th>
                      <th className="py-1 px-1.5 font-semibold">Predicted</th>
                      <th className="py-1 px-1.5 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.prediction.metrics.map((m) => {
                      const beforeVal = simResult.baselineMetrics[m];
                      const afterVal = simResult.afterMetrics[m];
                      const actualDir = simResult.answerKey[m];
                      const userDir = predictions[m];
                      const isMatch = actualDir === userDir;

                      return (
                        <tr
                          key={m}
                          className="border-b"
                          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
                        >
                          <td className="py-1.5 px-1.5 font-medium">{formatMetricName(m)}</td>
                          <td className="py-1.5 px-1.5 font-mono" style={{ color: 'var(--text-3)' }}>
                            {formatMetricValue(m, beforeVal)}
                          </td>
                          <td className="py-1.5 px-1.5 font-mono font-bold" style={{ color: 'var(--text)' }}>
                            {formatMetricValue(m, afterVal)}
                          </td>
                          <td className="py-1.5 px-1.5">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                background: 'var(--surface-3)',
                                color: 'var(--sel)',
                                border: '1px solid var(--line)',
                              }}
                            >
                              {actualDir}
                            </span>
                          </td>
                          <td className="py-1.5 px-1.5">
                            <span className="text-[11px] font-mono" style={{ color: 'var(--text-2)' }}>{userDir}</span>
                          </td>
                          <td className="py-1.5 px-1.5">
                            {isMatch ? (
                              <span className="text-[var(--ok-ink)] font-bold">✓ Correct</span>
                            ) : (
                              <span className="text-[var(--danger-ink)] font-bold">✗ Incorrect</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reflection Panel (ONLY SHOWN AFTER COMMIT) */}
          {committed && (
            <div
              data-testid={LAB_TEST_IDS.LAB_REFLECTION_PANEL}
              className="p-3.5 rounded-lg border flex flex-col gap-3"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
            >
              <div
                className="flex items-center justify-between border-b pb-2"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                  Physiological Reflection
                </span>
                {reflectionSubmitted && (
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--sel)' }}>
                    Completed
                  </span>
                )}
              </div>

              <div className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text)' }}>
                {experiment.reflection.question}
              </div>

              <div className="flex flex-col gap-2">
                {experiment.reflection.options.map((opt) => {
                  const isSelected = selectedReflectionOpt === opt.id;
                  const isCorrect = opt.id === experiment.reflection.correctOptionId;

                  let optClass = 'text-left p-2.5 rounded border text-xs transition-colors vt-btn !justify-start !font-normal';
                  if (isSelected && !reflectionSubmitted) {
                    optClass += ' vt-btn--primary !font-medium';
                  } else if (reflectionSubmitted) {
                    if (isCorrect) {
                      optClass += ' !bg-[var(--ok-bg)] !border-[var(--ok-line)] !text-[var(--ok-ink)] !font-medium';
                    } else if (isSelected && !isCorrect) {
                      optClass += ' !bg-[var(--danger-bg)] !border-[var(--danger-line)] !text-[var(--danger-ink)] line-through';
                    }
                  }

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`${LAB_TEST_IDS.LAB_REFLECTION_OPT_PREFIX}${opt.id}`}
                      disabled={reflectionSubmitted}
                      onClick={() => setSelectedReflectionOpt(opt.id)}
                      className={`${optClass} disabled:cursor-not-allowed`}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>

              {!reflectionSubmitted ? (
                <button
                  type="button"
                  data-testid={LAB_TEST_IDS.LAB_REFLECTION_SUBMIT}
                  disabled={!selectedReflectionOpt}
                  onClick={handleReflectionSubmit}
                  className="w-full mt-1 py-2 px-3 vt-btn vt-btn--primary text-xs font-bold rounded"
                >
                  Submit Reflection
                </button>
              ) : (
                <div
                  className="mt-2 p-3 rounded text-xs flex flex-col gap-1.5 border"
                  style={{
                    background: 'var(--surface-3)',
                    borderColor: 'var(--line)',
                    color: 'var(--text)',
                  }}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {selectedReflectionOpt === experiment.reflection.correctOptionId ? (
                      <span className="text-[var(--ok-ink)]">✓ Correct Analysis</span>
                    ) : (
                      <span className="text-[var(--warn-ink)]">Explanation</span>
                    )}
                  </div>
                  <p className="leading-relaxed text-[11px]" style={{ color: 'var(--text-2)' }}>
                    {experiment.reflection.explanation}
                  </p>
                  {experiment.ruleBased && experiment.ruleBasedNote && (
                    <div
                      className="mt-1 pt-1.5 border-t text-[10px]"
                      style={{ borderColor: 'var(--line)', color: 'var(--act)' }}
                    >
                      Rule-based note: {experiment.ruleBasedNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Causal "Why" View Anchor & Section */}
          <div id="lab-why-anchor" className="flex flex-col gap-2">
            {renderWhyView ? (
              renderWhyView({
                experiment,
                committed: committed && reflectionSubmitted,
                baselineState: simResult.baselineState,
                afterState: committed && reflectionSubmitted ? simResult.afterState : null,
              })
            ) : (
              <WhyView
                committed={committed && reflectionSubmitted}
                causalChainFields={experiment.causalChainFields}
                baseline={baselineSnapshot}
                after={afterSnapshot}
                ruleBased={experiment.ruleBased}
                ruleBasedNote={experiment.ruleBasedNote}
              />
            )}
          </div>

          <div className="mt-4">
            <TutorPanel
              embedded
              getContext={() => {
                const whyNodesText =
                  committed && afterSnapshot
                    ? buildCausalChain(
                        experiment.causalChainFields,
                        baselineSnapshot,
                        afterSnapshot,
                        { experimentRuleBased: experiment.ruleBased }
                      )
                        .map(
                          n =>
                            `- ${n.label}: ${n.formattedBefore}${n.unit ? ' ' + n.unit : ''} -> ${n.formattedAfter}${n.unit ? ' ' + n.unit : ''} (${n.direction}): ${n.templateText}`
                        )
                        .join('\n')
                    : undefined;
                return buildLabContext({
                  experiment,
                  stage,
                  committed,
                  reflectionSubmitted,
                  baselineMonitored: simResult.baselineState.monitored,
                  afterMonitored: committed ? simResult.afterState.monitored : undefined,
                  selectedVariableValue: experiment.variable.options[selectedOptionIndex]?.value,
                  learnerPrediction: committed ? predictions : undefined,
                  whyNodesText,
                }).contextText;
              }}
              contextKind="lab"
              getCap={(requestKind, learnerMessage) =>
                computeHelpLevelCap({
                  guidanceLevel: 'prompted',
                  isProbe: !committed || !reflectionSubmitted,
                  hasCommittedDecision: committed && reflectionSubmitted,
                  failedAttemptsCount: 0,
                  hasConfidentError: false,
                  isStuck: false,
                  isImmediateDanger: false,
                  learnerRequest: requestKind,
                  learnerMessage,
                  contextKind: 'lab',
                })
              }
              getForbiddenPhrases={() =>
                buildLabContext({
                  experiment,
                  stage,
                  committed,
                  reflectionSubmitted,
                }).forbiddenPhrases
              }
              runId={runId}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
