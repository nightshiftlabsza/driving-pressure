/**
 * Replay engine: rebuilds a run headlessly from a case file and logged decisions.
 * Uses only exported runtime and engine functions. Pure and deterministic.
 */
import type { CaseFile, Metric, OrderType } from '../shared/caseSchema';
import type { DeviceSettings, EngineApi } from '../shared/engineTypes';
import type { Confidence, EventSink, LearnerEvent } from '../shared/events';
import {
  advance,
  answerPrediction,
  currentPrediction,
  metric,
  placeOrder,
  startHold,
  startRun,
  type Direction,
  type RunState,
  type Runtime,
} from '../runtime/caseRuntime';
import { engine as defaultEngine } from '../engine/index';
import type { DecisionInput, MetricPoint, ReplayDecisionPoint, ReplayOptions, ReplayResult } from './types';

/** Minimal event sink that stores emitted events in memory for replay. */
class ReplayEventSink implements EventSink {
  public readonly events: LearnerEvent[] = [];
  async record(e: LearnerEvent): Promise<void> {
    this.events.push(structuredClone(e));
  }
}

/** Sample key metrics at the current instant using the runtime metric() function. */
export function sampleMetrics(run: RunState): MetricPoint {
  const get = (m: Metric) => metric(run, m);
  return {
    simTimeSec: Math.round(run.engine.simTimeSec),
    spo2: get('spo2'),
    paco2: get('paco2'),
    pao2: get('pao2'),
    ph: get('ph'),
    pplat: get('pplat'),
    drivingPressure: get('drivingPressure'),
    ppeak: get('ppeak'),
    peep: get('peep'),
    vte: get('vte'),
    vteMlKgPbw: get('vteMlKgPbw'),
    fio2: get('fio2'),
    map: get('map'),
    hr: get('hr'),
    rrTotal: get('rrTotal'),
    pfRatio: get('pfRatio'),
  };
}

/** Extract decision inputs from a logged sequence of LearnerEvents. */
export function extractDecisionsFromEvents(events: LearnerEvent[], runId?: string): DecisionInput[] {
  const filtered = runId ? events.filter(e => e.runId === runId) : events;
  const decisions: DecisionInput[] = [];

  let pendingAssessment: { text: string; confidence?: Confidence } | null = null;
  let pendingRationale: string | null = null;

  for (const ev of filtered) {
    const t = ev.simTimeSec ?? 0;

    if ((ev as unknown as { type: string }).type === 'assessment_commit') {
      const custom = ev as unknown as {
        assessment?: string;
        assessments?: string[];
        confidence?: Confidence;
      };
      const text = Array.isArray(custom.assessments) && custom.assessments.length > 0
        ? custom.assessments.join(', ')
        : (custom.assessment ?? '');
      pendingAssessment = { text, confidence: custom.confidence };
      continue;
    }
    if ((ev as unknown as { type: string }).type === 'rationale') {
      const custom = ev as unknown as { rationale?: string; reasonId?: string };
      pendingRationale = custom.reasonId ?? custom.rationale ?? null;
      continue;
    }

    if (ev.type === 'order') {
      if (ev.order === 'change-settings') {
        decisions.push({
          id: ev.id,
          simTimeSec: t,
          kind: 'settings_change',
          order: 'change-settings',
          detail: ev.detail,
          assessment: pendingAssessment?.text,
          confidence: pendingAssessment?.confidence,
          rationale: pendingRationale ?? undefined,
        });
        pendingAssessment = null;
        pendingRationale = null;
      } else if (ev.order === 'change-device') {
        decisions.push({
          id: ev.id,
          simTimeSec: t,
          kind: 'settings_change',
          order: 'change-device',
          detail: ev.detail,
          assessment: pendingAssessment?.text,
          confidence: pendingAssessment?.confidence,
          rationale: pendingRationale ?? undefined,
        });
        pendingAssessment = null;
        pendingRationale = null;
      } else {
        decisions.push({
          id: ev.id,
          simTimeSec: t,
          kind: 'order',
          order: ev.order,
          detail: ev.detail,
          assessment: pendingAssessment?.text,
          confidence: pendingAssessment?.confidence,
          rationale: pendingRationale ?? undefined,
        });
        pendingAssessment = null;
        pendingRationale = null;
      }
    } else if (ev.type === 'observe') {
      // A deliberate decision to change nothing and watch.
      decisions.push({ id: ev.id, simTimeSec: ev.fromSimSec, kind: 'observe', detail: { toSimSec: ev.toSimSec, stoppedBy: ev.stoppedBy } });
    } else if (ev.type === 'settings_change') {
      const alreadyLogged = decisions.some(
        d => d.simTimeSec === t && d.kind === 'settings_change' && (d.detail?.settings || d.settings)
      );
      if (!alreadyLogged) {
        decisions.push({
          id: ev.id,
          simTimeSec: t,
          kind: 'settings_change',
          settings: ev.after,
          assessment: pendingAssessment?.text,
          confidence: pendingAssessment?.confidence,
          rationale: pendingRationale ?? undefined,
        });
        pendingAssessment = null;
        pendingRationale = null;
      }
    }
  }

  return decisions.sort((a, b) => a.simTimeSec - b.simTimeSec);
}

/**
 * Replay a case run headlessly from case file and decisions.
 * Returns the metric series and RunState snapshots before/after each decision.
 */
export async function replayRun(
  caseFile: CaseFile,
  decisions: DecisionInput[],
  options: ReplayOptions = {}
): Promise<ReplayResult> {
  const engine = options.engine ?? defaultEngine;
  const sink = new ReplayEventSink();
  const rt: Runtime = { engine, sink };

  const sampleInterval = Math.max(1, options.sampleIntervalSec ?? 5);
  const maxSimSec = options.maxSimSec ?? caseFile.maxSimMin * 60;

  const run = await startRun(rt, caseFile, {
    sessionId: 'replay-session',
    runId: 'replay-' + caseFile.id,
  });

  const sortedDecisions = [...decisions].sort((a, b) => a.simTimeSec - b.simTimeSec);
  const metrics: MetricPoint[] = [];
  const replayDecisions: ReplayDecisionPoint[] = [];

  // Sample t = 0
  metrics.push(sampleMetrics(run));

  let decisionIdx = 0;

  async function resolvePendingPrediction() {
    if (!run.pendingPrediction) return;
    const pred = currentPrediction(run);
    if (!pred) return;
    const provided = options.predictionAnswers?.[pred.id];
    let ans = provided?.answer ?? pred.answerKey;
    if (ans === undefined) {
      if (pred.format === 'direction') {
        const fallback: Record<string, Direction> = {};
        for (const v of pred.variables ?? []) fallback[v] = 'same';
        ans = fallback;
      } else if (pred.format === 'numeric') {
        ans = 0;
      } else {
        ans = pred.options?.[0] ?? '';
      }
    }
    const conf = provided?.confidence ?? 'fairly_sure';
    await answerPrediction(rt, run, ans as string | number | Record<string, Direction>, conf);
  }

  async function advanceTo(targetSec: number) {
    while (run.engine.simTimeSec < targetSec - 1e-6) {
      if (run.ended) break;

      await resolvePendingPrediction();

      const remaining = targetSec - run.engine.simTimeSec;
      if (remaining <= 1e-6) break;

      const step = Math.min(remaining, sampleInterval);
      const res = await advance(rt, run, step, false);

      if (res.paused === 'prediction') {
        await resolvePendingPrediction();
      }

      const curSec = Math.round(run.engine.simTimeSec);
      if (!metrics.length || curSec - metrics[metrics.length - 1]!.simTimeSec >= sampleInterval - 0.5) {
        metrics.push(sampleMetrics(run));
      }

      if (res.paused === 'ended') {
        break;
      }
    }
  }

  // Execute decisions in chronological order
  for (const dec of sortedDecisions) {
    if (run.ended) break;

    const decTime = Math.min(maxSimSec, Math.max(0, dec.simTimeSec));
    await advanceTo(decTime);

    // Snapshot state before decision
    const stateBefore = structuredClone(run);

    // Apply decision
    try {
      if (dec.kind === 'observe') {
        // Nothing is applied: the replay clock simply runs on to the next decision.
      } else if (dec.kind === 'hold') {
        startHold(rt, run, dec.holdKind ?? 'insp-hold');
      } else if (dec.kind === 'settings_change') {
        if (dec.order === 'change-device' && dec.detail) {
          await placeOrder(rt, run, 'change-device', dec.detail);
        } else if (dec.settings) {
          const currentDevice = run.engine.device;
          if (dec.settings.device && dec.settings.device !== currentDevice.device) {
            await placeOrder(rt, run, 'change-device', { device: dec.settings });
          } else {
            await placeOrder(rt, run, 'change-settings', { settings: dec.settings });
          }
        } else if (dec.detail) {
          await placeOrder(rt, run, 'change-settings', dec.detail);
        }
      } else if (dec.kind === 'order' && dec.order) {
        await placeOrder(rt, run, dec.order, dec.detail);
      }
    } catch {
      // Graceful fallback if order is not valid in this case state
    }

    // Snapshot state after decision
    const stateAfter = structuredClone(run);

    replayDecisions.push({
      index: decisionIdx++,
      decision: dec,
      simTimeSec: Math.round(run.engine.simTimeSec),
      stateBefore,
      stateAfter,
    });

    // Sample immediately following decision
    const curT = Math.round(run.engine.simTimeSec);
    if (!metrics.length || metrics[metrics.length - 1]!.simTimeSec !== curT) {
      metrics.push(sampleMetrics(run));
    }
  }

  // Advance to end of simulation
  await advanceTo(maxSimSec);

  // Final point
  const endSec = Math.round(run.engine.simTimeSec);
  if (!metrics.length || metrics[metrics.length - 1]!.simTimeSec !== endSec) {
    metrics.push(sampleMetrics(run));
  }

  return {
    caseId: caseFile.id,
    metrics,
    decisions: replayDecisions,
    finalState: run,
  };
}
