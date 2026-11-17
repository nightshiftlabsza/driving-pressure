import React, { useEffect, useState, useMemo } from 'react';
import type { CaseFile, OrderType } from '../shared/caseSchema';
import type { DeviceSettings, EngineApi } from '../shared/engineTypes';
import type { LearnerEvent } from '../shared/events';
import type { RunSummary } from '../shared/learnerApi';
import type { RunState } from '../runtime/caseRuntime';
import { engine as defaultEngine } from '../engine/index';
import { IndexedDbStorage } from '../learner/storage';

import {
  extractDecisionsFromEvents,
  replayRun,
} from './replay';
import { computeExposureLedger } from './exposure';
import { classifyAllDecisions } from './classify';
import { describeDecision } from './describeDecision';
import { formatClinical } from './formatClinical';
import {
  compareTrajectories,
  findReferenceDivergence,
  runReferenceReplay,
  type ReferenceDivergence,
  type TrajectoryComparison,
} from './reference';
import {
  prepareRewindRun,
  setPendingRewind,
  getRewindMetadata,
  type RewindMetadata,
} from './rewind';
import type {
  DecisionClassification,
  DecisionInput,
  ExposureLedgerEntry,
  MetricPoint,
  ProcessClass,
  ReplayDecisionPoint,
} from './types';

export interface DecisionReviewProps {
  run: RunSummary;
  caseFile: CaseFile;
  events?: LearnerEvent[];
  engine?: EngineApi;
  onRewind?: (state: RunState) => void;
  onTrajectoryComparisonReady?: (
    comparison: TrajectoryComparison | null,
    divergence: ReferenceDivergence | null
  ) => void;
  /** Called once the replayed review data is available, so a parent can summarise it. */
  onDataReady?: (data: ComputedDecisionReviewData) => void;
}

/** Prepare a rewind run from a replayed decision point and hand it to the app (or reload the hash route). */
export function startRewindFromPoint(
  point: ReplayDecisionPoint,
  runId: string,
  caseFile: CaseFile,
  onRewind?: (state: RunState) => void
): void {
  const { state, meta } = prepareRewindRun(point, runId, caseFile);
  setPendingRewind(state, meta);
  if (onRewind) {
    onRewind(state);
  } else {
    window.location.hash = `#/trainer?case=${caseFile.id}&rewind=${meta.rewindRunId}`;
    window.location.reload();
  }
}

function formatSimTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatClassBadge(cls: ProcessClass): { label: string; style: React.CSSProperties } {
  switch (cls) {
    case 'sound':
      return {
        label: 'Sound Process',
        style: { backgroundColor: 'var(--ok-bg)', borderColor: 'var(--ok)', color: 'var(--ok)' },
      };
    case 'sound-unlucky':
      return {
        label: 'Sound (Unfavourable Response)',
        style: { backgroundColor: 'var(--ok-bg)', borderColor: 'var(--ok)', color: 'var(--ok)' },
      };
    case 'reasonable-uncertain':
      return {
        label: 'Reasonable Under Uncertainty',
        style: { backgroundColor: 'var(--info-bg)', borderColor: 'var(--act)', color: 'var(--act)' },
      };
    case 'delayed':
      return {
        label: 'Delayed Action',
        style: { backgroundColor: 'var(--warn-bg)', borderColor: 'var(--warn-line)', color: 'var(--warn-ink)' },
      };
    case 'wrong-target':
      return {
        label: 'Wrong Target',
        style: { backgroundColor: 'var(--info-bg)', borderColor: 'var(--sel)', color: 'var(--sel)' },
      };
    case 'unsafe':
      return {
        label: 'Unsafe Action',
        style: { backgroundColor: 'var(--danger-bg)', borderColor: 'var(--alarm-high)', color: 'var(--alarm-high)', fontWeight: 600 },
      };
    default:
      return {
        label: 'Unclassified',
        style: { backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' },
      };
  }
}

export interface ComputedDecisionReviewData {
  decisions: DecisionInput[];
  replayDecisions: ReplayDecisionPoint[];
  metrics: MetricPoint[];
  classifications: DecisionClassification[];
  exposureLedger: ExposureLedgerEntry[];
  trajectoryComp: TrajectoryComparison | null;
}

const reviewDataCache = new Map<string, Promise<ComputedDecisionReviewData>>();

export function clearDecisionReviewCache(): void {
  reviewDataCache.clear();
}

export const DecisionReview: React.FC<DecisionReviewProps> = ({
  run,
  caseFile,
  events: propEvents,
  engine = defaultEngine,
  onRewind,
  onTrajectoryComparisonReady,
  onDataReady,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisions, setDecisions] = useState<DecisionInput[]>([]);
  const [replayDecisions, setReplayDecisions] = useState<ReplayDecisionPoint[]>([]);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [classifications, setClassifications] = useState<DecisionClassification[]>([]);
  const [exposureLedger, setExposureLedger] = useState<ExposureLedgerEntry[]>([]);
  const [trajectoryComp, setTrajectoryComp] = useState<TrajectoryComparison | null>(null);

  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [rewindMeta, setRewindMeta] = useState<RewindMetadata | null>(null);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setLoading(true);

        // Check if this run itself was a rewind
        const meta = getRewindMetadata(run.runId);
        if (active) setRewindMeta(meta);

        const cacheKey = `${run.runId}-${caseFile.id}`;
        let promise = reviewDataCache.get(cacheKey);

        if (!promise) {
          promise = (async () => {
            // 1. Gather raw events
            let evs: LearnerEvent[] = propEvents ?? [];
            let allEvsFromStorage: LearnerEvent[] = [];
            if (typeof window !== 'undefined') {
              try {
                const storage = new IndexedDbStorage();
                allEvsFromStorage = await storage.getEvents();
                if (!evs.length) {
                  evs = allEvsFromStorage.filter(e => e.runId === run.runId);
                }
              } catch {
                // Ignore storage retrieval failure
              }
            }

            // Combine ancestral pre-rewind events with current run events (P0-5)
            let combinedEvents = evs.filter(e => e.runId === run.runId);
            let currentRunId = run.runId;
            let currentMeta = getRewindMetadata(currentRunId);
            while (currentMeta && currentMeta.parentRunId) {
              const pId = currentMeta.parentRunId;
              const parentEvents = allEvsFromStorage.length > 0
                ? allEvsFromStorage.filter(e => e.runId === pId)
                : (propEvents ?? []).filter(e => e.runId === pId);

              const parentCutoff = currentMeta.rewindAtSimSec;
              const preRewindParentEvents = parentEvents.filter(
                e => typeof e.simTimeSec === 'number' && e.simTimeSec < parentCutoff
              );

              combinedEvents = [
                ...preRewindParentEvents,
                ...combinedEvents.filter(e => typeof e.simTimeSec === 'number' && e.simTimeSec >= parentCutoff),
              ];

              currentRunId = pId;
              currentMeta = getRewindMetadata(currentRunId);
            }

            combinedEvents.sort((a, b) => (a.simTimeSec ?? 0) - (b.simTimeSec ?? 0));

            // 2. Extract decisions
            let decs = extractDecisionsFromEvents(combinedEvents);
            if (!decs.length && run.ordersTimeline?.length) {
              decs = run.ordersTimeline.map(ot => ({
                simTimeSec: ot.simTimeSec,
                kind: 'order',
                order: ot.order as OrderType,
              }));
            }

            // Determine maxSimSec from run_end simTimeSec or latest event/decision simTimeSec (never wall-clock duration)
            let maxSimSec = caseFile.maxSimMin * 60;
            const runEndEv = evs.find(e => e.type === 'run_end' && typeof e.simTimeSec === 'number');
            if (runEndEv && typeof runEndEv.simTimeSec === 'number' && runEndEv.simTimeSec > 0) {
              maxSimSec = Math.min(maxSimSec, runEndEv.simTimeSec);
            } else if (evs.length > 0 || decs.length > 0) {
              const maxEvSec = Math.max(
                0,
                ...evs.map(e => (typeof e.simTimeSec === 'number' ? e.simTimeSec : 0)),
                ...decs.map(d => d.simTimeSec)
              );
              if (maxEvSec > 0) {
                // Allow at least 10 sim-minutes after the last decision/event (capped at case maxSimMin)
                maxSimSec = Math.min(maxSimSec, Math.max(900, maxEvSec + 600));
              }
            }

            // 3. Replay run headlessly (sample interval 30s for snappy debrief performance)
            const repRes = await replayRun(caseFile, decs, { engine, sampleIntervalSec: 30, maxSimSec });

            // 4. Compute Exposure Ledger
            const ledger = computeExposureLedger(repRes.metrics);

            // 5. Classify decisions
            const snapshots = repRes.decisions.map(d => d.stateBefore);
            const classified = classifyAllDecisions(caseFile, decs, snapshots, repRes.metrics);

            // 6. Attending reference comparison
            let comp: TrajectoryComparison | null = null;
            try {
              const refResult = await runReferenceReplay(caseFile, { engine, sampleIntervalSec: 30, maxSimSec });
              if (refResult) {
                comp = compareTrajectories(caseFile, repRes.metrics, refResult.metrics);
              }
            } catch {
              // If reference run is not configured for case, continue without comparison
            }

            return {
              decisions: decs,
              replayDecisions: repRes.decisions,
              metrics: repRes.metrics,
              classifications: classified,
              exposureLedger: ledger,
              trajectoryComp: comp,
            };
          })();

          reviewDataCache.set(cacheKey, promise);
        }

        const data = await promise;
        if (!active) return;

        setDecisions(data.decisions);
        setReplayDecisions(data.replayDecisions);
        setMetrics(data.metrics);
        setExposureLedger(data.exposureLedger);
        setClassifications(data.classifications);
        setTrajectoryComp(data.trajectoryComp);
        onTrajectoryComparisonReady?.(
          data.trajectoryComp,
          data.trajectoryComp ? findReferenceDivergence(data.trajectoryComp) : null
        );
        onDataReady?.(data);
        setLoading(false);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [run.runId, caseFile, engine, propEvents, run.ordersTimeline]);

  const handleRewind = (point: ReplayDecisionPoint) => {
    startRewindFromPoint(point, run.runId, caseFile, onRewind);
  };

  if (loading) {
    return (
      <div
        className="border rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
      >
        <p className="animate-pulse">Reconstructing decision review & physiological trajectory…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="border rounded-xl p-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--alarm-high)', color: 'var(--alarm-high)' }}
      >
        <p className="font-semibold mb-1">Decision Review unavailable for this run:</p>
        <p className="text-sm font-mono" style={{ color: 'var(--text-2)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      {/* Rewind context banner if current run was rewound */}
      {rewindMeta && (
        <div
          className="p-3 border rounded-lg text-xs flex items-center justify-between"
          style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--act)', color: 'var(--text)' }}
        >
          <span>
            ↺ This run is a deliberate-practice retry from decision #{rewindMeta.decisionIndex + 1} (+{Math.floor(rewindMeta.rewindAtSimSec / 60)}m). Parent run: {rewindMeta.parentRunId}.
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--act)' }}>rewindOf: {rewindMeta.parentRunId}</span>
        </div>
      )}

      {/* SECTION 1: Decision Process Review */}
      <section
        aria-labelledby="decision-review-heading"
        className="border rounded-xl p-6 shadow-md"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="decision-review-heading" className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <span>★</span> Decision Process & Clinical Reasoning Review
              </h2>
              <span
                data-testid="decision-review-mode-badge"
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border"
                style={{
                  backgroundColor: trajectoryComp ? 'var(--ok-bg)' : 'var(--surface-2)',
                  borderColor: trajectoryComp ? 'var(--ok)' : 'var(--line)',
                  color: trajectoryComp ? 'var(--ok)' : 'var(--text-2)',
                }}
              >
                {trajectoryComp ? 'Attending Reference Case' : 'Guideline Rubric Review'}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              Judged by process given information known at each moment, not retrospective outcome alone.
            </p>
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--text-2)' }}>
            {classifications.length} Decision{classifications.length !== 1 ? 's' : ''} Evaluated
          </span>
        </div>

        {classifications.length === 0 ? (
          <p className="text-sm italic" style={{ color: 'var(--text-2)' }}>No discrete settings titrations or orders were recorded in this run.</p>
        ) : (
          <div className="space-y-3">
            {classifications.map((item, idx) => {
              const repPoint = replayDecisions[idx];
              const badge = formatClassBadge(item.processClass);
              const isExpanded = expandedIndex === idx;

              return (
                <div
                  key={idx}
                  className="border rounded-lg transition-all"
                  style={{
                    backgroundColor: isExpanded ? 'var(--surface-2)' : 'var(--surface)',
                    borderColor: isExpanded ? 'var(--line-strong)' : 'var(--line)',
                  }}
                >
                  {/* Timeline Header Row */}
                  <div
                    onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                    className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="font-mono text-xs font-semibold px-2 py-0.5 rounded border"
                        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--line)', color: 'var(--act)' }}
                      >
                        {formatSimTime(item.decision.simTimeSec)}
                      </span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {describeDecision(item.decision, repPoint?.stateBefore?.engine?.device)}
                      </span>
                      {item.isRescueAction && (
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border"
                          style={{ backgroundColor: 'var(--surface-3)', borderColor: 'var(--act)', color: 'var(--act)' }}
                        >
                          Rescue
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs px-2.5 py-0.5 rounded-full border"
                        style={badge.style}
                      >
                        {badge.label}
                      </span>
                      <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Expanded Decision Context Card */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t space-y-4 text-xs" style={{ borderColor: 'var(--line)' }}>
                      {/* 1. What was known */}
                      <div className="p-3 rounded border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}>
                        <span className="font-semibold block mb-1.5 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-2)' }}>
                          1. Information Available at Decision Time
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono" style={{ color: 'var(--text-2)' }}>
                          <div>SpO2: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('spo2', item.context.monitored.spo2)}%</span></div>
                          <div>PaCO2: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('paco2', item.context.monitored.paco2)} mmHg</span></div>
                          <div>pH: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('ph', item.context.monitored.ph)}</span></div>
                          <div>Driving P (ΔP): <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('drivingPressure', item.context.monitored.drivingPressure)} cmH2O</span></div>
                          <div>Pplat: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('pplat', item.context.monitored.pplat)} cmH2O</span></div>
                          <div>MAP: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('map', item.context.monitored.map)} mmHg</span></div>
                          <div>RR: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatClinical('rr', item.context.monitored.rrTotal)} bpm</span></div>
                          <div>Device: <span className="font-semibold" style={{ color: 'var(--act)' }}>{item.context.device.device}</span></div>
                        </div>

                        {item.context.lastAbg ? (
                          <div className="mt-2 pt-2 border-t text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                            <span className="font-medium" style={{ color: 'var(--act)' }}>Most Recent ABG: </span>
                            pH {formatClinical('ph', item.context.lastAbg.ph)}, PaCO2 {formatClinical('paco2', item.context.lastAbg.paco2)} mmHg, PaO2 {formatClinical('pao2', item.context.lastAbg.pao2)} mmHg, SaO2 {formatClinical('spo2', item.context.lastAbg.sao2)}%.
                          </div>
                        ) : (
                          <div className="mt-2 pt-2 border-t text-[11px] italic" style={{ borderColor: 'var(--line)', color: 'var(--text-3)' }}>
                            No arterial blood gas returned at this moment.
                          </div>
                        )}

                        {item.context.activeAlarms.length > 0 && (
                          <div className="mt-1 text-[11px]" style={{ color: 'var(--alarm-high)' }}>
                            ⚠️ Active alarms: {item.context.activeAlarms.join(', ')}
                          </div>
                        )}

                        {item.context.committedAssessment && (
                          <div className="mt-2 p-2 border rounded" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                            <strong style={{ color: 'var(--text)' }}>Committed assessment:</strong> {item.context.committedAssessment}
                            {item.context.confidence && (
                              <span className="ml-2" style={{ color: 'var(--text-3)' }}>({item.context.confidence})</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 2. What happened */}
                      <div className="p-3 rounded border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}>
                        <span className="font-semibold block mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-2)' }}>
                          2. Physiological Response (Next 10-15 Sim-Minutes)
                        </span>
                        <p className="leading-relaxed" style={{ color: 'var(--text)' }}>{item.response.summary}</p>
                      </div>

                      {/* 3. Classification, Rule & Evidence Source */}
                      <div className="border p-3 rounded space-y-1.5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11px] uppercase tracking-wide" style={{ color: 'var(--act)' }}>
                            Process Evaluation
                          </span>
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{item.ruleId}</span>
                        </div>
                        <p className="leading-relaxed" style={{ color: 'var(--text)' }}>{item.ruleExplanation}</p>
                        <div className="pt-1 text-[11px]" style={{ color: 'var(--text-2)' }}>
                          <span className="font-semibold" style={{ color: 'var(--text)' }}>Source: </span>
                          <span className="italic">{item.source}</span>
                        </div>
                      </div>

                      {/* 4. Rewind Action */}
                      {repPoint && (
                        <div className="pt-1 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleRewind(repPoint)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium text-xs shadow transition-colors"
                            style={{ backgroundColor: 'var(--act)', color: 'var(--act-ink)' }}
                          >
                            <span>↺</span> Try again from here
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: Exposure Ledger */}
      <section
        aria-labelledby="exposure-ledger-heading"
        className="border rounded-xl p-6 shadow-md"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <h2 id="exposure-ledger-heading" className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--text)' }}>
          <span>⏱</span> Exposure Ledger
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-2)' }}>
          Cumulative duration exceeding evidence-based physiological injury thresholds. Reporting only; does not alter patient model.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" style={{ color: 'var(--text)' }}>
            <thead className="uppercase text-[10px] border-b" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}>
              <tr>
                <th className="py-2.5 px-3">Hazard / Threshold</th>
                <th className="py-2.5 px-3">Cumulative Exposure</th>
                <th className="py-2.5 px-3">Observed Peak / Min</th>
                <th className="py-2.5 px-3">Evidence Source</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {exposureLedger.map(entry => (
                <tr key={entry.ruleId}>
                  <td className="py-2.5 px-3 font-medium" style={{ color: 'var(--text)' }}>
                    <div>{entry.name}</div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>{entry.conditionDescription}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className="inline-block px-2 py-0.5 rounded font-mono font-semibold border"
                      style={{
                        backgroundColor: entry.durationSimMinutes > 0 ? 'var(--danger-bg)' : 'var(--ok-bg)',
                        borderColor: entry.durationSimMinutes > 0 ? 'var(--alarm-high)' : 'var(--ok)',
                        color: entry.durationSimMinutes > 0 ? 'var(--alarm-high)' : 'var(--ok)',
                      }}
                    >
                      {entry.durationSimMinutes.toFixed(1)} sim-min
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono" style={{ color: 'var(--text)' }}>
                    {entry.maxObservedValue !== null ? entry.maxObservedValue : '--'}
                  </td>
                  <td className="py-2.5 px-3 text-[11px] italic max-w-xs" style={{ color: 'var(--text-2)' }}>
                    {entry.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 3: Attending Reference Run Comparison */}
      {trajectoryComp && (
        <section
          aria-labelledby="reference-run-heading"
          className="border rounded-xl p-6 shadow-md"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h2 id="reference-run-heading" className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <span>📈</span> Attending Trajectory Comparison
              </h2>
              <span
                className="inline-block mt-1 px-2.5 py-0.5 rounded text-xs font-semibold border"
                style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line-strong)', color: 'var(--act)' }}
              >
                {trajectoryComp.referenceLabel}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--ok)' }}>
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: 'var(--ok)' }} /> Your run
              </span>
              <span className="flex items-center gap-1.5" style={{ color: 'var(--act)' }}>
                <span className="w-3 h-0.5 border-t border-dashed inline-block" style={{ borderColor: 'var(--act)' }} /> Attending
              </span>
            </div>
          </div>

          <p className="text-xs mb-6" style={{ color: 'var(--text-2)' }}>
            Compare your trajectory with an authored attending approach ({trajectoryComp.referenceSource}). Never presented as the only correct path.
          </p>

          {/* Small Multiples Charts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {trajectoryComp.metrics.map(m => {
              const range = Math.max(0.1, m.maxVal - m.minVal);
              const svgW = 240;
              const svgH = 80;

              const toSvg = (pts: { simTimeSec: number; value: number | null }[]) => {
                const valid = pts.filter(p => p.value !== null && Number.isFinite(p.value));
                if (!valid.length) return '';
                const maxT = Math.max(1, ...pts.map(p => p.simTimeSec));
                return valid
                  .map((p, i) => {
                    const x = (p.simTimeSec / maxT) * (svgW - 20) + 10;
                    const y = svgH - 10 - (((p.value! - m.minVal) / range) * (svgH - 20));
                    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                  })
                  .join(' ');
              };

              const learnerPath = toSvg(m.learnerSeries);
              const refPath = toSvg(m.referenceSeries);

              const lastLearner = m.learnerSeries[m.learnerSeries.length - 1]?.value;
              const lastRef = m.referenceSeries[m.referenceSeries.length - 1]?.value;

              return (
                <div
                  key={m.metric}
                  className="border rounded-lg p-3"
                  style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{m.label}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>{m.unit}</span>
                  </div>

                  <svg
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    className="w-full h-20 rounded border"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--line)' }}
                  >
                    {/* Reference path (dashed purple) */}
                    {refPath && (
                      <path
                        d={refPath}
                        fill="none"
                        stroke="var(--sel)"
                        strokeWidth="1.75"
                        strokeDasharray="4 3"
                      />
                    )}
                    {/* Learner path (solid teal) */}
                    {learnerPath && (
                      <path
                        d={learnerPath}
                        fill="none"
                        stroke="var(--ok)"
                        strokeWidth="2"
                      />
                    )}
                  </svg>

                  <div className="flex justify-between text-[11px] font-mono mt-1.5" style={{ color: 'var(--text-2)' }}>
                    <span>You: <strong style={{ color: 'var(--ok)' }}>{lastLearner !== undefined && lastLearner !== null ? lastLearner.toFixed(1) : '--'}</strong></span>
                    <span>Attending: <strong style={{ color: 'var(--act)' }}>{lastRef !== undefined && lastRef !== null ? lastRef.toFixed(1) : '--'}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Authored decisions list */}
          <div className="border rounded-lg p-4 text-xs" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
            <span className="font-semibold uppercase tracking-wider text-[10px] block mb-2" style={{ color: 'var(--text-2)' }}>
              Attending Decisions Sequence ({trajectoryComp.referenceTitle})
            </span>
            <ul className="space-y-2">
              {trajectoryComp.referenceDecisions.map((rd, i) => (
                <li key={i} className="flex items-start gap-2" style={{ color: 'var(--text-2)' }}>
                  <span
                    className="font-mono font-semibold px-1.5 py-0.5 rounded border"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--act)' }}
                  >
                    +{Math.floor(rd.simTimeSec / 60)}m
                  </span>
                  <div>
                    <span className="font-medium" style={{ color: 'var(--text)' }}>{rd.rationale}</span>
                    <div className="text-[10px] italic mt-0.5" style={{ color: 'var(--text-3)' }}>{rd.source}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};
