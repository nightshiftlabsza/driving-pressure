import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { LearnerApi, CompetencyState, CompetencyStatus } from '../shared/learnerApi';
import type { GuidanceLevel, Confidence, LearnerEvent } from '../shared/events';
import competenciesJson from '../shared/competencies.json';
import mistakesJson from '../shared/mistakes.json';
import { deriveEntrustmentLevels, type TierEntrustmentStatus, type EntrustmentLevel } from '../adaptive/entrustment';
import { readLearnerEvents } from '../adaptive/learnerEvents';
import { deriveMistakeLedger } from '../adaptive/ledger';
import { deriveReTestSchedule, type ReTestScheduleItem } from '../adaptive/schedule';
import { computeLearningMetrics, buildBlindedEgqExport } from '../tutor/metrics';
import {
  listTutorExchanges,
  listDelayedRetests,
  type TutorExchangeRecord,
  type DelayedRetestRecord,
} from '../tutor/store';

export interface ProgressProps {
  learner: LearnerApi;
  onBackToLibrary?: () => void;
}

function formatStatus(status: CompetencyStatus): string {
  switch (status) {
    case 'not_seen':
      return 'Not seen';
    case 'practising':
      return 'Practising';
    case 'independent':
      return 'Independent';
    case 'mastered':
      return 'Mastered';
    case 'retained':
      return 'Retained';
    default:
      return status;
  }
}

function getEntrustmentToneStyle(level: EntrustmentLevel): React.CSSProperties {
  switch (level) {
    case 'Independent':
      return { color: 'var(--ok)', borderColor: 'var(--ok)', background: 'var(--surface-2)' };
    case 'Indirect':
      return { color: 'var(--act)', borderColor: 'var(--act)', background: 'var(--act-soft)' };
    case 'Supervised':
      return { color: 'var(--alarm-med)', borderColor: 'var(--alarm-med)', background: 'var(--surface-2)' };
    case 'Observed':
    default:
      return { color: 'var(--text-2)', borderColor: 'var(--line-strong)', background: 'var(--surface-2)' };
  }
}

function formatGuidance(level: GuidanceLevel): string {
  switch (level) {
    case 'guided':
      return 'Guided';
    case 'prompted':
      return 'Prompted';
    case 'independent':
      return 'Independent';
    default:
      return level;
  }
}

function formatDueDate(dueAt: string | null): string {
  if (!dueAt) return 'Not scheduled';
  const dueTime = new Date(dueAt).getTime();
  if (isNaN(dueTime)) return 'Not scheduled';
  const now = Date.now();
  if (dueTime <= now) {
    return 'due now';
  }
  const diffDays = Math.max(1, Math.round((dueTime - now) / (1000 * 60 * 60 * 24)));
  return diffDays === 1 ? 'in 1 day' : `in ${diffDays} days`;
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export const Progress: React.FC<ProgressProps> = ({ learner, onBackToLibrary }) => {
  const [states, setStates] = useState<CompetencyState[]>([]);
  const [events, setEvents] = useState<LearnerEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Reset and Import states
  const [resetInput, setResetInput] = useState<string>('');
  const [pendingImport, setPendingImport] = useState<{ filename: string; content: string } | null>(null);
  const [isUpdatingOverride, setIsUpdatingOverride] = useState<string | null>(null);
  const [tutorExchanges, setTutorExchanges] = useState<TutorExchangeRecord[]>([]);
  const [delayedRetests, setDelayedRetests] = useState<DelayedRetestRecord[]>([]);

  const loadData = useCallback(async () => {
    if (!learner) {
      setError('Learner service unavailable');
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const [res, evs, exs, rets] = await Promise.all([
        learner.getCompetencyStates(),
        readLearnerEvents(learner),
        listTutorExchanges().catch(() => []),
        listDelayedRetests().catch(() => []),
      ]);
      setStates(res);
      setEvents(evs);
      setTutorExchanges(exs);
      setDelayedRetests(rets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load competency states');
    } finally {
      setIsLoading(false);
    }
  }, [learner]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stateMap = useMemo(() => {
    return new Map<string, CompetencyState>(states.map(s => [s.competency, s]));
  }, [states]);

  const hasNoRunsYet = useMemo(() => {
    if (events.some(e => e.type === 'run_start' || e.type === 'run_end')) return false;
    if (states.length === 0) return true;
    return states.every(s => (s.evidenceCount ?? 0) === 0 && s.status === 'not_seen');
  }, [states, events]);

  const ledger = useMemo(() => deriveMistakeLedger(events), [events]);
  const schedule = useMemo(() => deriveReTestSchedule(events), [events]);
  const entrustmentByTier = useMemo(
    () => deriveEntrustmentLevels(events, { ledger, schedule, tutorExchanges }),
    [events, ledger, schedule, tutorExchanges]
  );
  const learningMetrics = useMemo(
    () => computeLearningMetrics({ events, states, tutorExchanges, delayedRetests }),
    [events, states, tutorExchanges, delayedRetests]
  );

  // Calibration aggregation across all competencies
  const calibrationData = useMemo(() => {
    const levels: Confidence[] = ['certain', 'fairly_sure', 'guess'];
    const totals: Record<Confidence, { answered: number; correct: number }> = {
      certain: { answered: 0, correct: 0 },
      fairly_sure: { answered: 0, correct: 0 },
      guess: { answered: 0, correct: 0 },
    };

    for (const s of states) {
      if (s.calibration?.byConfidence) {
        for (const lvl of levels) {
          const entry = s.calibration.byConfidence[lvl];
          if (entry) {
            totals[lvl].answered +=
              typeof entry.answered === 'number' && !isNaN(entry.answered) ? entry.answered : 0;
            totals[lvl].correct +=
              typeof entry.correct === 'number' && !isNaN(entry.correct) ? entry.correct : 0;
          }
        }
      }
    }

    return levels.map(level => {
      const { answered, correct } = totals[level];
      const pct =
        answered > 0 ? Math.min(100, Math.max(0, Math.round((correct / answered) * 100))) : 0;
      let label = 'Certain';
      if (level === 'fairly_sure') label = 'Fairly sure';
      if (level === 'guess') label = 'Guess';

      return {
        level,
        label,
        answered,
        correct,
        pct,
      };
    });
  }, [states]);

  const totalPredictionsAnswered = useMemo(() => {
    return calibrationData.reduce((sum, item) => sum + item.answered, 0);
  }, [calibrationData]);

  // Recurring mistakes top across all competencies
  const topRecurringMistakes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of states) {
      for (const m of s.topMistakes ?? []) {
        counts.set(m.mistake, (counts.get(m.mistake) ?? 0) + m.count);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const def = mistakesJson.mistakes.find(m => m.id === id);
        return {
          id,
          count,
          name: def?.name ?? id,
          response: def?.response ?? 'Review clinical guidance',
        };
      });
  }, [states]);

  // Guidance override handler
  const handleOverrideChange = async (competencyId: string, value: string) => {
    if (!learner) return;
    const newOverride: GuidanceLevel | null = value === 'auto' ? null : (value as GuidanceLevel);
    try {
      setIsUpdatingOverride(competencyId);
      await learner.setGuidanceOverride(competencyId, newOverride);
      await loadData();
    } catch (err) {
      setActionMessage(
        `Failed to update guidance override: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsUpdatingOverride(null);
    }
  };

  // Export handler
  const handleExport = async () => {
    if (!learner) return;
    try {
      const json = await learner.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `open-vent-sim-progress-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setActionMessage('Progress successfully exported to JSON.');
    } catch (err) {
      setActionMessage(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleExportBlindedEgq = () => {
    const entries = buildBlindedEgqExport(events, tutorExchanges, 20);
    const json = JSON.stringify({ scale: '0-2 mechanistic rubric', entries }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    if (typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `open-vent-sim-blinded-egq-${entries.length}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    setActionMessage(`Exported ${entries.length} blinded EGQ entries for 14-day review.`);
  };

  // File chosen for import
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await readFileText(file);
      try {
        JSON.parse(content);
      } catch {
        setActionMessage('Invalid backup file: file content is not valid JSON.');
        return;
      }
      setPendingImport({ filename: file.name, content });
      setActionMessage(null);
    } catch (err) {
      setActionMessage(
        `Failed to read file: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      e.target.value = '';
    }
  };

  // Confirm import
  const handleConfirmImport = async () => {
    if (!learner || !pendingImport) return;
    try {
      await learner.importJson(pendingImport.content);
      setPendingImport(null);
      setActionMessage('Progress successfully imported.');
      await loadData();
    } catch (err) {
      setActionMessage(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // Reset handler
  const handleReset = async () => {
    if (!learner || resetInput !== 'RESET') return;
    try {
      await learner.resetAll();
      setResetInput('');
      setActionMessage('All learner progress has been reset to defaults.');
      await loadData();
    } catch (err) {
      setActionMessage(
        `Reset failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  return (
    <div data-testid="progress-view" className="w-full min-h-screen p-4 md:p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="vt-page space-y-5">
        {/* Header */}
        <header className="border-b pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3" style={{ borderColor: 'var(--line)' }}>
          <div>
            <span className="vt-label" style={{ color: 'var(--act)' }}>
              Learner Profile
            </span>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight mt-0.5">
              Competency Progress
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
              Curriculum progression, calibration accuracy, and spaced-review schedule.
            </p>
          </div>

          {onBackToLibrary && (
            <button
              type="button"
              onClick={onBackToLibrary}
              className="vt-btn self-start md:self-auto"
            >
              ← Case Library
            </button>
          )}
        </header>

        {/* Global Action Banner */}
        {actionMessage && (
          <div
            role="status"
            className="p-3 border text-xs flex items-center justify-between"
            style={{ borderColor: 'var(--act)', background: 'var(--surface-2)', color: 'var(--text)' }}
          >
            <span>{actionMessage}</span>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="vt-btn vt-btn--quiet text-xs ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            role="alert"
            className="p-3 border text-xs"
            style={{ borderColor: 'var(--alarm-high)', background: 'var(--surface-2)', color: 'var(--alarm-high)' }}
          >
            <strong className="block font-semibold mb-1">Learner unavailable</strong>
            {error}
          </div>
        )}

        {/* Empty state: No simulation runs yet */}
        {!isLoading && !error && hasNoRunsYet && (
          <div
            role="status"
            className="p-4 border text-xs"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--surface)', color: 'var(--text-2)' }}
          >
            <strong className="block font-semibold mb-1" style={{ color: 'var(--text)' }}>No simulation runs yet</strong>
            <p className="leading-relaxed">
              You haven&apos;t completed any case simulations yet. Select a case from the Case Library to begin developing competencies, calibrating confidence, and building spaced-repetition schedules.
            </p>
          </div>
        )}

        {/* Confirmation Modal / Banner for Import */}
        {pendingImport && (
          <div
            role="dialog"
            aria-labelledby="import-confirm-title"
            className="p-4 border text-xs"
            style={{ borderColor: 'var(--alarm-med)', background: 'var(--surface-2)' }}
          >
            <h2 id="import-confirm-title" className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--alarm-med)' }}>
              <span>⚠️</span> Confirm Progress Import
            </h2>
            <p className="mt-1" style={{ color: 'var(--text-2)' }}>
              Importing <strong>{pendingImport.filename}</strong> will replace all current competency progress and event history. This cannot be undone.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmImport}
                className="vt-btn vt-btn--confirm"
              >
                Confirm Import
              </button>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                className="vt-btn"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* SECTION 1: Entrustment Levels by Case Tier */}
        <section aria-labelledby="heading-entrustment" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="heading-entrustment" className="text-sm font-bold">
              Entrustment Levels by Case Tier
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              EPA-based clinical autonomy (Observed, Supervised, Indirect, Independent). Run count alone never earns promotion: advancement requires consecutive clean runs, faded guidance, and clean re-tests.
            </p>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {([1, 2, 3] as const).map(tierNum => {
              const tierStatus: TierEntrustmentStatus = entrustmentByTier[tierNum];
              return (
                <div
                  key={tierNum}
                  className="p-3 border flex flex-col justify-between gap-2.5"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-xs shrink-0" style={{ background: 'var(--surface-3)', color: 'var(--sel)' }}>
                          T{tierNum}
                        </span>
                        <span className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                          {tierStatus.name}
                        </span>
                      </div>
                      <span
                        className="vt-badge text-[11px] font-semibold shrink-0"
                        style={getEntrustmentToneStyle(tierStatus.level)}
                        data-testid={`entrustment-tier-status-${tierNum}`}
                      >
                        {tierStatus.level}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug" style={{ color: 'var(--text-2)' }}>
                      {tierStatus.description}
                    </p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] pt-1 font-mono num" style={{ color: 'var(--text-3)' }}>
                      <span>Runs: {tierStatus.totalRuns}</span>
                      <span>Successful: {tierStatus.successfulRuns}</span>
                      <span>Re-tests: {tierStatus.passedReTestsCount}</span>
                      <span style={tierStatus.unresolvedMistakesCount > 0 ? { color: 'var(--alarm-med)' } : undefined}>
                        Open slips: {tierStatus.unresolvedMistakesCount}
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                    <span className="font-semibold block" style={{ color: 'var(--text)' }}>Next requirement:</span>
                    {tierStatus.nextStepRequirement}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 2: Calibration */}
        <section aria-labelledby="heading-calibration" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="heading-calibration" className="text-sm font-bold">
              Calibration
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              How often your answers were correct at each confidence level. Numbers and percentages are displayed directly.
            </p>
          </div>

          <div className="p-4 space-y-3">
            {totalPredictionsAnswered === 0 && (
              <p className="text-xs italic" style={{ color: 'var(--text-3)' }}>
                No predictions recorded yet. Complete simulation cases with prediction points to measure confidence calibration.
              </p>
            )}

            <div className="space-y-3">
              {calibrationData.map(item => (
                <div key={item.level} className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold">{item.label}</span>
                    <span className="font-mono num" style={{ color: 'var(--text-2)' }}>
                      {item.correct} / {item.answered} correct ({item.pct}%)
                    </span>
                  </div>
                  <div className="w-full h-3 border overflow-hidden" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                    <div
                      role="progressbar"
                      aria-valuenow={item.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${item.label} calibration percentage`}
                      className="h-full transition-all duration-300"
                      style={{ width: `${item.pct}%`, background: 'var(--act)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Independent Learning Telemetry (7 N-of-1 Metrics, Section 10.1) */}
        <section
          aria-labelledby="heading-learning-metrics"
          data-testid="progress-learning-metrics"
          className="border"
          style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
        >
          <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--line)' }}>
            <div>
              <h2 id="heading-learning-metrics" className="text-sm font-bold">
                Independent Learning Telemetry (Section 10.1)
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                Computed locally from unaided outcomes, delayed retests, transfer probes, and tutor logs.
              </p>
            </div>
            <button
              type="button"
              data-testid="export-blinded-egq-btn"
              onClick={handleExportBlindedEgq}
              className="vt-btn text-xs"
            >
              Export Blinded EGQ ({learningMetrics.blindedEgqCount}/20)
            </button>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>1. Unaided Trend (UT)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.unaidedPerformanceTrend.latestUnaidedAccuracyPct !== null
                  ? `${learningMetrics.unaidedPerformanceTrend.latestUnaidedAccuracyPct}%`
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Slope: {learningMetrics.unaidedPerformanceTrend.slopePerRun !== null
                  ? learningMetrics.unaidedPerformanceTrend.slopePerRun
                  : '—'} ({learningMetrics.unaidedPerformanceTrend.unaidedRunsCount} runs)
              </div>
            </div>
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>2. Delayed Retention (DRR)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.delayedRetention.overallRatePct !== null
                  ? `${learningMetrics.delayedRetention.overallRatePct}%`
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                7d: {learningMetrics.delayedRetention.drr7dPct !== null ? `${learningMetrics.delayedRetention.drr7dPct}%` : '—'} · 21d: {learningMetrics.delayedRetention.drr21dPct !== null ? `${learningMetrics.delayedRetention.drr21dPct}%` : '—'}
              </div>
            </div>
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>3. Far-Transfer (FTPR / AUD)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.farTransfer.ftprPct !== null
                  ? `${learningMetrics.farTransfer.ftprPct}%`
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                AUD drop: {learningMetrics.farTransfer.audPct !== null ? `${learningMetrics.farTransfer.audPct} pts` : '—'}
              </div>
            </div>
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>4. Tutor Dependence (TDI)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.tutorDependence.latestTdi !== null
                  ? learningMetrics.tutorDependence.latestTdi.toFixed(2)
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Rolling {learningMetrics.tutorDependence.windowSize}-run share
              </div>
            </div>
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>5. Maneuver-First (MFR)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.hypothesisAndManeuver.maneuverFirstRatePct !== null
                  ? `${learningMetrics.hypothesisAndManeuver.maneuverFirstRatePct}%`
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Median TTFOH: {learningMetrics.hypothesisAndManeuver.medianTtfohMs !== null
                  ? `${Math.round(learningMetrics.hypothesisAndManeuver.medianTtfohMs / 1000)}s`
                  : '—'}
              </div>
            </div>
            <div className="p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>6. Calibration Brier &amp; Slope</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.metacognitiveCalibration.brierScore !== null
                  ? learningMetrics.metacognitiveCalibration.brierScore.toFixed(3)
                  : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Slope: {learningMetrics.metacognitiveCalibration.calibrationSlope !== null
                  ? learningMetrics.metacognitiveCalibration.calibrationSlope
                  : '—'} · Hypercorr: {learningMetrics.metacognitiveCalibration.certainErrorHypercorrectionRatePct !== null
                  ? `${learningMetrics.metacognitiveCalibration.certainErrorHypercorrectionRatePct}%`
                  : '—'}
              </div>
            </div>
            <div className="p-2.5 border md:col-span-2" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>7. Blinded Explanation Quality (EGQ)</div>
              <div className="font-mono font-bold mt-0.5">
                {learningMetrics.blindedEgqCount} anonymised entries ready
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Stripped of dates and case IDs for 14-day blind 0–2 mechanistic self-scoring
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: Recurring Mistakes & Spaced Re-test Schedule */}
        <section aria-labelledby="heading-mistakes" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="heading-mistakes" className="text-sm font-bold">
              Recurring Mistakes & Spaced Re-test Schedule
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              Leitner box tracking (1d → 3d → 7d → 21d) and top clinical remediation targets across competencies.
            </p>
          </div>

          <div className="p-4 space-y-3">
            {schedule.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {schedule.map((item: ReTestScheduleItem) => {
                  const mistakeDef = mistakesJson.mistakes.find(m => m.id === item.mistakeId);
                  const ledgerEntry = ledger.find(e => e.key === item.key);
                  return (
                    <div
                      key={item.key}
                      className="p-3 border space-y-1.5"
                      style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-bold block">{mistakeDef?.name ?? item.mistakeId}</span>
                          <span className="text-[11px] font-mono" style={{ color: 'var(--act)' }}>
                            {item.competencyId}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="vt-badge text-[11px] font-mono">
                            Box {item.box} ({item.intervalDays}d)
                          </span>
                          {item.graduated && (
                            <span className="vt-badge text-[11px]" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>
                              Graduated
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
                        <span style={{ color: 'var(--text-3)' }}>Next re-test:</span>
                        <span
                          className="font-mono font-semibold"
                          style={{ color: item.isDue ? 'var(--alarm-med)' : 'var(--text-2)' }}
                        >
                          {formatDueDate(item.dueAt)}
                        </span>
                      </div>
                      {ledgerEntry?.details?.[0] && (
                        <p className="text-[11px] italic p-1.5 border" style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                          &quot;{ledgerEntry.details[0]}&quot;
                        </p>
                      )}
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                        <strong style={{ color: 'var(--act)' }}>Remediation: </strong>
                        {mistakeDef?.response ?? 'Review clinical guidance'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {topRecurringMistakes.length > 0 ? (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {topRecurringMistakes.map(m => (
                  <div key={m.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{m.name}</span>
                      <span className="vt-badge font-mono num">
                        {m.count} {m.count === 1 ? 'time' : 'times'}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                      <strong style={{ color: 'var(--act)' }}>Remediation: </strong>
                      {m.response}
                    </p>
                  </div>
                ))}
              </div>
            ) : schedule.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                No recurring mistakes recorded yet. Clinical slips identified during simulation runs will appear here with scheduled spaced re-tests and remediation.
              </p>
            ) : null}
          </div>
        </section>

        {/* SECTION 3: Competency Grid by 8 Domains */}
        <section aria-labelledby="heading-competencies" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="heading-competencies" className="text-sm font-bold">
              Competencies by Domain
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              Complete curriculum grid across all 8 clinical domains (38 competencies). Adjust guidance overrides as desired.
            </p>
          </div>

          <div className="p-4 space-y-6">
            {isLoading && (
              <p className="text-xs animate-pulse" style={{ color: 'var(--act)' }}>Updating competency states...</p>
            )}

            {competenciesJson.domains.map(domain => (
              <div key={domain.id} className="border-t pt-4 first:border-0 first:pt-0" style={{ borderColor: 'var(--line)' }}>
                <h3 className="text-xs font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--act)' }}>
                  <span>{domain.name}</span>
                  <span className="font-normal" style={{ color: 'var(--text-3)' }}>
                    ({domain.competencies.length} competencies)
                  </span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="vt-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40%' }}>Competency</th>
                        <th>Status</th>
                        <th>Guidance</th>
                        <th>Due Date</th>
                        <th className="text-right">Guidance Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domain.competencies.map(c => {
                        const state = stateMap.get(c.id);
                        const status = state?.status ?? 'not_seen';
                        const effectiveGuidance = state?.guidanceOverride ?? state?.guidance ?? 'guided';
                        const currentOverride = state?.guidanceOverride ?? 'auto';

                        return (
                          <tr key={c.id}>
                            <td>
                              <span className="font-medium block">{c.name}</span>
                              <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{c.id}</span>
                            </td>
                            <td>
                              <span className="vt-badge text-xs">
                                {formatStatus(status)}
                              </span>
                            </td>
                            <td className="text-xs" style={{ color: 'var(--text-2)' }}>
                              {formatGuidance(effectiveGuidance)}
                            </td>
                            <td className="text-xs num" style={{ color: 'var(--text-2)' }}>
                              {formatDueDate(state?.dueAt ?? null)}
                            </td>
                            <td className="text-right">
                              <select
                                aria-label={`Guidance override for ${c.name}`}
                                data-testid={`override-${c.id}`}
                                value={currentOverride}
                                disabled={isUpdatingOverride === c.id}
                                onChange={e => handleOverrideChange(c.id, e.target.value)}
                                className="vt-select text-xs py-0 h-7"
                              >
                                <option value="auto">Auto</option>
                                <option value="guided">Guided</option>
                                <option value="prompted">Prompted</option>
                                <option value="independent">Independent</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4: Data Management (Export, Import, Reset) */}
        <section aria-labelledby="heading-data-management" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="heading-data-management" className="text-sm font-bold">
              Data Management
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              Offline backup and restore. Export your progress as JSON, restore an existing backup, or reset your learning profile.
            </p>
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Export */}
            <div className="p-3 border flex flex-col justify-between gap-3" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div>
                <h3 className="text-xs font-bold mb-1">Export Progress</h3>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  Download all learning event logs and derived competency metrics as a JSON file.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="vt-btn vt-btn--confirm w-full"
              >
                Export JSON
              </button>
            </div>

            {/* Import */}
            <div className="p-3 border flex flex-col justify-between gap-3" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div>
                <h3 className="text-xs font-bold mb-1">Import Progress</h3>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  Restore learner history from a JSON backup. Requires confirmation before replacing current data.
                </p>
              </div>
              <div>
                <label
                  htmlFor="progress-import-file"
                  className="vt-btn w-full cursor-pointer text-center"
                >
                  Choose File to Import
                </label>
                <input
                  id="progress-import-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </div>
            </div>

            {/* Reset */}
            <div className="p-3 border flex flex-col justify-between gap-3" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div>
                <h3 className="text-xs font-bold mb-1">Reset Profile</h3>
                <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>
                  Erase all progress, calibrations, and scheduled reviews. Type <strong>RESET</strong> to confirm.
                </p>
                <input
                  type="text"
                  placeholder="Type RESET"
                  value={resetInput}
                  onChange={e => setResetInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && resetInput.trim() === 'RESET') {
                      handleReset();
                    }
                  }}
                  className="vt-select w-full"
                />
              </div>
              <button
                type="button"
                disabled={resetInput.trim() !== 'RESET'}
                onClick={handleReset}
                className="vt-btn vt-btn--danger w-full"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
