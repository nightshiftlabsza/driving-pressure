import React, { useState, useEffect, useMemo } from 'react';
import type { DrillItem } from './types';
import type { EventSink, LearnerEvent, Confidence } from '../shared/events';
import { EVENT_SCHEMA_VERSION } from '../shared/events';
import type { EngineApi, WaveformSample } from '../shared/engineTypes';
import { newId } from '../shared/eventSink';
import { WaveformPlot } from './WaveformPlot';
import { TutorPanel } from '../tutor/TutorPanel';

/** Deterministic shuffle (Fisher-Yates with a seeded generator): stable within a run, different between runs. */
export function shuffleOptions<T>(options: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const next = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...options];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface DrillRunnerProps {
  items: DrillItem[];
  sink: EventSink;
  engine?: EngineApi;
  sessionId: string;
  drillId?: string;
  onFinish?: () => void;
}

export const DrillRunner: React.FC<DrillRunnerProps> = ({
  items,
  sink,
  engine,
  sessionId,
  drillId = 'drill-session',
  onFinish,
}) => {
  const [runId] = useState<string>(() => `drill-${drillId}-${Date.now()}`);
  const [runStartTime] = useState<number>(() => Date.now());
  const [hasStartedRun, setHasStartedRun] = useState<boolean>(false);
  const [hasEndedRun, setHasEndedRun] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | string[] | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [itemStartTime, setItemStartTime] = useState<number>(() => Date.now());
  const [score, setScore] = useState<number>(0);
  const [skippedCount, setSkippedCount] = useState<number>(0);
  const [isFinished, setIsFinished] = useState<boolean>(false);

  // Record run_start on initial mount
  useEffect(() => {
    if (hasStartedRun) return;
    const startEvent: LearnerEvent = {
      v: EVENT_SCHEMA_VERSION,
      id: newId(),
      wallTime: new Date().toISOString(),
      sessionId,
      runId,
      activity: 'drill',
      activityId: drillId,
      type: 'run_start',
      guidanceByCompetency: {},
      contextTags: ['drill', drillId],
    };
    sink.record(startEvent).catch((err) => {
      console.warn('Failed to record drill run_start:', err);
    });
    setHasStartedRun(true);
  }, [hasStartedRun, drillId, runId, sessionId, sink]);

  // Waveform state for waveform items
  const [waveformSamples, setWaveformSamples] = useState<WaveformSample[] | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [showUnpackTutor, setShowUnpackTutor] = useState<boolean>(false);

  const currentItem: DrillItem | undefined = items[currentIndex];

  // Options are shown in a different order on every run, so position never marks the right answer.
  const displayedOptions = useMemo(
    () => (currentItem ? shuffleOptions(currentItem.options, `${runId}:${currentItem.id}`) : []),
    [currentItem, runId]
  );

  // Whenever the item changes, reset selection and load waveforms if applicable
  useEffect(() => {
    setSelectedAnswer(null);
    setConfidence(null);
    setIsSubmitted(false);
    setShowUnpackTutor(false);
    setItemStartTime(Date.now());
    setWaveformSamples(null);
    setWaveformError(null);

    if (currentItem?.waveformConfig) {
      if (!engine) {
        setWaveformError('This waveform could not be drawn (item data error). Skip this item and report it.');
        return;
      }
      try {
        const result = engine.simulateBreaths(
          currentItem.waveformConfig.patient,
          currentItem.waveformConfig.device,
          currentItem.waveformConfig.nBreaths ?? 3
        );
        if (result && result.samples && result.samples.length > 0) {
          setWaveformSamples(result.samples);
        } else {
          setWaveformError('This waveform could not be drawn (item data error). Skip this item and report it.');
        }
      } catch (err: unknown) {
        console.error(`Waveform item ${currentItem.id} failed to simulate`, err);
        setWaveformError('This waveform could not be drawn (item data error). Skip this item and report it.');
      }
    }
  }, [currentIndex, currentItem, engine]);

  // Determine correctness
  const isCorrect = useMemo(() => {
    if (!currentItem || selectedAnswer === null) return false;
    if (Array.isArray(currentItem.answerKey)) {
      if (!Array.isArray(selectedAnswer)) return false;
      const sortedSelected = [...selectedAnswer].sort();
      const sortedKey = [...currentItem.answerKey].sort();
      return (
        sortedSelected.length === sortedKey.length &&
        sortedSelected.every((val, index) => val === sortedKey[index])
      );
    }
    return selectedAnswer === currentItem.answerKey;
  }, [currentItem, selectedAnswer]);

  const handleSelectOption = (optId: string) => {
    if (isSubmitted || !currentItem) return;
    if (currentItem.answerFormat === 'multi-select') {
      const currentArr = Array.isArray(selectedAnswer) ? selectedAnswer : [];
      if (currentArr.includes(optId)) {
        setSelectedAnswer(currentArr.filter((id) => id !== optId));
      } else {
        setSelectedAnswer([...currentArr, optId]);
      }
    } else {
      setSelectedAnswer(optId);
    }
  };

  const isOptionSelected = (optId: string): boolean => {
    if (Array.isArray(selectedAnswer)) {
      return selectedAnswer.includes(optId);
    }
    return selectedAnswer === optId;
  };

  const canSubmit =
    !isSubmitted &&
    selectedAnswer !== null &&
    (Array.isArray(selectedAnswer) ? selectedAnswer.length > 0 : true) &&
    confidence !== null;

  const handleSubmit = async () => {
    if (!canSubmit || !currentItem || !confidence) return;

    const latencyMs = Math.max(0, Date.now() - itemStartTime);
    if (isCorrect) {
      setScore((prev) => prev + 1);
    }

    const event: LearnerEvent = {
      v: EVENT_SCHEMA_VERSION,
      id: newId(),
      wallTime: new Date().toISOString(),
      sessionId,
      runId,
      activity: 'drill',
      activityId: currentItem.drillId || drillId,
      type: 'drill_answer',
      drillId: currentItem.drillId || drillId,
      itemId: currentItem.id,
      competency: currentItem.competency,
      evidenceType: currentItem.evidenceType,
      contextTags: ['drill', currentItem.drillId || drillId, currentItem.id],
      correct: isCorrect,
      confidence,
      guidance: 'independent',
      hidden: false,
      latencyMs,
      hintsUsed: 0,
      answer: selectedAnswer,
      expected: currentItem.answerKey,
    };

    await sink.record(event);
    setIsSubmitted(true);
  };

  const handleNext = () => {
    if (currentIndex + 1 < items.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsFinished(true);
      if (!hasEndedRun) {
        const durationRealSec = Math.max(1, Math.round((Date.now() - runStartTime) / 1000));
        const endEvent: LearnerEvent = {
          v: EVENT_SCHEMA_VERSION,
          id: newId(),
          wallTime: new Date().toISOString(),
          sessionId,
          runId,
          activity: 'drill',
          activityId: drillId,
          type: 'run_end',
          outcome: 'completed',
          score,
          maxScore: items.length,
          contextTags: ['drill', drillId],
        };
        sink.record(endEvent).catch((err) => {
          console.warn('Failed to record drill run_end:', err);
        });
        setHasEndedRun(true);
      }
    }
  };

  const handleSkipWaveform = () => {
    setSkippedCount((prev) => prev + 1);
    handleNext();
  };

  if (!items || items.length === 0) {
    return (
      <div className="p-8 text-center border text-xs" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text-2)' }}>
        No drill items available.
      </div>
    );
  }

  if (isFinished) {
    const percentage = Math.round((score / items.length) * 100);
    return (
      <div className="max-w-2xl mx-auto p-6 border space-y-5" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text)' }}>
        <h2 className="text-xl font-bold text-center">Drill Complete!</h2>
        <div className="p-6 border text-center space-y-2" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Your Score</p>
          <p className="text-3xl font-bold num" style={{ color: 'var(--act)' }}>
            {score} / {items.length} ({percentage}%)
          </p>
          {skippedCount > 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--alarm-med)' }}>
              {skippedCount} item{skippedCount > 1 ? 's' : ''} skipped (physiology engine not finished yet)
            </p>
          )}
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => onFinish?.()}
            data-testid="finish-button"
            className="vt-btn vt-btn--confirm min-w-[7rem]"
          >
            Finish Drill
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-5 border space-y-4" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text)' }}>
      {/* Top Bar: Progress & Competency tag */}
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2">
          <span className="vt-badge font-bold uppercase text-[11px]">
            {currentItem.category}
          </span>
          <span className="vt-badge text-[11px]">
            {currentItem.answerFormat === 'multi-select' ? 'Select all that apply' : currentItem.answerFormat === 'direction' ? 'Direction' : 'Single choice'}
          </span>
          <span className="text-xs font-medium num" style={{ color: 'var(--text-2)' }}>
            Item {currentIndex + 1} of {items.length}
          </span>
        </div>
        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
          {currentItem.competency}
        </span>
      </div>

      {/* Stem */}
      <div>
        <h3 className="text-sm font-semibold leading-relaxed">
          {currentItem.stem}
        </h3>
      </div>

      {/* Alarm vignette readings table/dense list */}
      {currentItem.alarmReadings && (
        <div className="border" style={{ borderColor: 'var(--alarm-high)', background: 'var(--surface-2)' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--line)', background: 'var(--alarm-high)', color: '#fff' }}>
            <span className="text-xs font-bold uppercase tracking-wider">
              ALARM: {currentItem.alarmReadings.alarmText}
            </span>
            <span className="text-xs font-mono">
              Mode: <strong>{currentItem.alarmReadings.mode}</strong>
            </span>
          </div>
          <table className="vt-table">
            <thead>
              <tr>
                <th>Ppeak</th>
                <th>Pplat</th>
                <th>VTe</th>
                <th>Total RR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-bold num" style={{ color: 'var(--act)' }}>{currentItem.alarmReadings.ppeakCmH2O} cmH2O</td>
                <td className="num">
                  {currentItem.alarmReadings.pplatCmH2O !== null && currentItem.alarmReadings.pplatCmH2O !== undefined
                    ? `${currentItem.alarmReadings.pplatCmH2O} cmH2O`
                    : '—'}
                </td>
                <td className="num">{currentItem.alarmReadings.vteMl} mL</td>
                <td className="num">{currentItem.alarmReadings.rrBpm} bpm</td>
              </tr>
            </tbody>
          </table>
          <div className="px-3 py-2 flex flex-wrap items-center justify-between text-xs font-mono border-t" style={{ borderColor: 'var(--line)', color: 'var(--text-3)' }}>
            <span>
              SpO2: <strong style={{ color: 'var(--text)' }}>{currentItem.alarmReadings.spo2Pct}%</strong>
              {currentItem.alarmReadings.bpMmHg && (
                <span className="ml-3">
                  BP: <strong style={{ color: 'var(--text)' }}>{currentItem.alarmReadings.bpMmHg}</strong>
                </span>
              )}
            </span>
            <span>
              Set: {Object.entries(currentItem.alarmReadings.setValues).filter(([_, v]) => v !== undefined && v !== '').map(([k, v]) => `${k} ${v}`).join(', ')}
            </span>
          </div>
        </div>
      )}

      {/* ABG values table */}
      {currentItem.abgValues && (
        <div className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider border-b" style={{ borderColor: 'var(--line)', color: 'var(--act)' }}>
            Arterial Blood Gas Analysis
          </div>
          <table className="vt-table">
            <thead>
              <tr>
                <th>pH</th>
                <th>PaCO2</th>
                <th>PaO2</th>
                <th>HCO3-</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="font-bold num block">{currentItem.abgValues.ph}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>ref 7.35-7.45</span>
                </td>
                <td>
                  <span className="font-bold num block">{currentItem.abgValues.paco2MmHg} mmHg</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>ref 35-45</span>
                </td>
                <td>
                  <span className="font-bold num block">{currentItem.abgValues.pao2MmHg} mmHg</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>ref 80-100</span>
                </td>
                <td>
                  <span className="font-bold num block">{currentItem.abgValues.hco3MmolL} mmol/L</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>ref 22-26</span>
                </td>
              </tr>
            </tbody>
          </table>
          {currentItem.abgValues.fio2 && (
            <div className="px-3 py-1.5 text-xs font-mono text-right border-t" style={{ borderColor: 'var(--line)', color: 'var(--text-3)' }}>
              FiO2: {Math.round(currentItem.abgValues.fio2 * 100)}%
            </div>
          )}
        </div>
      )}

      {/* Waveform renderer or Honest Not-Finished fallback */}
      {currentItem.waveformConfig && (
        <div>
          {waveformError ? (
            <div
              data-testid="waveform-error-banner"
              className="p-3 border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              style={{ borderColor: 'var(--alarm-med)', background: 'var(--surface-2)', color: 'var(--alarm-med)' }}
            >
              <div>
                <p className="font-bold">Physiology Engine Notice</p>
                <p className="mt-0.5" style={{ color: 'var(--text)' }}>
                  This waveform could not be drawn (item data error). Skip this item and report it.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSkipWaveform}
                data-testid="skip-waveform-button"
                className="vt-btn whitespace-nowrap self-start sm:self-center"
              >
                Skip this item
              </button>
            </div>
          ) : waveformSamples ? (
            <WaveformPlot samples={waveformSamples} />
          ) : (
            <div className="h-44 flex items-center justify-center border text-xs" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              Loading simulated breath waveforms...
            </div>
          )}
        </div>
      )}

      {/* Question Options & Submit (hidden when waveform fails to render) */}
      {!waveformError && (
        <>
          <div className="border divide-y" style={{ borderColor: 'var(--line)' }} data-testid="drill-options">
            {displayedOptions.map((option) => {
              const selected = isOptionSelected(option.id);
              const isMulti = currentItem.answerFormat === 'multi-select';
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelectOption(option.id)}
                  disabled={isSubmitted}
                  data-testid={`option-${option.id}`}
                  className="w-full text-left p-3 text-xs font-medium flex items-center justify-between transition-colors"
                  style={{
                    background: selected ? 'var(--act-soft)' : 'var(--surface)',
                    borderLeft: selected ? '3px solid var(--act)' : '3px solid transparent',
                    color: 'var(--text)',
                    cursor: isSubmitted ? 'default' : 'pointer',
                    opacity: isSubmitted ? 0.9 : 1,
                  }}
                >
                  <span>{option.text}</span>
                  <span
                    className={`w-3.5 h-3.5 border ml-3 shrink-0 flex items-center justify-center ${
                      isMulti ? 'rounded-none' : 'rounded-full'
                    }`}
                    style={{
                      borderColor: selected ? 'var(--act)' : 'var(--line-strong)',
                      background: selected ? 'var(--act)' : 'transparent',
                    }}
                  >
                    {selected && (
                      <span className="w-1.5 h-1.5" style={{ background: 'var(--act-ink)' }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Prediction before feedback: Confidence selector */}
          <div className="p-3 border space-y-2" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
            <label className="vt-label block">
              Your Confidence Level (Commit before submit)
            </label>
            <div className="grid grid-cols-3 gap-2" data-testid="confidence-selector">
              {(['guess', 'fairly_sure', 'certain'] as Confidence[]).map((level) => {
                const isSelected = confidence === level;
                const labels: Record<Confidence, string> = {
                  guess: 'Guess',
                  fairly_sure: 'Fairly Sure',
                  certain: 'Certain',
                };
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={isSubmitted}
                    onClick={() => setConfidence(level)}
                    data-testid={`confidence-${level}`}
                    className="vt-btn text-xs"
                    aria-pressed={isSelected}
                    style={isSelected ? { background: 'var(--act)', borderColor: 'var(--act)', color: 'var(--act-ink)' } : undefined}
                  >
                    {labels[level]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit button (visible when not submitted) */}
          {!isSubmitted && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                data-testid="submit-button"
                className="vt-btn vt-btn--confirm min-w-[7rem]"
              >
                Submit Prediction
              </button>
            </div>
          )}
        </>
      )}

      {/* FEEDBACK SECTION: strictly rendered ONLY AFTER submit */}
      {isSubmitted && (
        <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--line)' }} data-testid="drill-feedback-section">
          <div
            data-testid={isCorrect ? 'feedback-correct' : 'feedback-incorrect'}
            className="p-3 border text-xs"
            style={{
              borderColor: isCorrect ? 'var(--ok)' : 'var(--alarm-high)',
              background: 'var(--surface-2)',
              color: isCorrect ? 'var(--ok)' : 'var(--alarm-high)',
            }}
          >
            <div className="font-bold">
              <span>{isCorrect ? '✓ Correct!' : '✗ Incorrect'}</span>
            </div>
            {!isCorrect && (
              <p className="mt-1" style={{ color: 'var(--text)' }}>
                Expected answer:{' '}
                <strong>
                  {Array.isArray(currentItem.answerKey)
                    ? currentItem.answerKey
                        .map((k) => currentItem.options.find((o) => o.id === k)?.text || k)
                        .join('; ')
                    : currentItem.options.find((o) => o.id === currentItem.answerKey)?.text || currentItem.answerKey}
                </strong>
              </p>
            )}
          </div>

          {/* Explanation */}
          <div
            data-testid="drill-explanation"
            className="p-3 border text-xs leading-relaxed"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-2)' }}
          >
            <strong className="block mb-0.5" style={{ color: 'var(--text)' }}>Explanation:</strong>
            {currentItem.explanation}
          </div>

          <div className="flex justify-between items-center gap-2">
            <button
              type="button"
              data-testid="drill-unpack-mechanism-btn"
              onClick={() => setShowUnpackTutor(v => !v)}
              className="vt-btn text-xs"
            >
              {showUnpackTutor ? 'Hide Mechanism Tutor' : 'Unpack Mechanism'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              data-testid="next-button"
              className="vt-btn vt-btn--confirm min-w-[7rem]"
            >
              {currentIndex + 1 < items.length ? 'Next Item →' : 'View Results'}
            </button>
          </div>

          {showUnpackTutor && (
            <TutorPanel
              defaultOpen={true}
              contextKind="practice"
              helpLevelCap={2}
              contextText={`Drill Item (${currentItem.category}): ${currentItem.stem}\nExplanation: ${currentItem.explanation}`}
            />
          )}
        </div>
      )}
    </div>
  );
};
