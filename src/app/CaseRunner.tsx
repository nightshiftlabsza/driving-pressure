import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaseFile, OrderType } from '../shared/caseSchema';
import type { DeviceSettings, EngineApi, WaveformSample } from '../shared/engineTypes';
import type { Confidence, EventSink, GuidanceLevel } from '../shared/events';
import { EVENT_SCHEMA_VERSION, isEvidenceEvent } from '../shared/events';
import {
  ABG_DELAY_SIM_SEC, advance, answerPrediction, currentPrediction, evidenceGuidance, finishRun, noteAssistance, observe, placeOrder, startHold, startRun,
  type Direction, type Observation, type PredictionFeedback, type RunState, type Runtime,
} from '../runtime/caseRuntime';
import { pbwKg } from '../engine/devices';
import { SweepWaveforms, MonitorStrip, VentNumerics, AlarmBanner } from '../display';
import { VentControls } from './vent/VentControls';
import { CaseProgress, caseStages } from './CaseProgress';
import { OpenCircuitPanel, type VitalSample } from './OpenCircuitPanel';
import { withVitalsRecording } from './vitalsHistory';

import { defaultLimits, evaluateAlarms, silenceAlarms, isAlarmSilenced, acknowledgeAlarm, LIMIT_DEFS, type Limits, type AlarmState, type ActiveAlarm } from '../alarms';
import { DEVICE_LONG, MODE_LONG, modeKey, modeTitle, type VentSkin } from './vent/settings';
import { TutorPanel } from '../tutor/TutorPanel';
import { buildActiveCaseContext } from '../tutor/context';
import { registerBugContext } from '../bugreport/diagnostics';
import { createCaseTutorAdapter } from '../tutor/caseAdapter';
import type { ManeuverType } from '../tutor/types';
import { HandoffCard } from '../bedside/HandoffCard';
import { getHandoff } from '../bedside/handoffLoader';
import { CommitSheet } from '../bedside/CommitSheet';
import { getAssessmentKey } from '../bedside/assessmentLoader';
import { RationaleChip } from '../bedside/RationaleChip';
import { isRescueOrder, isRescueSettingsChange } from '../bedside/rescueActions';
import { isMajorSettingsChange, canShowRationale } from '../bedside/rationaleLogic';
import { describeSettingsChange } from '../review/describeDecision';
import { useScaffolds } from '../bedside/useScaffolds';
import { SettingLoopPanel, SettingLoopResult, type SettingLoopAnswer } from '../bedside/SettingLoopPanel';
import {
  classifySettingChange, shouldPrompt, afterChange, afterOutcome, loadFade, saveFade, snapshotReadouts, compareExpectations, fullyMatched, loopReassessReady, loopScoringDecision,
  REASSESS_SEC, SETTING_LABEL, type Readouts, type ReadoutKey, type LoopDirection, type ComparisonRow, type SettingType, type FadeMap,
} from '../bedside/settingLoop';
import { newId } from '../shared/eventSink';
import { scheduleDelayedRetest } from '../tutor/store';

const TICK_MS = 40;
const BUFFER_SEC = 12;
const GHOST_SEC = 5; // roughly two breaths of the pre-change waveform

const ORDER_LABELS: Partial<Record<OrderType, string>> = {
  abg: 'Arterial blood gas', cxr: 'Chest X-ray', examine: 'Examine patient', intubate: 'Intubate', extubate: 'Extubate',
  suction: 'Suction tube', bronchodilator: 'Bronchodilator', steroid: 'Steroid', diuretic: 'Diuretic', 'fluid-bolus': 'Fluid bolus',
  vasopressor: 'Vasopressor', sedation: 'Sedation', paralysis: 'Paralysis', prone: 'Prone position', recruitment: 'Recruitment manoeuvre',
  'disconnect-ventilator': 'Disconnect from ventilator', 'needle-decompression': 'Needle decompression', 'call-senior': 'Call senior',
};
const ORDERS_HANDLED_ELSEWHERE: OrderType[] = ['change-device', 'change-settings'];
const IRREVERSIBLE: OrderType[] = ['intubate', 'extubate', 'needle-decompression', 'paralysis'];

const METRIC_LABELS: Record<string, string> = { paco2: 'PaCO2', ph: 'pH', pao2: 'PaO2', spo2: 'SpO2', rrTotal: 'Resp rate', rrSpont: 'Spont rate', vte: 'VTe', map: 'MAP', hr: 'HR', etco2: 'EtCO2', pplat: 'Pplat', autoPeep: 'Auto-PEEP', fatigue: 'Fatigue', pfRatio: 'P/F', minuteVent: 'Minute ventilation', ppeak: 'Ppeak', sbp: 'SBP', drivingPressure: 'Driving pressure' };

const OBSERVE_STOP_TEXT: Record<Observation['stoppedBy'], string> = {
  ended: 'the case reached its end',
  prediction: 'there is a question to answer',
  result: 'a result came back',
  message: 'the bedside called you',
  change: 'the vital signs changed',
  limit: 'thirty minutes passed with nothing new',
};

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function f(v: number | null | undefined, d = 0) { return v === null || v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(d); }

type SidePane = 'story' | 'orders' | 'gases' | 'log' | 'tutor';

export interface CaseRunnerProps {
  caseFile: CaseFile;
  engine: EngineApi;
  sink: EventSink;
  sessionId: string;
  /** Called after finishRun with the run id, so the parent can show the debrief. */
  onFinished: (runId: string) => void;
  /** Start paused (tests). */
  autoplay?: boolean;
  skin?: VentSkin;
  initialRunState?: RunState;
  guidanceMap?: Record<string, GuidanceLevel>;
}

export const CaseRunner: React.FC<CaseRunnerProps> = ({ caseFile, engine, sink, sessionId, onFinished, autoplay = true, skin, initialRunState, guidanceMap }) => {
  const isTransferVariantCase = caseFile.id.includes('--');
  const transferRubricFailureRef = useRef(false);
  const effectiveSink = useMemo<EventSink>(() => {
    if (!isTransferVariantCase) return sink;
    return {
      record: async ev => {
        if (ev.type === 'rubric_result' && !ev.met) {
          transferRubricFailureRef.current = true;
        }
        if (ev.type === 'run_start') {
          transferRubricFailureRef.current = false;
          await sink.record({
            ...ev,
            tutorMode: 'exam_silent',
            isTransferVariant: true,
            transferVariantId: caseFile.id,
          });
          return;
        }
        if (isEvidenceEvent(ev)) {
          await sink.record({
            ...ev,
            tutorMode: 'exam_silent',
            isTransferVariant: true,
            transferVariantId: caseFile.id,
            assistance: ev.assistance ?? {
              assistedInWindow: false,
              maxHelpLevelUsed: 0,
              hintCountInProblem: 0,
              tutorTurnsBeforeCommit: 0,
              reconstructionPassed: null,
              timeToFirstHypothesisMs: 0,
            },
          });
          return;
        }
        await sink.record(ev);
        if (
          ev.type === 'run_end' &&
          (ev.outcome === 'died' || ev.outcome === 'deteriorated' || transferRubricFailureRef.current)
        ) {
          const nowMs = Date.now();
          const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
          for (const compId of caseFile.competencies || []) {
            await scheduleDelayedRetest({
              id: `transfer_retest_${caseFile.id}_${compId}`,
              competencyId: compId,
              caseId: caseFile.id,
              variantId: caseFile.id,
              dueAt: nowMs + fiveDaysMs,
              createdAt: nowMs,
              completedAt: null,
              passed: null,
              source: 'transfer_fail',
            });
          }
        }
      },
    };
  }, [sink, isTransferVariantCase, caseFile.id, caseFile.competencies]);
  const vitalsHistory = useRef<VitalSample[]>([]);
  const rt = useRef<Runtime>({ engine: withVitalsRecording(engine, vitalsHistory.current), sink: effectiveSink }).current;
  rt.sink = effectiveSink;
  const runRef = useRef<RunState | null>(null);
  const buffer = useRef<WaveformSample[]>([]);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Study time is real time spent in this case; patient time is the simulated clinical clock.
  const [studyStart] = useState(() => Date.now());
  const [, setStudyTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setStudyTick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  const [lastObs, setLastObs] = useState<Observation | null>(null);
  const [endSeen, setEndSeen] = useState(false);
  const [feedback, setFeedback] = useState<{ question: string; fb: PredictionFeedback } | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<OrderType | null>(null);

  const handoffData = useMemo(() => getHandoff(caseFile.id, caseFile), [caseFile.id, caseFile]);
  const [showHandoff, setShowHandoff] = useState<boolean>(() => !initialRunState && handoffData !== null);
  const [showHandoffReview, setShowHandoffReview] = useState(false);

  const [committedAssessments, setCommittedAssessments] = useState<string[] | null>(null);
  const [committedConfidence, setCommittedConfidence] = useState<Confidence | null>(null);
  const [showCommitSheet, setShowCommitSheet] = useState(false);
  const [isCommitRevision, setIsCommitRevision] = useState(false);
  const [pendingTitration, setPendingTitration] = useState<
    | { kind: 'order'; order: OrderType; detail?: Record<string, unknown> }
    | { kind: 'settings'; next: DeviceSettings; typeChanged: boolean }
    | null
  >(null);

  // Setting-change learning loop: open prompt, predictions waiting for their reassess time, and the last comparison.
  const [loopPrompt, setLoopPrompt] = useState<{ type: SettingType; baseline: Readouts; id: string; changeSimSec: number } | null>(null);
  const changeTimesRef = useRef<number[]>([]);
  const loopDue = useRef<{ id: string; type: SettingType; baseline: Readouts; expect: Partial<Record<ReadoutKey, LoopDirection>>; dueSimSec: number | null; changeSimSec: number }[]>([]);
  const fadeRef = useRef<FadeMap | null>(null);
  const [loopResult, setLoopResult] = useState<{ type: SettingType; rows: ComparisonRow[]; notScored?: boolean } | null>(null);
  const [ghost, setGhost] = useState<WaveformSample[] | undefined>(undefined);
  // Small status label by the settings: what was just requested and is still waiting to take effect.
  const [queued, setQueued] = useState<{ kind: 'settings' | 'hold'; sinceSimSec: number; lastBreathEnd: number } | null>(null);
  const [activeRationale, setActiveRationale] = useState<{
    changeSummary: string;
    targetAction: { kind: 'settings_change' | 'order'; id?: string; detail?: unknown };
  } | null>(null);
  const [lastRationaleSimSec, setLastRationaleSimSec] = useState<number | null>(null);
  const [lastAlarmDrivenRescueSimSec, setLastAlarmDrivenRescueSimSec] = useState<number | null>(null);
  const [tutorCompletionBlocked, setTutorCompletionBlocked] = useState<boolean>(false);
  // Tutor turns already counted on this run: the episode state reports turnCount after each
  // successful tutor reply (RECORD_TUTOR_RESPONSE), so an increase here is one more used turn.
  const tutorTurnsCountedRef = useRef(0);
  const [aiTutorEnabled, setAiTutorEnabled] = useState<boolean>(false);
  const effectiveTutorBlocked = Boolean(aiTutorEnabled && tutorCompletionBlocked);

  useEffect(() => {
    if (!aiTutorEnabled && tutorCompletionBlocked) {
      setTutorCompletionBlocked(false);
    }
  }, [aiTutorEnabled, tutorCompletionBlocked]);

  // Start the run once. The promise is kept in a ref so React StrictMode's double effect does not start two runs.
  const starting = useRef<Promise<RunState> | null>(null);
  useEffect(() => {
    let active = true;
    starting.current ??= initialRunState
      ? (async () => {
          const resumed = structuredClone(initialRunState);
          resumed.sessionId = sessionId;
          await rt.sink.record({
            v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION,
            id: newId(),
            wallTime: new Date().toISOString(),
            sessionId,
            runId: resumed.runId,
            activity: 'case',
            activityId: caseFile.id,
            activityVersion: caseFile.version,
            simTimeSec: Math.round(resumed.engine.simTimeSec),
            contextTags: caseFile.contextTags,
            type: 'run_start',
            guidanceByCompetency: resumed.guidance,
          });
          return resumed;
        })()
      : startRun(rt, caseFile, { sessionId, guidance: guidanceMap });
    starting.current.then(run => { if (active) { runRef.current = run; rerender(); } }, e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [caseFile, rt, sessionId, rerender, initialRunState, guidanceMap]);

  // All work on the run is serialised through one promise chain, so a click never interleaves with a tick
  // and is never dropped. Ticks are skipped (not queued) while anything else is pending.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const guarded = useCallback((fn: (run: RunState) => Promise<void>, opts: { isTick?: boolean } = {}) => {
    if (opts.isTick && (!runRef.current || pending.current > 0)) return Promise.resolve();
    pending.current++;
    const job = queue.current.catch(() => {}).then(async () => {
      try {
        const run = runRef.current;
        if (!run) return;
        await fn(run);
        if (!opts.isTick) setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        pending.current--;
        rerender();
      }
    });
    queue.current = job;
    return job;
  }, [rerender]);

  // Real-time loop. Clock stays paused while the blind handoff card is open.
  useEffect(() => {
    if (!playing || showHandoff) return;
    const id = setInterval(() => {
      void guarded(async run => {
        if (run.ended || run.pendingPrediction || showHandoff) return;
        const r = await advance(rt, run, (TICK_MS / 1000) * speed, true);
        const buf = buffer.current;
        buf.push(...r.samples);
        const cutoff = run.engine.simTimeSec - BUFFER_SEC;
        let i = 0; while (i < buf.length && buf[i]!.tSec < cutoff) i++;
        if (i) buf.splice(0, i);
      }, { isTick: true });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, showHandoff, guarded, rt]);

  const { effectiveGuidance, scaffolds, formatInspHold, formatExpHold } = useScaffolds(
    guidanceMap ?? runRef.current?.guidance,
    caseFile.competencies
  );

  const skip = (min: number) => guarded(async run => { await advance(rt, run, min * 60, false); buffer.current = []; });
  const goDebrief = () => {
    if (effectiveTutorBlocked) {
      setEndSeen(true);
      setError('Complete your unaided causal reconstruction in AI Tutor before ending this case.');
      return;
    }
    void guarded(async r => { if (!r.finished) await finishRun(rt, r, !r.ended); onFinished(r.runId); });
  };
  const doObserve = () => guarded(async run => { setLastObs(await observe(rt, run, 30)); buffer.current = []; });

  const executeOrder = (o: OrderType, detail?: Record<string, unknown>) => guarded(async run => {
    if (isRescueOrder(o)) {
      setLastAlarmDrivenRescueSimSec(run.engine.simTimeSec);
    }
    await placeOrder(rt, run, o, detail);
  });

  const executeDeviceChange = (next: DeviceSettings, typeChanged: boolean) => {
    const cur = runRef.current;
    const prev = cur ? cur.engine.device : null;
    const isRescue = isRescueSettingsChange(next);
    if (isRescue && cur) {
      setLastAlarmDrivenRescueSimSec(cur.engine.simTimeSec);
    }
    if (cur) changeTimesRef.current.push(cur.engine.simTimeSec);
    let loopShown = false;
    if (cur && prev) {
      // Ghost: keep the last ~2 breaths from before the change, laid out from the moment of the change.
      const old = buffer.current.filter(s => s.tSec >= cur.engine.simTimeSec - GHOST_SEC);
      if (old.length) {
        const shift = cur.engine.simTimeSec - old[0]!.tSec;
        setGhost(old.map(s => ({ ...s, tSec: s.tSec + shift })));
      }
      const type = classifySettingChange(prev, next);
      // The panel is non-modal and skippable, so it may show during alarms; only rescue changes skip it.
      fadeRef.current ??= loadFade();
      const st = fadeRef.current[type];
      const prompt = !isRescue && shouldPrompt(st);
      if (!isRescue) {
        fadeRef.current = { ...fadeRef.current, [type]: afterChange(st, prompt) };
        saveFade(fadeRef.current);
      }
      if (prompt) {
        loopShown = true;
        setLoopResult(null);
        setLoopPrompt({ type, baseline: snapshotReadouts(cur.engine.monitored), id: newId(), changeSimSec: cur.engine.simTimeSec });
      }
    }
    void guarded(async run => {
      const o: OrderType = typeChanged ? 'change-device' : 'change-settings';
      const detail = typeChanged ? { device: next } : { settings: next };
      await placeOrder(rt, run, o, detail);
      setQueued({ kind: 'settings', sinceSimSec: run.engine.simTimeSec, lastBreathEnd: run.engine.lastBreath?.endTimeSec ?? -1 });
      if (!run.ended && !run.pendingPrediction) {
        const r = await advance(rt, run, 0.04 * speed, true);
        buffer.current.push(...r.samples);
      }
    });
    if (cur && prev && !loopShown && !isRescue && isMajorSettingsChange(prev, next)) {
      if (canShowRationale(cur.engine.simTimeSec, lastRationaleSimSec, lastAlarmDrivenRescueSimSec)) {
        setActiveRationale({
          changeSummary: typeChanged ? 'Device change' : 'Ventilator settings',
          targetAction: {
            kind: 'settings_change',
            detail: { before: prev, after: next },
          },
        });
      }
    }
  };

  // Auto-PEEP settling cue: when two consecutive expiratory-hold measurements differ by more than
  // 1 cmH2O, trapped gas is still moving; the learner should wait a few breaths before trusting the number.
  const [autoPeepCue, setAutoPeepCue] = useState(false);
  const lastAutoPeepRef = useRef<number | null>(null);
  const prevManoeuvreForPeepRef = useRef<NonNullable<RunState['lastManoeuvre']>['kind'] | null>(null);
  useEffect(() => {
    const mm = runRef.current?.lastManoeuvre ?? null;
    const kind = mm?.kind ?? null;
    const was = prevManoeuvreForPeepRef.current;
    prevManoeuvreForPeepRef.current = kind;
    if (kind === 'exp-hold' && was === null && mm?.valid) {
      const v = mm.autoPeepCmH2O;
      if (v !== undefined && Number.isFinite(v)) {
        const prev = lastAutoPeepRef.current;
        lastAutoPeepRef.current = v;
        setAutoPeepCue(prev !== null && Math.abs(v - prev) > 1);
      }
    }
  });

  // Stale-hold guard: when a valid manoeuvre result arrives, stamp it with the device settings JSON
  // and the PEEP in force at that moment, so the hold line can tell the learner to repeat the hold
  // once the device settings have changed.
  const holdCtxRef = useRef<{ mm: NonNullable<RunState['lastManoeuvre']>; settingsJson: string; peep: number | null } | null>(null);
  useEffect(() => {
    const cur = runRef.current;
    const mm = cur?.lastManoeuvre ?? null;
    const prev = holdCtxRef.current;
    if (cur && mm?.valid && (!prev || prev.mm !== mm)) {
      holdCtxRef.current = { mm, settingsJson: JSON.stringify(cur.engine.device), peep: cur.engine.monitored.peepSetCmH2O };
    }
  });

  // The queued label clears once the change has taken effect (the next completed breath) or the hold has returned its result.
  useEffect(() => {
    if (!queued) return;
    const cur = runRef.current;
    if (!cur) return;
    if (queued.kind === 'settings') {
      const lastBreathEnd = cur.engine.lastBreath?.endTimeSec ?? -1;
      if (lastBreathEnd !== queued.lastBreathEnd) setQueued(null);
    } else if (cur.lastManoeuvre) {
      setQueued(null);
    }
  });

  const isLookingAction = (o: OrderType): boolean => o === 'abg' || o === 'cxr' || o === 'examine';
  const needsConfirmOrder = (o: OrderType): boolean =>
    !isRescueOrder(o) && IRREVERSIBLE.includes(o) && scaffolds.requireIrreversibleConfirmation;

  const handleOrderRequest = (o: OrderType, detail?: Record<string, unknown>) => {
    const cur = runRef.current;
    const isRescue = isRescueOrder(o);
    const isDiagnostic = isLookingAction(o);
    if (committedAssessments !== null || isRescue || isDiagnostic || cur?.pendingPrediction) {
      if (needsConfirmOrder(o)) setConfirmOrder(o);
      else void executeOrder(o, detail);
      return;
    }
    setPendingTitration({ kind: 'order', order: o, detail });
    setIsCommitRevision(false);
    setShowCommitSheet(true);
  };

  const handleDeviceChangeRequest = (next: DeviceSettings, typeChanged: boolean) => {
    const cur = runRef.current;
    const isRescue = isRescueSettingsChange(next);
    if (committedAssessments !== null || isRescue || cur?.pendingPrediction) {
      executeDeviceChange(next, typeChanged);
      return;
    }
    setPendingTitration({ kind: 'settings', next, typeChanged });
    setIsCommitRevision(false);
    setShowCommitSheet(true);
  };

  const handleCommitAssessment = (assessments: string[], confidence: Confidence) => {
    setCommittedAssessments(assessments);
    setCommittedConfidence(confidence);
    setShowCommitSheet(false);

    const cur = runRef.current;
    if (cur) {
      const key = getAssessmentKey(caseFile.id);
      const isCorrect = key
        ? assessments.length > 0 && assessments.every(a => key.acceptedAssessments.includes(a))
        : false;
      const evidenceExtras = !isCommitRevision && caseFile.competencies[0] && key
        ? {
            competency: caseFile.competencies[0],
            evidenceType: 'interpretation' as const,
            correct: isCorrect,
            guidance: effectiveGuidance,
            hidden: false,
          }
        : {};
      void effectiveSink.record({
        v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION,
        id: newId(),
        wallTime: new Date().toISOString(),
        sessionId,
        runId: cur.runId,
        activity: 'case',
        activityId: caseFile.id,
        activityVersion: caseFile.version,
        simTimeSec: Math.round(cur.engine.simTimeSec),
        contextTags: caseFile.contextTags,
        type: 'assessment_commit',
        assessments,
        confidence,
        revised: isCommitRevision,
        ...evidenceExtras,
      });
    }

    if (pendingTitration) {
      const pt = pendingTitration;
      setPendingTitration(null);
      if (pt.kind === 'order') {
        if (needsConfirmOrder(pt.order)) setConfirmOrder(pt.order);
        else void executeOrder(pt.order, pt.detail);
      } else {
        executeDeviceChange(pt.next, pt.typeChanged);
      }
    }
  };

  const handleLoopSubmit = (a: SettingLoopAnswer) => {
    const cur = runRef.current;
    if (!cur || !loopPrompt) return;
    const { id, type, baseline, changeSimSec } = loopPrompt;
    setLoopPrompt(null);
    if (a.why) {
      void effectiveSink.record({
        v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION, id: newId(), wallTime: new Date().toISOString(), sessionId, runId: cur.runId,
        activity: "case", activityId: caseFile.id, activityVersion: caseFile.version, simTimeSec: Math.round(cur.engine.simTimeSec),
        contextTags: caseFile.contextTags, type: "rationale", targetAction: { kind: "settings_change", id, detail: { settingType: type, why: a.why } }, reasonId: "free_text",
      });
    }
    loopDue.current.push({
      id, type, baseline, expect: a.expect, changeSimSec,
      dueSimSec: a.reassess === "abg" ? null : cur.engine.simTimeSec + REASSESS_SEC[a.reassess],
    });
  };

  // When a reassess time arrives (or the next blood gas is back), compare predicted with actual engine readouts.
  useEffect(() => {
    const cur = runRef.current;
    if (!cur || loopDue.current.length === 0) return;
    const now = cur.engine.simTimeSec;
    const ready = loopDue.current.filter(d => loopReassessReady(d, cur.abgs, now));
    if (ready.length === 0) return;
    loopDue.current = loopDue.current.filter(d => !ready.includes(d));
    for (const d of ready) {
      if (loopScoringDecision(d, now, changeTimesRef.current) === 'not-scored') {
        setLoopResult({ type: d.type, rows: [], notScored: true });
        continue;
      }
      const rows = compareExpectations(d.expect, d.baseline, snapshotReadouts(cur.engine.monitored));
      const ok = fullyMatched(rows);
      fadeRef.current ??= loadFade();
      fadeRef.current = { ...fadeRef.current, [d.type]: afterOutcome(fadeRef.current[d.type], ok) };
      saveFade(fadeRef.current);
      setLoopResult({ type: d.type, rows });
      const competency = caseFile.competencies[0];
      if (competency) {
        void effectiveSink.record({
          v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION, id: newId(), wallTime: new Date().toISOString(), sessionId, runId: cur.runId,
          activity: "case", activityId: caseFile.id, activityVersion: caseFile.version, simTimeSec: Math.round(now), contextTags: caseFile.contextTags,
          type: "prediction", predictionId: `setting-change:${d.type}:${Math.round(now)}`,
          question: `Expected effect of a  change`,
          answer: d.expect, expected: Object.fromEntries(rows.map(r => [r.key, r.actual])),
          competency, evidenceType: "prediction", correct: ok, guidance: evidenceGuidance(cur, competency), hidden: false,
        });
      }
    }
  });

  const handleSelectRationaleReason = (reasonId: string) => {
    if (!activeRationale) return;
    const cur = runRef.current;
    if (cur) {
      void effectiveSink.record({
        v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION,
        id: newId(),
        wallTime: new Date().toISOString(),
        sessionId,
        runId: cur.runId,
        activity: 'case',
        activityId: caseFile.id,
        activityVersion: caseFile.version,
        simTimeSec: Math.round(cur.engine.simTimeSec),
        contextTags: caseFile.contextTags,
        type: 'rationale',
        targetAction: activeRationale.targetAction,
        reasonId,
      });
      setLastRationaleSimSec(cur.engine.simTimeSec);
    }
    setActiveRationale(null);
  };

  const handleTakeOver = () => {
    setShowHandoff(false);
    const cur = runRef.current;
    if (cur) {
      void effectiveSink.record({
        v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION,
        id: newId(),
        wallTime: new Date().toISOString(),
        sessionId,
        runId: cur.runId,
        activity: 'case',
        activityId: caseFile.id,
        activityVersion: caseFile.version,
        simTimeSec: Math.round(cur.engine.simTimeSec),
        contextTags: caseFile.contextTags,
        type: 'resource_opened',
        competency: caseFile.competencies[0],
        resource: `blind-handoff:${caseFile.id}`,
      });
    }
  };

  const [limits, setLimits] = useState<Limits>(defaultLimits);
  const [showLimits, setShowLimits] = useState(false);
  const [pane, setPane] = useState<SidePane>('story');
  const wide = useMediaQuery('(min-width: 1920px)');
  const [alarmState, setAlarmState] = useState<AlarmState>({ alarms: [] });
  const prevAlarmIdsRef = useRef<Set<string>>(new Set());

  const run = runRef.current;
  // The alarms shown last time. Feeding them back in is what lets an acknowledgement stick and lets a resolved
  // high-priority alarm stay listed until it is cleared. (Before, each evaluation started from an empty list, so
  // "Ack" had no effect.) Apnoea timing is deliberately left exactly as it was.
  const shownAlarmsRef = useRef<ActiveAlarm[]>([]);
  const alarms = useMemo(() => {
    if (!run) return [];
    const next = evaluateAlarms(
      run.engine.monitored,
      run.engine.lastBreath ?? null,
      run.engine.device,
      limits,
      { ...alarmState, alarms: shownAlarmsRef.current }
    );
    shownAlarmsRef.current = [...next];
    return next;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.engine.monitored, run?.engine.device, limits, alarmState]);

  useEffect(() => {
    if (!run) return;
    const currentActive = alarms.filter(a => a.conditionActive);
    for (const a of currentActive) {
      if (!prevAlarmIdsRef.current.has(a.id)) {
        prevAlarmIdsRef.current.add(a.id);
        void rt.sink.record({
          v: 1,
          id: `${Date.now()}-${Math.random()}`,
          wallTime: new Date().toISOString(),
          sessionId: run.sessionId,
          runId: run.runId,
          simTimeSec: Math.round(run.engine.simTimeSec),
          type: 'alarm',
          alarm: a.id,
          priority: a.priority,
          raisedAtSimSec: a.raisedAtSimSec,
        });
      }
    }
    for (const id of Array.from(prevAlarmIdsRef.current)) {
      if (!alarms.some(a => a.id === id)) {
        prevAlarmIdsRef.current.delete(id);
      }
    }
  }, [alarms, run, rt.sink]);

  const handleAcknowledge = (alarmId: string) => {
    if (!run) return;
    const simTime = Math.round(run.engine.simTimeSec);
    const existing = alarms.find(a => a.id === alarmId);
    if (existing) {
      const latency = simTime - existing.raisedAtSimSec;
      void rt.sink.record({
        v: 1,
        id: `${Date.now()}-${Math.random()}`,
        wallTime: new Date().toISOString(),
        sessionId: run.sessionId,
        runId: run.runId,
        simTimeSec: simTime,
        type: 'alarm',
        alarm: alarmId,
        priority: existing.priority,
        raisedAtSimSec: existing.raisedAtSimSec,
        acknowledgedAtSimSec: simTime,
        timeToAcknowledgeSec: latency,
      });
    }
    shownAlarmsRef.current = acknowledgeAlarm({ alarms: shownAlarmsRef.current }, alarmId, simTime).alarms;
    setAlarmState(prev => ({ ...prev })); // re-evaluate now, from the acknowledged list
  };

  const handleSilence = () => {
    if (!run) return;
    const now = Math.round(run.engine.simTimeSec);
    // Pressing again while silenced lets the tone sound again, as the audio-pause key does at the bedside.
    setAlarmState(prev => (isAlarmSilenced(prev, now) ? { ...prev, silencedUntilSimSec: undefined } : silenceAlarms(prev, now, 120)));
  };

  const bugCtx = useRef<() => unknown>(() => null);
  bugCtx.current = () => run ? {
    caseId: run.caseFile.id, runId: run.runId, simTimeSec: Math.round(run.engine.simTimeSec), playing, speed,
    ended: run.ended ?? null, device: run.engine.device, monitored: run.engine.monitored,
    alarms: alarms.map(a => ({ id: a.id, priority: a.priority, message: a.message, active: a.conditionActive, acknowledged: a.acknowledgedAtSimSec !== undefined })),
    alarmLimits: limits, sidePanel: pane, ordersPlaced: run.orders.map(o => o.order), bloodGasCount: run.abgs.length,
    lastManoeuvre: run.lastManoeuvre ?? null, error,
  } : { caseId: caseFile.id, state: 'starting', error };
  useEffect(() => registerBugContext('case', () => bugCtx.current()), []);

  if (error && !run) return <div className="p-6" style={{ color: 'var(--alarm-high)' }}>Could not start the case: {error}</div>;
  if (!run) return <div className="p-6" style={{ color: 'var(--text-2)' }}>Preparing patient…</div>;

  const m = run.engine.monitored;
  const dev = run.engine.device;
  const c = run.caseFile;
  const prediction = currentPrediction(run);
  const orders = c.availableOrders.filter(o => !ORDERS_HANDLED_ELSEWHERE.includes(o));
  const invasive = dev.device === 'invasive';
  const ventilatorMonitored = dev.device === 'invasive' || dev.device === 'niv';
  const pbw = pbwKg(run.engine.patient);
  // The case asks the learner to work out PBW (prediction p-pbw). Until that is answered, do not print PBW or mL/kg.
  const pbwHidden = c.predictionPoints.some(p => p.id === 'p-pbw') && !run.predictionResults.some(r => r.predictionId === 'p-pbw');
  const lastMsg = run.messages.length ? run.messages[run.messages.length - 1]! : null;
  const ordersPlaced = run.orders.filter(o => !ORDERS_HANDLED_ELSEWHERE.includes(o.order)).length;

  // Case panes. Under 1920 px they share one tabbed panel; from 1920 px they sit side by side in the left area.
  const examFindings = <>
    {run.findings.examine && <Finding label="Examination">{run.findings.examine}</Finding>}
    {run.findings.cxr && <Finding label="Chest X-ray">{run.findings.cxr}</Finding>}
  </>;
  const storyEl = <>
            {(wide || pane === 'story') && <CasePane wide={wide} title="Patient">
              <h2 className="text-base font-bold leading-snug mb-2">{c.title}</h2>
              <p>{c.patient.presentingStory}</p>
              <p className="mt-2" style={{ color: 'var(--text-2)' }}>{c.patient.history}</p>
              {!wide && examFindings}
            </CasePane>}

  </>;
  const examEl = wide && (run.findings.examine || run.findings.cxr) ? <CasePane wide={wide} title="Examination">{examFindings}</CasePane> : null;
  const ordersEl = <>
            {(wide || pane === 'orders') && (<CasePane wide={wide} title="Orders">
              <div className="flex flex-col">
                {orders.map(o => {
                  const n = run.orders.filter(x => x.order === o).length;
                  const showIrreversibleWarning = !isRescueOrder(o) && IRREVERSIBLE.includes(o);
                  return (
                    <button key={o} type="button" disabled={!!run.ended}
                      className="flex items-center justify-between text-left px-2 py-2 border-b hover:bg-[var(--surface-3)] disabled:opacity-50"
                      style={{ borderColor: 'var(--line)' }}
                      onClick={() => handleOrderRequest(o)}>
                      <span className="font-semibold">{ORDER_LABELS[o] ?? o}{showIrreversibleWarning && <span className="ml-2 text-[11px] font-semibold" style={{ color: 'var(--alarm-med)' }}>cannot be undone</span>}</span>
                      {n > 0 && <span className="vt-badge num">×{n}</span>}
                    </button>
                  );
                })}
              </div>
            </CasePane>)}

  </>;
  const gasesEl = <>
            {(wide || pane === 'gases') && (<CasePane wide={wide} title="Blood gases">{
              run.abgs.length === 0 && run.pendingAbgs.length === 0
                ? <p style={{ color: 'var(--text-2)' }}>No gases sent yet. Order an arterial blood gas from Orders; results take about 3 simulated minutes.</p>
                : <>
                  <table className="vt-table num">
                    <thead><tr><th>Time</th><th>FiO2</th><th>pH</th><th>PaCO2</th><th>PaO2</th><th>HCO3</th><th>BE</th><th>Lac</th></tr></thead>
                    <tbody>
                      {run.abgs.map((a, i) => (
                        <tr key={i} className="font-mono">
                          <td>{fmtTime(a.sampledAtSimSec)}</td><td>{f(a.fio2, 2)}</td><td>{f(a.ph, 2)}</td><td>{f(a.paco2MmHg)}</td><td>{f(a.pao2MmHg)}</td>
                          <td>{f(a.hco3MmolL)}</td><td>{f(a.baseExcessMmolL, 1)}</td><td>{f(a.lactateMmolL, 1)}</td>
                        </tr>
                      ))}
                      {run.pendingAbgs.map((d, i) => <tr key={`p${i}`}><td colSpan={8} style={{ color: 'var(--text-3)' }}>Result due at {fmtTime(d)}</td></tr>)}
                    </tbody>
                  </table>
                  {scaffolds.showPedagogicalNotes && (
                    <div className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>Gases in mmHg. SaO2 is listed in the debrief.</div>
                  )}
                </>
            }</CasePane>)}

  </>;
  const logEl = <>
            {(wide || pane === 'log') && (<CasePane wide={wide} title="Timeline">{
              (() => {
                // Settings/device orders describe what changed: describeSettingsChange lists only the fields
                // that differ from the settings in force before the order (the nearest earlier settings/device
                // order, else the case's starting device). A 'Set: ...' full list (no previous known) keeps
                // the short label so the long device/mode list never appears in the Timeline.
                let prevDev: DeviceSettings = caseFile.initialDevice as DeviceSettings;
                const settingsOrderTexts = run.orders.map(o => {
                  if (o.order !== 'change-settings' && o.order !== 'change-device') return ORDER_LABELS[o.order] ?? o.order;
                  const d = (o.detail ?? {}) as { settings?: unknown; device?: unknown };
                  const raw = (d.settings ?? (typeof d.device === 'string' ? { device: d.device } : d.device)) as Partial<DeviceSettings> | undefined;
                  const desc = describeSettingsChange(raw, prevDev);
                  if (raw && typeof raw === 'object') prevDev = { ...prevDev, ...raw } as DeviceSettings;
                  return desc.startsWith('Set:') ? (o.order === 'change-device' ? 'Changed device' : 'Changed settings') : desc;
                });
                // Everything that has happened, newest first, then what is still to come back.
                const rows: { t: number; who: string; text: string }[] = [
                  ...run.messages.map(m => ({ t: m.simTimeSec, who: m.from, text: m.text })),
                  ...run.orders.map((o, i) => ({ t: o.simTimeSec, who: 'you', text: settingsOrderTexts[i] })),
                  ...run.abgs.map(a => ({ t: a.sampledAtSimSec + ABG_DELAY_SIM_SEC, who: 'lab', text: `Blood gas result back (sample taken at ${fmtTime(a.sampledAtSimSec)})` })),
                  ...(run.observations ?? []).map(o => ({ t: o.toSec, who: 'you', text: `Observed from ${fmtTime(o.fromSec)} without changes; stopped because ${OBSERVE_STOP_TEXT[o.stoppedBy]}${o.changed ? ` (${o.changed})` : ''}` })),
                  ...(run.ended ? [{ t: run.ended.simTimeSec, who: 'case', text: `Case finished: ${run.ended.outcome}. ${run.ended.reason}` }] : []),
                ].sort((a, b) => b.t - a.t);
                return <>
                  {run.pendingAbgs.length > 0 && <p className="mb-2 text-xs" style={{ color: 'var(--text-2)' }}>Still to come: {run.pendingAbgs.map(d => `blood gas result at ${fmtTime(d)}`).join(', ')}</p>}
                  <p className="mb-1 text-xs" style={{ color: 'var(--text-3)' }}>Case started 0:00:00. Now {fmtTime(run.engine.simTimeSec)}.</p>
                  {rows.length === 0 ? <p style={{ color: 'var(--text-2)' }}>Nothing has happened yet.</p> : (
                    <ul className="flex flex-col" data-testid="timeline">
                      {rows.map((r, i) => (
                        <li key={i} className="py-1.5 border-b" style={{ borderColor: 'var(--line)' }}>
                          <span className="num mr-2" style={{ color: 'var(--text-3)' }}>{fmtTime(r.t)}</span>
                          <span className="capitalize font-semibold">{r.who}</span>
                          <div>{r.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>;
              })()
            }</CasePane>)}

  </>;
  const consultantEl = (
    <>
          {(() => {
          const adapter = createCaseTutorAdapter(run, caseFile);
          const maneuvers: ManeuverType[] = [];
          if (run.lastManoeuvre?.kind === 'insp-hold') maneuvers.push('inspiratory_hold');
          if (run.lastManoeuvre?.kind === 'exp-hold') maneuvers.push('expiratory_hold');
          if (run.abgs.length > 0 || run.orders.some(o => o.order === 'abg')) maneuvers.push('abg_ordered');
          if (run.findings.cxr || run.orders.some(o => o.order === 'cxr')) maneuvers.push('cxr_viewed');
          const focusVars = [
            {
              label: m.ppeakCmH2O !== null ? 'Ppeak' : 'RR',
              value: m.ppeakCmH2O !== null ? `${m.ppeakCmH2O} cmH2O` : `${m.rrTotalBpm} bpm`,
            },
            {
              label: 'SpO2',
              value: `${m.spo2Pct}%`,
            },
          ];
          const guidances = Object.values(run.guidance || {});
          const primaryGuidance = guidances.includes('guided')
            ? 'guided'
            : guidances.includes('prompted')
            ? 'prompted'
            : guidances.includes('independent')
            ? 'independent'
            : 'prompted';
          return (
            <TutorPanel
              embedded
              getContext={(attempt) => buildActiveCaseContext(run, attempt, { hidePbw: pbwHidden }).contextText}
              contextKind="active_case"
              getCap={adapter.getCap}
              forbiddenPhrases={adapter.forbiddenPhrases}
              getForbiddenPhrases={adapter.getForbiddenPhrases}
              getVerifiedEngineNumbers={() => buildActiveCaseContext(run, undefined, { hidePbw: pbwHidden }).verifiedEngineNumbers ?? {}}
              getActiveAbnormalities={adapter.getActiveAbnormalities}
              competencyIds={adapter.competencyIds}
              caseId={c.id}
              guidanceLevel={primaryGuidance}
              engineCommitSignal={run.orders.length + (run.predictionResults?.length ?? 0)}
              onEnabledChange={setAiTutorEnabled}
              onEpisodeStateChange={st => {
                if (runRef.current && st.turnCount > tutorTurnsCountedRef.current) {
                  tutorTurnsCountedRef.current = st.turnCount;
                  noteAssistance(runRef.current, 'tutor');
                }
                setTutorCompletionBlocked(st.caseCompletionBlocked);
              }}
              runId={run.runId}
              simTimeSec={run.engine.monitored.simTimeSec}
              isProbeActive={(c.hiddenCompetencies || []).length > 0}
              isTransferProbe={c.id.includes('--')}
              predictionPending={Boolean(prediction)}
              hasActiveAlarmOrWaveform={alarms.some(a => a.conditionActive)}
              hasAbg={run.abgs.length > 0}
              maneuversPerformed={maneuvers}
              lowBandwidthFocusVars={focusVars}
            />
          );
        })()}

    </>
  );

  const stages = caseStages(run.orders, !showHandoff);
  const progressEl = (
    <CaseProgress simTimeSec={run.engine.simTimeSec} maxSimMin={c.maxSimMin} studyTime={fmtTime((Date.now() - studyStart) / 1000)} stages={stages} fmt={fmtTime}>
      {!run.ended && (
        <div className="mt-2 text-xs flex flex-col gap-0.5" style={{ color: 'var(--text-2)' }} data-testid="progress-strip">
          <span>
            <span className="font-semibold">Waiting for: </span>
            {run.pendingAbgs.length > 0
              ? run.pendingAbgs.map(d => `blood gas result at ${fmtTime(d)}`).join(', ')
              : 'no results pending'}
          </span>
          {lastObs && (
            <span data-testid="observe-outcome">
              <span className="font-semibold">Last observation: </span>
              {fmtTime(lastObs.fromSec)} to {fmtTime(lastObs.toSec)}, stopped because {OBSERVE_STOP_TEXT[lastObs.stoppedBy]}{lastObs.changed ? ` (${lastObs.changed})` : ''}.
            </span>
          )}
        </div>
      )}
      <div className="mt-1.5 text-xs" style={{ color: 'var(--text-2)' }} data-testid="prompt-field">
        {run.reconnect ? <span style={{ color: 'var(--alarm-med)' }}>Disconnected from the ventilator. Reconnects at {fmtTime(run.reconnect.dueSec)}.</span>
          : lastMsg ? <><span className="num mr-1.5" style={{ color: 'var(--text-3)' }}>{fmtTime(lastMsg.simTimeSec)}</span><span className="capitalize font-semibold">{lastMsg.from}:</span> {lastMsg.text}</>
            : null}
      </div>
    </CaseProgress>
  );

  const limitsEl = showLimits
    ? <LimitsEditor limits={limits} onChange={setLimits} onClose={() => setShowLimits(false)} />
    : null;

  return (
    <div className="vt-case-root" data-testid="case-runner">
      {/* Top bar: device and mode, patient, handoff, and the bedside clock controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-b" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="flex flex-col justify-center pr-4 border-r min-w-[7.5rem]" style={{ borderColor: 'var(--line)' }} title={MODE_LONG[modeKey(dev)] ?? DEVICE_LONG[dev.device]}>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>{DEVICE_LONG[dev.device]}</span>
          <span className="text-xl font-bold leading-tight num" data-testid="active-mode">{modeTitle(dev, skin)}</span>
        </div>
        <div className="flex flex-col justify-center min-w-0 max-w-[26rem]">
          <span className="text-sm font-semibold truncate">{c.patient.displayName}</span>
          <span className="text-xs num" style={{ color: 'var(--text-2)' }}>
            {run.engine.patient.sex === 'M' ? 'Male' : 'Female'} · {run.engine.patient.ageYears} y · {run.engine.patient.heightCm} cm · {run.engine.patient.actualWeightKg} kg{pbwHidden ? '' : ` · PBW ${pbw.toFixed(0)} kg`}
          </span>
        </div>
        {(handoffData || committedAssessments) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {handoffData && (
              <button type="button" className="vt-btn !min-h-[28px] !px-2.5 !text-xs" onClick={() => setShowHandoffReview(true)}>Handoff sign-out</button>
            )}
            {committedAssessments && (
              <button
                type="button"
                className="vt-btn !min-h-[28px] !px-2.5 !text-xs"
                style={{ borderColor: 'var(--act)', color: 'var(--act)' }}
                onClick={() => { setIsCommitRevision(true); setShowCommitSheet(true); }}
              >
                Working assessment: {committedAssessments.length} chosen (Revise)
              </button>
            )}
          </div>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" className="vt-btn min-w-[4.25rem]" onClick={() => setPlaying(p => !p)} disabled={!!run.ended || showHandoff}>{playing ? 'Pause' : 'Play'}</button>
          <select aria-label="Speed" className="vt-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            <option value={1}>1×</option><option value={4}>4×</option><option value={10}>10×</option>
          </select>
          <button type="button" className="vt-btn" data-testid="observe-btn" disabled={!!run.ended || !!prediction || showHandoff}
            title="Change nothing and watch. Patient time moves on until a result comes back, the bedside calls you, the vital signs clearly worsen, or 30 minutes pass."
            onClick={() => void doObserve()}>Observe and reassess</button>
          {[5, 15, 30].map(n => (
            <button key={n} type="button" className="vt-btn" disabled={!!run.ended || !!prediction || showHandoff} onClick={() => void skip(n)}>+{n} min</button>
          ))}
          {!(run.ended && !endSeen) && <button type="button" className="vt-btn vt-btn--danger ml-1"
            onClick={goDebrief}>
            {run.ended ? 'Go to debrief' : 'Stop case'}
          </button>}
        </div>
      </div>

      {error && <div className="px-3 py-1.5 text-sm font-semibold" style={{ background: 'var(--alarm-high)', color: 'var(--alarm-high-ink)' }} role="alert">{error}</div>}
      {run.ended && (
        <div className="px-3 py-1.5 text-sm" style={{ background: 'var(--surface-3)' }} role="status">
          <span className="font-bold">Case finished: {run.ended.outcome}.</span> {run.ended.reason} Press “Go to debrief” to review.
        </div>
      )}
      {run.ended && !endSeen && (
        <Modal label="Case finished">
          <h2 className="text-lg font-bold mb-1" data-testid="case-end-title">Case finished: {run.ended.outcome}</h2>
          <p className="mb-3">{run.ended.reason}</p>
          <p className="mb-4 text-sm num" style={{ color: 'var(--text-2)' }}>Patient time {fmtTime(run.ended.simTimeSec)} · Study time {fmtTime((Date.now() - studyStart) / 1000)}</p>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-2)' }}>Nothing more can be changed in this case. The debrief goes through your decisions in order.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="vt-btn" onClick={() => setEndSeen(true)}>Look at the final state first</button>
            <button type="button" className="vt-btn" style={{ borderColor: 'var(--act)', color: 'var(--act)' }} autoFocus onClick={goDebrief}>Go to debrief</button>
          </div>
        </Modal>
      )}

      {/* Case grid: one column, then ventilator + side panel, then patient | ventilator | progress (vent.css) */}
      <div className="vt-case">
        {wide && (
          <section className="vt-case__left" aria-label="Patient">
            <div className="vt-case__leftcol text-base leading-relaxed">{storyEl}{examEl}</div>
          </section>
        )}

        <section className="vt-case__centre" aria-label="Ventilator">
          <div className="px-3 pt-2 pb-1 shrink-0">
            <AlarmBanner
              alarmState={{ ...alarmState, alarms }}
              simTimeSec={run.engine.simTimeSec}
              onSilence={handleSilence}
              onAcknowledge={handleAcknowledge}
              audible={playing && !run.ended && !prediction && !showHandoff}
              testIds={{ banner: 'alarm-field', message: 'alarm-message', silence: 'alarm-silence-btn', ack: 'alarm-ack-btn' }}
            />
          </div>
          {ventilatorMonitored ? (
            <div className="vt-scope">
              <div className="vt-scope__wave" style={{ background: 'var(--wave-bg)' }}>
                <div className="vt-scope__canvas"><div className="absolute inset-0"><SweepWaveforms samples={buffer.current} speed={speed} playing={playing && !showHandoff} height="100%" ghost={ghost} /></div></div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-t text-sm min-h-[42px] shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
                {invasive ? <>
                  <button type="button" className="vt-btn" disabled={!playing || showHandoff}
                    onClick={() => { try { startHold(rt, run, 'insp-hold'); rerender(); setQueued({ kind: 'hold', sinceSimSec: run.engine.simTimeSec, lastBreathEnd: run.engine.lastBreath?.endTimeSec ?? -1 }); } catch (e) { setError(String(e)); } }}>Inspiratory hold</button>
                  <button type="button" className="vt-btn" disabled={!playing || showHandoff}
                    onClick={() => { try { startHold(rt, run, 'exp-hold'); rerender(); setQueued({ kind: 'hold', sinceSimSec: run.engine.simTimeSec, lastBreathEnd: run.engine.lastBreath?.endTimeSec ?? -1 }); } catch (e) { setError(String(e)); } }}>Expiratory hold</button>
                  <span className="num" data-testid="hold-result">
                    {(() => {
                      const ctx = holdCtxRef.current;
                      const fresh = ctx !== null && ctx.mm === run.lastManoeuvre;
                      const peep = fresh ? ctx.peep : m.peepSetCmH2O;
                      const stale = fresh && ctx.settingsJson !== JSON.stringify(dev);
                      return <>
                        {run.lastManoeuvre && (run.lastManoeuvre.valid
                          ? stale
                            ? <span style={{ color: 'var(--text-3)' }}>Last hold was before your settings change. Repeat the hold.</span>
                            : run.lastManoeuvre.kind === 'insp-hold'
                              ? formatInspHold(run.lastManoeuvre.pplatCmH2O, peep)
                              : formatExpHold(run.lastManoeuvre.totalPeepCmH2O, run.lastManoeuvre.autoPeepCmH2O)
                          : <span style={{ color: 'var(--alarm-med)' }}>Hold not valid: patient effort during the hold.</span>)}
                        {!playing && <span style={{ color: 'var(--text-3)' }}> Holds run in real time; press Play.</span>}
                        {autoPeepCue && <span data-testid="autopeep-cue" className="ml-2" style={{ color: 'var(--warn-ink)' }}>Auto-PEEP still changing, wait a few breaths</span>}
                      </>;
                    })()}
                  </span>
                </> : <span style={{ color: 'var(--text-3)' }}>{ventilatorMonitored ? 'Holds need invasive ventilation.' : 'Patient monitor and blood gases keep updating.'}</span>}
                </div>
              </div>
              <div className="vt-scope__nums" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
                <span className="vt-section-title">{ventilatorMonitored ? 'Ventilator' : 'Respiratory'}</span>
                <button type="button" className="vt-btn vt-btn--quiet !min-h-[26px] !px-2 !text-xs" aria-expanded={showLimits} onClick={() => setShowLimits(s => !s)}>Alarm limits</button>
              </div>
              {showLimits
                ? <LimitsEditor limits={limits} onChange={setLimits} onClose={() => setShowLimits(false)} />
                : <>
                  <VentNumerics m={m} device={dev} alarms={alarms} limits={limits} lastManoeuvre={run.lastManoeuvre} />
                  <div className="px-2 pt-2 pb-1 vt-section-title border-t" style={{ borderColor: 'var(--line-strong)' }}>Patient monitor</div>
                  <MonitorStrip m={m} alarms={alarms} limits={limits} />
                </>}
              </div>
            </div>
          ) : (
            <OpenCircuitPanel device={dev} m={m} history={vitalsHistory.current}>
              {limitsEl}
            </OpenCircuitPanel>
          )}

          {/* Settings */}
          <div className={`px-3 pt-2 pb-3 space-y-2 shrink-0 border-t ${ventilatorMonitored ? '' : 'order-first'}`} style={{ borderColor: 'var(--line)', background: 'var(--surface)' }} data-testid="device-controls">
            {loopPrompt && <SettingLoopPanel key={loopPrompt.id} settingType={loopPrompt.type} onSubmit={handleLoopSubmit} onDismiss={() => setLoopPrompt(null)} />}
            {loopResult && !loopPrompt && <SettingLoopResult settingType={loopResult.type} rows={loopResult.rows} notScored={loopResult.notScored} onClose={() => setLoopResult(null)} />}
            {activeRationale && (
              <RationaleChip
                changeSummary={activeRationale.changeSummary}
                onSelectReason={handleSelectRationaleReason}
                onDismiss={() => setActiveRationale(null)}
              />
            )}
            <VentControls active={dev} pbwKg={pbwHidden ? undefined : pbw} disabled={!!run.ended} skin={skin}
              canChangeDevice={c.availableOrders.includes('change-device')}
              canChangeSettings={c.availableOrders.includes('change-settings')}
              allowInvasiveSwitch={dev.device === 'invasive'}
              onApply={handleDeviceChangeRequest} />
            {queued && (
              <div className="text-xs font-semibold" style={{ color: 'var(--act)' }} data-testid="queued-label" role="status">
                {queued.kind === 'settings' ? 'Queued for next breath' : 'Hold queued'}
              </div>
            )}
          </div>
        </section>

        <aside className="vt-case__right" aria-label="Case">
          {progressEl}
          {!wide && (
            <div className="vt-tabs px-2 flex-wrap shrink-0" role="tablist">
              {([['story', 'Patient'], ['orders', 'Orders'], ['gases', 'Blood gases'], ['log', 'Timeline'], ['tutor', 'Consultant']] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" className="vt-tab whitespace-nowrap" aria-selected={pane === k} onClick={() => setPane(k)}>
                  {l}
                  {k === 'gases' && (run.abgs.length + run.pendingAbgs.length) > 0 && <span className="vt-badge ml-1.5 num">{run.abgs.length}{run.pendingAbgs.length ? '+' : ''}</span>}
                  {k === 'log' && run.messages.length > 0 && <span className="vt-badge ml-1.5 num">{run.messages.length}</span>}
                  {k === 'tutor' && aiTutorEnabled && <span className="vt-badge ml-1.5" title="The AI consultant is on">on</span>}
                  {k === 'orders' && ordersPlaced > 0 && <span className="vt-badge ml-1.5 num">{ordersPlaced}</span>}
                </button>
              ))}
            </div>
          )}
          {wide && (
            <div className="px-3 pt-3 text-sm leading-relaxed border-b" style={{ borderColor: 'var(--line)' }}>
              {gasesEl}
              <div className="max-h-[30vh] overflow-auto">{logEl}</div>
              {ordersEl}
            </div>
          )}
          {/* The AI consultant stays mounted while other tabs show, so a conversation is never lost. */}
          <div className={wide ? 'p-2 min-w-0' : pane === 'tutor' ? 'p-2' : 'hidden'} data-testid="consultant-pane">
            {wide && <h3 className="vt-section-title mb-1.5 px-1">Consultant</h3>}
            {consultantEl}
          </div>
          {!wide && (
            <div className={pane === 'tutor' ? 'hidden' : 'p-3 text-sm leading-relaxed'}>
              {pane === 'story' && storyEl}
              {pane === 'orders' && ordersEl}
              {pane === 'gases' && gasesEl}
              {pane === 'log' && logEl}
            </div>
          )}
        </aside>
      </div>

      {confirmOrder && (
        <Modal label={ORDER_LABELS[confirmOrder] ?? confirmOrder}>
          <p className="mb-4"><b>{ORDER_LABELS[confirmOrder]}</b> cannot be undone in this case. Go ahead?</p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="vt-btn" onClick={() => setConfirmOrder(null)}>Cancel</button>
            <button type="button" className="vt-btn vt-btn--confirm" onClick={() => { const o = confirmOrder; setConfirmOrder(null); void executeOrder(o); }}>Confirm</button>
          </div>
        </Modal>
      )}

      {/* A question waits until the handoff card is dismissed, so the two never open together. */}
      {prediction && !showHandoff && !showHandoffReview && (
        <PredictionModal key={prediction.id} prediction={prediction}
          onSubmit={(answer, confidence) => void guarded(async r => {
            const fb = await answerPrediction(rt, r, answer, confidence);
            setFeedback({ question: prediction.question, fb });
          })} />
      )}

      {feedback && !prediction && !showHandoff && (
        <Modal label="Prediction result">
          <div className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>{feedback.question}</div>
          {feedback.fb.status === 'awaiting-physiology'
            ? <p>Answer saved. The patient's physiology will mark it: at your next blood gas, or after an hour of simulated time. You will see the result in the debrief.</p>
            : <>
              <p className="font-bold" style={{ color: feedback.fb.correct ? 'var(--ok)' : 'var(--act)' }}>{feedback.fb.correct ? 'Correct.' : 'Not quite.'}</p>
              {!feedback.fb.correct && <p className="text-sm mt-1">Expected: {String(typeof feedback.fb.expected === 'object' ? JSON.stringify(feedback.fb.expected) : feedback.fb.expected)}</p>}
              {(scaffolds.showImmediatePredictionExplanations || (effectiveGuidance === 'prompted' && !feedback.fb.correct)) && (
                <p className="text-sm mt-2" style={{ color: 'var(--text-2)' }}>{feedback.fb.explanation}</p>
              )}
            </>}
          <div className="flex justify-end mt-4"><button type="button" className="vt-btn vt-btn--primary" onClick={() => setFeedback(null)}>Continue</button></div>
        </Modal>
      )}

      {showHandoff && handoffData && (
        <HandoffCard
          handoff={handoffData}
          patientNameFallback={c.patient.displayName}
          mode="initial"
          onTakeOver={handleTakeOver}
        />
      )}

      {showHandoffReview && handoffData && (
        <HandoffCard
          handoff={handoffData}
          patientNameFallback={c.patient.displayName}
          mode="review"
          onTakeOver={() => setShowHandoffReview(false)}
          onClose={() => setShowHandoffReview(false)}
        />
      )}

      {showCommitSheet && (
        <CommitSheet
          pendingActionDescription={
            pendingTitration?.kind === 'order'
              ? ORDER_LABELS[pendingTitration.order] ?? pendingTitration.order
              : pendingTitration?.kind === 'settings'
              ? (pendingTitration.typeChanged ? 'Switch device' : 'Ventilator settings')
              : undefined
          }
          isRevision={isCommitRevision}
          initialAssessments={committedAssessments ?? []}
          initialConfidence={isCommitRevision ? (committedConfidence ?? undefined) : undefined}
          onCommit={handleCommitAssessment}
          onCancel={() => {
            setShowCommitSheet(false);
            setPendingTitration(null);
          }}
        />
      )}

    </div>
  );
};

const AlarmMark: React.FC<{ priority: 'high' | 'med' | 'low' }> = ({ priority }) => (
  <span className="num font-bold tracking-tight" aria-label={priority === 'high' ? 'High priority' : 'Medium priority'}>{priority === 'high' ? '!!!' : '!!'}</span>
);

/** True while the window matches the query. Used to show all case panels side by side on very wide screens. */
function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

const CasePane: React.FC<{ wide: boolean; title: string; children: React.ReactNode }> = ({ wide, title, children }) => (
  wide
    ? <section className="mb-5" aria-label={title}><h3 className="vt-section-title mb-1.5">{title}</h3>{children}</section>
    : <>{children}</>
);

const Finding: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
    <div className="vt-label mb-0.5">{label}</div>
    <p>{children}</p>
  </div>
);

const LimitsEditor: React.FC<{ limits: Limits; onChange: (l: Limits) => void; onClose: () => void }> = ({ limits, onChange, onClose }) => {
  const step = (id: keyof Limits, side: 'low' | 'high', dir: 1 | -1) => {
    const def = LIMIT_DEFS.find(d => d.id === id)!;
    const cur = limits[id][side];
    if (cur === null) return;
    const v = Math.min(def.max, Math.max(def.min, Number((cur + dir * def.step).toFixed(2))));
    const other = limits[id][side === 'low' ? 'high' : 'low'];
    if (other !== null && (side === 'low' ? v >= other : v <= other)) return;
    onChange({ ...limits, [id]: { ...limits[id], [side]: v } });
  };
  return (
    <div className="px-2 pb-2" data-testid="limits-editor">
      <table className="vt-table num">
        <thead><tr><th>Alarm</th><th>Low</th><th>High</th></tr></thead>
        <tbody>
          {LIMIT_DEFS.map(def => (
            <tr key={def.id}>
              <td className="!text-left"><span className="font-semibold">{def.name}</span> <span style={{ color: 'var(--text-3)' }}>{def.unit}</span></td>
              {(['low', 'high'] as const).map(side => (
                <td key={side}>
                  {limits[def.id][side] === null ? <span style={{ color: 'var(--text-3)' }}>off</span> : (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" className="vt-btn !min-h-[24px] !px-1.5" aria-label={`Lower ${def.name} ${side} limit`} onClick={() => step(def.id, side, -1)}>−</button>
                      <span className="w-9 text-center">{limits[def.id][side]}</span>
                      <button type="button" className="vt-btn !min-h-[24px] !px-1.5" aria-label={`Raise ${def.name} ${side} limit`} onClick={() => step(def.id, side, 1)}>+</button>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between items-center mt-2">
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Limit changes apply at once.</span>
        <button type="button" className="vt-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
};

const Modal: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
  <div className="vt-dialog-backdrop" role="dialog" aria-modal="true" aria-label={label}>
    <div className="vt-dialog p-5">{children}</div>
  </div>
);

type PredictionPoint = NonNullable<ReturnType<typeof currentPrediction>>;

const PredictionModal: React.FC<{ prediction: PredictionPoint; onSubmit: (answer: string | number | Record<string, Direction>, confidence: Confidence) => void }> = ({ prediction: p, onSubmit }) => {
  const [dirs, setDirs] = useState<Record<string, Direction>>({});
  const [choice, setChoice] = useState<string | null>(null);
  const [num, setNum] = useState('');
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const vars = p.variables ?? [];
  const answered = p.format === 'direction' ? vars.every(v => dirs[v]) : p.format === 'choice' ? choice !== null : num.trim() !== '' && Number.isFinite(Number(num));
  return (
    <Modal label="Prediction">
      <div className="vt-label mb-1" style={{ color: 'var(--sel)' }}>Predict before you see</div>
      <p className="mb-4 leading-relaxed">{p.question}</p>
      {p.format === 'direction' && vars.map(v => (
        <div key={v} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: 'var(--line)' }}>
          <span className="font-semibold">{METRIC_LABELS[v] ?? v}</span>
          <span className="flex gap-1">
            {(['up', 'same', 'down'] as const).map(d => (
              <button key={d} type="button" aria-pressed={dirs[v] === d} className="vt-btn !min-h-[28px]"
                onClick={() => setDirs(x => ({ ...x, [v]: d }))}>{d === 'same' ? 'no change' : d}</button>
            ))}
          </span>
        </div>
      ))}
      {p.format === 'choice' && (p.options ?? []).map(o => (
        <label key={o} className="flex items-center gap-2 py-1.5">
          <input type="radio" name="pred-choice" checked={choice === o} onChange={() => setChoice(o)} />{o}
        </label>
      ))}
      {p.format === 'numeric' && (
        <label className="flex items-center gap-2">
          <input aria-label="Your answer" className="vt-select w-28 num !text-base" value={num} onChange={e => setNum(e.target.value)} />{p.unit}
        </label>
      )}
      <div className="mt-4 vt-label">How sure are you?</div>
      <div className="flex gap-1 mt-1">
        {([['guess', 'Guess'], ['fairly_sure', 'Fairly sure'], ['certain', 'Certain']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={confidence === k} className="vt-btn" onClick={() => setConfidence(k)}>{l}</button>
        ))}
      </div>
      <div className="flex justify-end mt-5">
        <button type="button" disabled={!answered || !confidence} className="vt-btn vt-btn--primary"
          onClick={() => onSubmit(p.format === 'direction' ? dirs : p.format === 'choice' ? choice! : Number(num), confidence!)}>Commit answer</button>
      </div>
    </Modal>
  );
};
