import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { GuidanceLevel } from '../shared/events';
import type { CardState } from '../practice/types';
import {
  countWords,
  detectGateBypassInput,
  MIN_MECHANISM_WORDS,
  MIN_OBSERVATION_WORDS,
  validateStructuredAttempt,
  type AbgCommitInterpretation,
  type FreeDiscussionMode,
  type HelpLevel,
  type LearnerRequestKind,
  type ManeuverType,
  type StructuredLearnerAttempt,
  type TutorConfidence,
  type TutorContextKind,
  type TutorMode,
  type TutorResponse,
  type TutorTurnSummary,
} from './types';
import { sendTutorRequest, fetchTutorStatus, type ProviderStatusInfo } from './client';
import { formatRagPearls, retrieveLocalTeachingPearls } from './localRag';
import { ContractModal } from './ContractModal';
import { getContractAccepted, setContractAccepted } from './store';
import {
  canRequestSocraticTurn,
  createTutorStateMachineState,
  MAX_SOCRATIC_TURNS,
  scheduleTutorDelayedRetest,
  transitionTutorEpisode,
  type TutorStateMachineState,
} from './stateMachine';

export const CONTRACT_BADGE_TEXT =
  'Consultant Mode: Hypothesis & prediction required before guidance. Unaided performance defines mastery.';

export const CONTRACT_BYPASS_RESTATEMENT =
  'On this unit, the attending does not hand over ventilator settings before hearing the resident\'s physiological assessment. If workload or post-call fatigue is high, switch to Low-Bandwidth Mode to isolate one waveform variable at a time—or state a brief 1-line hypothesis on what is driving the peak pressure so the mechanism can be tested.';

export interface TutorPanelProps {
  /** Fills its container as a normal panel (for example a tab) with no collapse arrow, instead of the narrow side strip. */
  embedded?: boolean;
  contextText?: string;
  getContext?: (attempt?: StructuredLearnerAttempt) => string;
  contextKind: TutorContextKind;
  helpLevelCap?: HelpLevel;
  getCap?: (
    requestKind?: LearnerRequestKind,
    learnerText?: string,
    attempt?: StructuredLearnerAttempt,
    tutorMode?: TutorMode
  ) => HelpLevel;
  forbiddenPhrases?: string[];
  getForbiddenPhrases?: (attempt?: StructuredLearnerAttempt) => string[];
  withheldDiagnosis?: string;
  onTutorAssistedAction?: (levelUsed: HelpLevel) => void;
  runId?: string;
  simTimeSec?: number;
  className?: string;
  defaultOpen?: boolean;
  isProbeActive?: boolean;
  isTransferProbe?: boolean;
  requiresPrediction?: boolean;
  predictionPending?: boolean;
  hasActiveAlarmOrWaveform?: boolean;
  hasAbg?: boolean;
  maneuversPerformed?: ManeuverType[];
  lowBandwidthFocusVars?: Array<{ label: string; value: string }>;
  verifiedEngineNumbers?: Record<string, number>;
  getVerifiedEngineNumbers?: () => Record<string, number>;
  activeAbnormalities?: string[];
  getActiveAbnormalities?: () => string[];
  competencyIds?: string[];
  caseId?: string;
  guidanceLevel?: GuidanceLevel;
  engineCommitSignal?: number;
  debriefSelfCritiquePending?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onModeChange?: (mode: TutorMode) => void;
  onEpisodeStateChange?: (state: TutorStateMachineState) => void;
  onDelayedRetestScheduled?: (info: {
    dueAt: number;
    retestIds: string[];
    cardStates: Record<string, CardState>;
  }) => void;
}

interface ChatMessage {
  id: string;
  sender: 'learner' | 'tutor';
  text: string;
  question?: string | null;
  claims?: TutorResponse['claims'];
  reasoningGrade?: TutorResponse['reasoning_grade'];
  helpLevelUsed?: HelpLevel;
  provider?: string;
  timestamp: string;
}

const STORAGE_KEY = 'ovs_tutor_enabled';

export const TutorPanel: React.FC<TutorPanelProps> = ({
  contextText,
  getContext,
  contextKind,
  helpLevelCap,
  getCap,
  forbiddenPhrases = [],
  getForbiddenPhrases,
  withheldDiagnosis,
  onTutorAssistedAction,
  runId,
  simTimeSec,
  className = '',
  defaultOpen = false,
  embedded = false,
  isProbeActive = false,
  isTransferProbe = false,
  requiresPrediction = false,
  predictionPending = false,
  hasActiveAlarmOrWaveform = false,
  hasAbg = false,
  maneuversPerformed = [],
  lowBandwidthFocusVars,
  verifiedEngineNumbers,
  getVerifiedEngineNumbers,
  competencyIds = [],
  caseId,
  guidanceLevel = 'prompted',
  engineCommitSignal,
  activeAbnormalities,
  getActiveAbnormalities,
  debriefSelfCritiquePending = false,
  onEnabledChange,
  onModeChange,
  onEpisodeStateChange,
  onDelayedRetestScheduled,
}) => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (defaultOpen) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [isOpenState, setIsOpen] = useState<boolean>(defaultOpen);
  const isOpen = embedded || isOpenState;
  const [showContractModal, setShowContractModal] = useState<boolean>(false);
  const [contractAcceptedState, setContractAcceptedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ovs_tutor_contract_accepted') === 'true';
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [tutorMode, setTutorMode] = useState<TutorMode>(
    isProbeActive || isTransferProbe ? 'exam_silent' : 'coaching'
  );
  const [freeDiscussionMode, setFreeDiscussionMode] = useState<FreeDiscussionMode>('stress_test');

  // Structured Learner Attempt Gate fields
  const [observation, setObservation] = useState<string>('');
  const [mechanismHypothesis, setMechanismHypothesis] = useState<string>('');
  const [predictedConsequence, setPredictedConsequence] = useState<string>('');
  const [confidence, setConfidence] = useState<TutorConfidence | null>(null);
  const [turnHistory, setTurnHistory] = useState<TutorTurnSummary[]>([]);
  const [gateOpenedAtMs, setGateOpenedAtMs] = useState<number>(() => Date.now());
  const [episodeState, setEpisodeState] = useState<TutorStateMachineState>(() =>
    createTutorStateMachineState({
      runId,
      problemId: caseId ?? contextKind,
      guidanceLevel,
      competencyIds,
    })
  );
  const [reconstructInput, setReconstructInput] = useState<string>('');
  const prevEngineCommitRef = useRef<number | undefined>(engineCommitSignal);

  // Surface (c): ABG Commit Strip
  const [abgPrimary, setAbgPrimary] = useState<string>('');
  const [abgComp, setAbgComp] = useState<string>('');
  const [abgOxy, setAbgOxy] = useState<string>('');
  const [abgAg, setAbgAg] = useState<string>('');
  const [abgCommitted, setAbgCommitted] = useState<boolean>(false);

  // Exception C: pure simulator UI help
  const [showUiHelp, setShowUiHelp] = useState<boolean>(false);
  const [uiHelpText, setUiHelpText] = useState<string>('');

  const [statusInfo, setStatusInfo] = useState<ProviderStatusInfo | null>(null);
  const [statusChecked, setStatusChecked] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bypassWarning, setBypassWarning] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const forcedExamSilent = (isProbeActive || isTransferProbe) && contextKind === 'active_case';
  const effectiveMode: TutorMode = forcedExamSilent ? 'exam_silent' : tutorMode;
  const isExamLocked = effectiveMode === 'exam_silent' && contextKind === 'active_case';

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      setStatusChecked(false);
      void fetchTutorStatus().then(info => {
        setStatusInfo(info);
        setStatusChecked(true);
      });
    }
  }, [enabled]);

  useEffect(() => {
    if (isOpen) {
      setGateOpenedAtMs(Date.now());
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    void getContractAccepted().then(rec => {
      if (rec?.accepted) {
        setContractAcceptedState(true);
      }
    });
  }, []);

  const onEpisodeStateChangeRef = useRef(onEpisodeStateChange);
  onEpisodeStateChangeRef.current = onEpisodeStateChange;

  useEffect(() => {
    onEnabledChange?.(enabled);
  }, [enabled, onEnabledChange]);

  useEffect(() => {
    if (!enabled) {
      onEpisodeStateChangeRef.current?.({
        ...episodeState,
        caseCompletionBlocked: false,
      });
    } else {
      onEpisodeStateChangeRef.current?.(episodeState);
    }
  }, [episodeState, enabled]);

  useEffect(() => {
    if (
      engineCommitSignal !== undefined &&
      prevEngineCommitRef.current !== undefined &&
      engineCommitSignal > prevEngineCommitRef.current
    ) {
      setEpisodeState(prev => transitionTutorEpisode(prev, { type: 'ENGINE_COMMIT' }));
    }
    prevEngineCommitRef.current = engineCommitSignal;
  }, [engineCommitSignal]);

  const toggleEnabled = () => {
    if (!enabled && !contractAcceptedState) {
      setShowContractModal(true);
      return;
    }
    setEnabled(prev => !prev);
  };

  const handleAcceptContract = () => {
    try {
      localStorage.setItem('ovs_tutor_contract_accepted', 'true');
    } catch {
      // ignore
    }
    setContractAcceptedState(true);
    setShowContractModal(false);
    setEnabled(true);
    setIsOpen(true);
    void setContractAccepted({
      accepted: true,
      acceptedAt: new Date().toISOString(),
      version: 'v2',
    });
  };

  const handleStartReconstruct = () => {
    setEpisodeState(prev => transitionTutorEpisode(prev, { type: 'START_RECONSTRUCT' }));
  };

  const handleSubmitReconstruction = async (e: React.FormEvent) => {
    e.preventDefault();
    const nowMs = Date.now();
    const nextState = transitionTutorEpisode(episodeState, {
      type: 'SUBMIT_RECONSTRUCTION',
      text: reconstructInput,
      nowMs,
    });
    setEpisodeState(nextState);
    if (nextState.reconstructionPassed) {
      const scheduled = await scheduleTutorDelayedRetest({
        competencyIds,
        caseId: caseId ?? contextKind,
        nowMs,
      });
      onDelayedRetestScheduled?.(scheduled);
      setReconstructInput('');
    }
  };

  const handleModeSelect = (next: TutorMode) => {
    if (forcedExamSilent) return;
    setTutorMode(next);
    onModeChange?.(next);
  };

  const remainingGemini = statusInfo?.gemini?.configured
    ? (statusInfo.gemini.remainingToday ?? 200)
    : 0;
  const remainingGroq = statusInfo?.groq?.configured
    ? (statusInfo.groq.remainingToday ?? 300)
    : 0;
  const isOffline =
    statusChecked &&
    (!statusInfo || (!statusInfo.gemini?.configured && !statusInfo.groq?.configured));

  const abgInterpretation: AbgCommitInterpretation | undefined = useMemo(() => {
    if (!hasAbg || !abgCommitted) return undefined;
    return {
      primaryDisorder: abgPrimary.trim(),
      compensationStatus: abgComp.trim(),
      oxygenationAaStatus: abgOxy.trim(),
      anionGapStatus: abgAg.trim() || undefined,
    };
  }, [hasAbg, abgCommitted, abgPrimary, abgComp, abgOxy, abgAg]);

  const attemptValidation = useMemo(() => {
    return validateStructuredAttempt(
      {
        observation,
        mechanismHypothesis,
        predictedConsequence: predictedConsequence.trim() || undefined,
        confidence: confidence ?? undefined,
        maneuversPerformed,
        attemptNumberInProblem: Math.min(3, turnHistory.length + 1),
        latencyMs: Math.max(0, Date.now() - gateOpenedAtMs),
      },
      {
        requiresPrediction: requiresPrediction && contextKind === 'active_case',
        requireAbgStrip: hasAbg && contextKind === 'active_case' && !abgCommitted,
        abgInterpretation,
      }
    );
  }, [
    observation,
    mechanismHypothesis,
    predictedConsequence,
    confidence,
    maneuversPerformed,
    turnHistory.length,
    gateOpenedAtMs,
    requiresPrediction,
    contextKind,
    hasAbg,
    abgCommitted,
    abgInterpretation,
  ]);

  // Monitor bypass phrases live
  useEffect(() => {
    if (detectGateBypassInput(observation) || detectGateBypassInput(mechanismHypothesis)) {
      setBypassWarning(CONTRACT_BYPASS_RESTATEMENT);
    } else {
      setBypassWarning(null);
    }
  }, [observation, mechanismHypothesis]);

  const buttonsDisabled =
    loading ||
    !attemptValidation.valid ||
    isExamLocked ||
    predictionPending ||
    debriefSelfCritiquePending ||
    !canRequestSocraticTurn(episodeState) ||
    turnHistory.length >= MAX_SOCRATIC_TURNS;

  const buildAttemptPayload = (): StructuredLearnerAttempt => ({
    observation: observation.trim(),
    mechanismHypothesis: mechanismHypothesis.trim(),
    predictedConsequence: predictedConsequence.trim() || undefined,
    confidence: confidence ?? 'guess',
    maneuversPerformed,
    attemptNumberInProblem: Math.min(MAX_SOCRATIC_TURNS, turnHistory.length + 1),
    latencyMs: Math.max(0, Date.now() - gateOpenedAtMs),
  });

  const handleSend = async (requestKind: LearnerRequestKind) => {
    if (
      isExamLocked ||
      predictionPending ||
      debriefSelfCritiquePending ||
      !canRequestSocraticTurn(episodeState) ||
      turnHistory.length >= MAX_SOCRATIC_TURNS
    ) {
      return;
    }
    if (!attemptValidation.valid || !confidence) {
      if (attemptValidation.bypassDetected) {
        setBypassWarning(CONTRACT_BYPASS_RESTATEMENT);
      }
      return;
    }

    const attempt = buildAttemptPayload();
    setEpisodeState(prev =>
      transitionTutorEpisode(prev, {
        type: 'SUBMIT_ATTEMPT',
        attempt,
        requiresPrediction: requiresPrediction && contextKind === 'active_case',
      })
    );
    const learnerDisplay =
      `Observation: ${attempt.observation}\nMechanism: ${attempt.mechanismHypothesis}` +
      (attempt.predictedConsequence ? `\nPrediction: ${attempt.predictedConsequence}` : '') +
      `\nConfidence: ${attempt.confidence}`;

    const learnerMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'learner',
      text: `[${requestKind.toUpperCase()}] ${learnerDisplay}`,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages(prev => [...prev, learnerMsg]);
    setLoading(true);
    setNotice(null);
    setBypassWarning(null);

    const effectiveCap = getCap
      ? getCap(requestKind, learnerDisplay, attempt, effectiveMode)
      : (helpLevelCap ?? 1);
    const effectiveContextText = getContext ? getContext(attempt) : (contextText ?? '');
    const effectiveForbidden = getForbiddenPhrases ? getForbiddenPhrases(attempt) : forbiddenPhrases;
    const isCase = contextKind === 'active_case';
    const isRevealOrTeach = effectiveCap >= 2 || contextKind === 'debrief';
    const ragPearls = isRevealOrTeach
      ? formatRagPearls(
          retrieveLocalTeachingPearls({
            competencyIds,
            queryText: `${attempt.observation} ${attempt.mechanismHypothesis}`,
            helpLevelCap: effectiveCap,
            isRevealStep: isRevealOrTeach,
          })
        )
      : [];

    const result = await sendTutorRequest(
      {
        contextKind,
        helpLevelCap: effectiveCap,
        requestKind,
        learnerMessage: learnerDisplay,
        learnerAttempt: attempt,
        history: turnHistory.slice(-3),
        tutorMode: effectiveMode,
        abgInterpretation,
        freeDiscussionMode: contextKind === 'free_discussion' ? freeDiscussionMode : undefined,
        ragPearls: ragPearls.length > 0 ? ragPearls : undefined,
        contextText: effectiveContextText,
        withheldDiagnosis,
        forbiddenPhrases: effectiveForbidden,
        promptVersion: 'v2',
      },
      {
        helpLevelCap: effectiveCap,
        forbiddenPhrases: effectiveForbidden,
        requestKind,
        isDebrief: contextKind === 'debrief',
        runId,
        simTimeSec: isCase ? simTimeSec : undefined,
        assisted: isCase ? true : undefined,
        learnerAttempt: attempt,
        verifiedEngineNumbers: getVerifiedEngineNumbers
          ? getVerifiedEngineNumbers()
          : verifiedEngineNumbers,
        activeAbnormalities: getActiveAbnormalities
          ? getActiveAbnormalities()
          : activeAbnormalities,
      }
    );

    setLoading(false);
    setGateOpenedAtMs(Date.now());

    if (result.success) {
      onTutorAssistedAction?.(result.data.help_level_used);
      setEpisodeState(prev =>
        transitionTutorEpisode(prev, {
          type: 'RECORD_TUTOR_RESPONSE',
          response: result.data,
        })
      );
      const tutorMsg: ChatMessage = {
        id: `tutor_${Date.now()}`,
        sender: 'tutor',
        text: result.data.message,
        question: result.data.question,
        claims: result.data.claims,
        reasoningGrade: result.data.reasoning_grade,
        helpLevelUsed: result.data.help_level_used,
        provider: result.provider,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages(prev => [...prev, tutorMsg]);
      setTurnHistory(prev => [
        ...prev.slice(-2),
        {
          turnIndex: prev.length + 1,
          learnerAttempt: attempt,
          tutorMessage: result.data.message,
          helpLevelUsed: result.data.help_level_used,
          reasoningGrade: result.data.reasoning_grade,
        },
      ]);
      void fetchTutorStatus().then(info => {
        setStatusInfo(info);
        setStatusChecked(true);
      });

      if (result.notice) {
        setNotice(result.notice);
      }
    } else {
      handleErrorNotice(result);
    }
  };

  const handleSendUiHelp = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = uiHelpText.trim();
    if (!q || loading) return;

    const learnerMsg: ChatMessage = {
      id: `msg_ui_${Date.now()}`,
      sender: 'learner',
      text: `[Simulator UI Question] ${q}`,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages(prev => [...prev, learnerMsg]);
    setUiHelpText('');
    setLoading(true);
    setNotice(null);

    const result = await sendTutorRequest(
      {
        contextKind,
        helpLevelCap: 0,
        learnerMessage: q,
        isUiHelpQuestion: true,
        tutorMode: effectiveMode,
        contextText: getContext ? getContext() : (contextText ?? ''),
        promptVersion: 'v2',
      },
      {
        helpLevelCap: 0,
        isDebrief: false,
        runId,
        assisted: false,
      }
    );

    setLoading(false);
    if (result.success) {
      setMessages(prev => [
        ...prev,
        {
          id: `tutor_ui_${Date.now()}`,
          sender: 'tutor',
          text: result.data.message,
          question: result.data.question,
          claims: result.data.claims,
          helpLevelUsed: result.data.help_level_used,
          provider: result.provider,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } else {
      handleErrorNotice(result);
    }
  };

  const handleErrorNotice = (result: Extract<Awaited<ReturnType<typeof sendTutorRequest>>, { success: false }>) => {
    if (
      result.error &&
      (result.error.includes('402') ||
        result.error.toLowerCase().includes('prepayment') ||
        result.error.toLowerCase().includes('billing'))
    ) {
      setNotice(
        'Gemini key is in a billing project with no credit. Make a free key in a new AI Studio project with no billing.'
      );
    } else if (result.notice) {
      setNotice(result.notice);
    } else if (result.failureKind === 'quota') {
      setNotice('Rate limit / quota exceeded; switched provider.');
    } else {
      setNotice(result.error || 'Tutor unavailable.');
    }
  };

  if (!enabled) {
    return (
      <>
        <div className={`p-2 text-xs flex flex-col gap-2 ${className}`} style={{ color: 'var(--text-2)' }} data-testid="tutor-off">
          {embedded && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
              The AI consultant questions your reasoning about this patient. It does not give answers away, and the app decides how much help each case allows.
            </p>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={false}
              onChange={toggleEnabled}
              className="rounded focus:ring-0"
              style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface-2)', accentColor: 'var(--act)' }}
            />
            <span>Enable AI Tutor (Off by default)</span>
          </label>
        </div>
        <ContractModal
          isOpen={showContractModal}
          onAccept={handleAcceptContract}
          onCancel={() => setShowContractModal(false)}
        />
      </>
    );
  }

  return (
    <aside
      aria-label="AI Clinical Tutor"
      data-testid="tutor-panel"
      className={`flex flex-col ${
        embedded ? 'w-full' : `border-l ${isOpen ? 'w-80 md:w-96' : 'w-12'}`
      } transition-all duration-200 z-30 ${className}`}
      style={{
        minHeight: isOpen ? '300px' : 'auto',
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--line)',
        color: 'var(--text)',
      }}
    >
      <ContractModal
        isOpen={showContractModal}
        onAccept={() => void handleAcceptContract()}
        onCancel={() => setShowContractModal(false)}
      />
      {/* Header bar */}
      <div
        className="flex items-center justify-between p-2.5 border-b"
        style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
      >
        <button
          type="button"
          onClick={() => { if (!embedded) setIsOpen(prev => !prev); }}
          className="text-xs font-semibold flex items-center gap-1"
          style={{ color: 'var(--act)' }}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Collapse AI Tutor' : 'Expand AI Tutor'}
          title={isOpen ? 'Collapse panel' : 'Expand AI Tutor'}
        >
          {!embedded && <span>{isOpen ? '◀' : '▶'}</span>}
          {isOpen && <span>AI Clinical Tutor</span>}
        </button>
        {isOpen && (
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: 'var(--text-2)' }} title="Requests remaining today">
              {remainingGemini > 0
                ? `Gemini: ${remainingGemini} left`
                : remainingGroq > 0
                ? `Groq: ${remainingGroq} left`
                : 'Offline (No AI)'}
            </span>
            <button
              type="button"
              onClick={toggleEnabled}
              className="text-[10px]"
              style={{ color: 'var(--text-3)' }}
              title="Turn tutor off"
            >
              Turn off
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <>
          {/* One-line contract badge + Stage indicator */}
          <div
            className="border-b px-3 py-1.5 text-[10px] leading-snug space-y-1"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--line)', color: 'var(--text)' }}
          >
            <div data-testid="tutor-contract-badge">{CONTRACT_BADGE_TEXT}</div>
            <div className="flex items-center justify-between gap-2 text-[9px]" style={{ color: 'var(--text-2)' }}>
              <span
                data-testid="tutor-state-badge"
                className="px-1.5 py-0.5 rounded font-mono font-semibold"
                style={{ backgroundColor: 'var(--surface-2)', color: 'var(--act)' }}
              >
                {episodeState.state} · Turn {episodeState.turnCount}/{MAX_SOCRATIC_TURNS}
              </span>
              <button
                type="button"
                onClick={() => setShowContractModal(true)}
                className="underline"
                style={{ color: 'var(--act)' }}
              >
                Contract
              </button>
            </div>
          </div>

          {episodeState.metaSocraticPrompt && (
            <div
              data-testid="tutor-meta-socratic-cue"
              className="px-3 py-1.5 border-b text-[10px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
            >
              {episodeState.metaSocraticPrompt}
            </div>
          )}

          {/* Synthetic patient warning banner */}
          <div
            className="border-b px-3 py-1 text-[11px]"
            style={{
              backgroundColor: 'var(--warn-bg)',
              borderColor: 'var(--line)',
              color: 'var(--warn-ink)',
            }}
          >
            <strong>Synthetic patients only.</strong> Do not type real patient details.
          </div>

          {/* Mode Selector (Coaching / Exam-Silent / Low-Bandwidth) */}
          <div
            className="px-2.5 py-1.5 border-b flex items-center justify-between gap-1 text-[10px]"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--text-2)' }}>Mode:</span>
            {forcedExamSilent ? (
              <span
                data-testid="tutor-exam-mode-badge"
                className="px-2 py-0.5 rounded border font-semibold"
                style={{ backgroundColor: 'var(--surface-3)', borderColor: 'var(--act)', color: 'var(--text)' }}
              >
                Exam / Consultant-Silent (Probe Locked)
              </span>
            ) : (
              <div className="flex gap-1">
                {(
                  [
                    ['coaching', 'Coaching'],
                    ['exam_silent', 'Exam Silent'],
                    ['low_bandwidth', 'Low-BW'],
                  ] as const
                ).map(([mId, mLabel]) => (
                  <button
                    key={mId}
                    type="button"
                    data-testid={`tutor-mode-${mId}`}
                    onClick={() => handleModeSelect(mId)}
                    className={`px-1.5 py-0.5 rounded border ${effectiveMode === mId ? 'font-semibold' : ''}`}
                    style={{
                      backgroundColor: effectiveMode === mId ? 'var(--act)' : 'var(--surface-2)',
                      borderColor: effectiveMode === mId ? 'var(--act)' : 'var(--line)',
                      color: effectiveMode === mId ? 'var(--act-ink)' : 'var(--text-2)',
                    }}
                  >
                    {mLabel}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Low-Bandwidth isolated numbers card */}
          {effectiveMode === 'low_bandwidth' && lowBandwidthFocusVars && lowBandwidthFocusVars.length > 0 && (
            <div
              data-testid="tutor-low-bandwidth-focus"
              className="px-3 py-1.5 border-b text-[11px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
            >
              <div className="font-semibold text-[10px] uppercase tracking-wider" style={{ color: 'var(--act)' }}>
                Low-Bandwidth Focus (15-min cap)
              </div>
              <div className="flex gap-3 mt-0.5 font-mono">
                {lowBandwidthFocusVars.slice(0, 2).map((v, idx) => (
                  <span key={idx}>
                    {v.label}: <strong>{v.value}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Free Discussion structured modes (Surface 8.1 h) */}
          {contextKind === 'free_discussion' && (
            <div
              className="px-2.5 py-1.5 border-b flex gap-1 text-[10px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
            >
              <button
                type="button"
                onClick={() => setFreeDiscussionMode('stress_test')}
                className={`flex-1 py-1 px-1.5 rounded border ${freeDiscussionMode === 'stress_test' ? 'font-semibold' : ''}`}
                style={{
                  backgroundColor: freeDiscussionMode === 'stress_test' ? 'var(--act)' : 'var(--surface)',
                  borderColor: freeDiscussionMode === 'stress_test' ? 'var(--act)' : 'var(--line)',
                  color: freeDiscussionMode === 'stress_test' ? 'var(--act-ink)' : 'var(--text-2)',
                }}
              >
                Stress-Test Mental Model
              </button>
              <button
                type="button"
                onClick={() => setFreeDiscussionMode('compare_scenarios')}
                className={`flex-1 py-1 px-1.5 rounded border ${freeDiscussionMode === 'compare_scenarios' ? 'font-semibold' : ''}`}
                style={{
                  backgroundColor: freeDiscussionMode === 'compare_scenarios' ? 'var(--act)' : 'var(--surface)',
                  borderColor: freeDiscussionMode === 'compare_scenarios' ? 'var(--act)' : 'var(--line)',
                  color: freeDiscussionMode === 'compare_scenarios' ? 'var(--act-ink)' : 'var(--text-2)',
                }}
              >
                Compare Two Scenarios
              </button>
            </div>
          )}

          {isOffline && !notice && (
            <div
              className="border-b px-3 py-1.5 text-[11px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
              data-testid="tutor-offline-notice"
            >
              AI tutor is offline (no LLM proxy/key configured). Simulator, Lab, Practice, and debriefing work fully offline.
            </div>
          )}

          {notice && (
            <div
              className="border-b px-3 py-1.5 text-xs flex justify-between items-center"
              style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--alarm-high)', color: 'var(--alarm-high)' }}
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-xs ml-2"
                style={{ color: 'var(--alarm-high)' }}
              >
                ✕
              </button>
            </div>
          )}

          {bypassWarning && (
            <div
              data-testid="tutor-bypass-restatement"
              className="border-b px-3 py-2 text-[11px] leading-snug"
              style={{
                backgroundColor: 'var(--warn-bg)',
                borderColor: 'var(--warn-line)',
                color: 'var(--text)',
              }}
            >
              {bypassWarning}
            </div>
          )}

          {isExamLocked && (
            <div
              data-testid="tutor-exam-locked-msg"
              className="px-3 py-2 border-b text-[11px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
            >
              Exam / Consultant-Silent Mode is active: hints are locked during the case so unaided performance can be assessed. Full teaching unlocks in Debrief.
            </div>
          )}

          {predictionPending && !isExamLocked && (
            <div
              data-testid="tutor-prediction-locked-msg"
              className="px-3 py-2 border-b text-[11px]"
              style={{
                backgroundColor: 'var(--warn-bg)',
                borderColor: 'var(--line)',
                color: 'var(--warn-ink)',
              }}
            >
              Commit your scripted prediction modal first before requesting tutor guidance.
            </div>
          )}

          {hasActiveAlarmOrWaveform &&
            !maneuversPerformed.some(m => m === 'inspiratory_hold' || m === 'expiratory_hold') && (
              <div
                className="px-3 py-1.5 border-b text-[10px]"
                style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--act)' }}
              >
                Identify the abnormal phase of the breath (trigger, inspiration, cycling, or expiration) and what maneuver tests it.
              </div>
            )}

          {/* Surface (c): ABG Commit Strip */}
          {hasAbg && contextKind === 'active_case' && !abgCommitted && !isExamLocked && (
            <div
              data-testid="tutor-abg-commit-strip"
              className="p-2.5 border-b space-y-1.5 text-[11px]"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
            >
              <div className="font-semibold" style={{ color: 'var(--warn-ink)' }}>
                ABG Commit Strip (Required before ABG tutoring)
              </div>
              <input
                type="text"
                aria-label="ABG Primary Disorder"
                placeholder="Primary disorder (e.g., high-AG metabolic acidosis)"
                value={abgPrimary}
                onChange={e => setAbgPrimary(e.target.value)}
                className="w-full border rounded px-2 py-1 text-[11px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              />
              <input
                type="text"
                aria-label="ABG Compensation Status"
                placeholder="Compensation (e.g., Winter expected PaCO2 26-30)"
                value={abgComp}
                onChange={e => setAbgComp(e.target.value)}
                className="w-full border rounded px-2 py-1 text-[11px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              />
              <input
                type="text"
                aria-label="ABG Oxygenation Status"
                placeholder="Oxygenation / A-a status (e.g., wide A-a gradient)"
                value={abgOxy}
                onChange={e => setAbgOxy(e.target.value)}
                className="w-full border rounded px-2 py-1 text-[11px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              />
              <input
                type="text"
                aria-label="ABG Anion Gap Status"
                placeholder="Anion gap status (optional)"
                value={abgAg}
                onChange={e => setAbgAg(e.target.value)}
                className="w-full border rounded px-2 py-1 text-[11px]"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              />
              <button
                type="button"
                data-testid="tutor-abg-commit-btn"
                disabled={!abgPrimary.trim() || !abgComp.trim() || !abgOxy.trim()}
                onClick={() => setAbgCommitted(true)}
                className="w-full rounded py-1 text-[11px] font-semibold"
                style={{
                  backgroundColor: !abgPrimary.trim() || !abgComp.trim() || !abgOxy.trim() ? 'var(--surface-3)' : 'var(--act)',
                  color: !abgPrimary.trim() || !abgComp.trim() || !abgOxy.trim() ? 'var(--text-3)' : 'var(--act-ink)',
                }}
              >
                Commit ABG Reading
              </button>
            </div>
          )}

          {/* Pre-Attempt Structured Gate */}
          {!isExamLocked && (
            <div
              data-testid="tutor-attempt-gate"
              className="p-2.5 border-b space-y-1.5 text-[11px]"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-2)' }}>
                <span className="font-semibold" style={{ color: 'var(--act)' }}>
                  Pre-Attempt Gate (Turn {Math.min(3, turnHistory.length + 1)}/3)
                </span>
                <span>{maneuversPerformed.length} maneuver(s)</span>
              </div>

              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-2)' }}>
                  Observation ({countWords(observation)}/{MIN_OBSERVATION_WORDS} words min)
                </label>
                <input
                  type="text"
                  data-testid="tutor-attempt-observation"
                  aria-label="Observation"
                  placeholder="Describe waveform / monitor data (≥4 words)..."
                  value={observation}
                  onChange={e => setObservation(e.target.value)}
                  disabled={loading}
                  className="w-full border rounded px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-2)' }}>
                  Mechanism Hypothesis ({countWords(mechanismHypothesis)}/{MIN_MECHANISM_WORDS} words min)
                </label>
                <textarea
                  rows={2}
                  data-testid="tutor-attempt-mechanism"
                  aria-label="Mechanism Hypothesis"
                  placeholder="Explain physiological cause & mechanism (≥6 words)..."
                  value={mechanismHypothesis}
                  onChange={e => setMechanismHypothesis(e.target.value)}
                  disabled={loading}
                  className="w-full border rounded px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-2)' }}>
                  Predicted Consequence {requiresPrediction ? '(required)' : '(optional)'}
                </label>
                <input
                  type="text"
                  data-testid="tutor-attempt-prediction"
                  aria-label="Predicted Consequence"
                  placeholder="Expected change in Pplat, PaCO2, SpO2, MAP..."
                  value={predictedConsequence}
                  onChange={e => setPredictedConsequence(e.target.value)}
                  disabled={loading}
                  className="w-full border rounded px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
                />
              </div>

              <div className="flex items-center justify-between gap-1 pt-0.5">
                <span className="text-[10px]" style={{ color: 'var(--text-2)' }}>Confidence:</span>
                <div className="flex gap-1">
                  {(['guess', 'fairly_sure', 'certain'] as TutorConfidence[]).map(conf => (
                    <button
                      key={conf}
                      type="button"
                      data-testid={`tutor-attempt-confidence-${conf}`}
                      onClick={() => setConfidence(conf)}
                      className={`px-2 py-0.5 rounded text-[10px] border ${confidence === conf ? 'font-semibold' : ''}`}
                      style={{
                        backgroundColor: confidence === conf ? 'var(--act)' : 'var(--surface-2)',
                        borderColor: confidence === conf ? 'var(--act)' : 'var(--line)',
                        color: confidence === conf ? 'var(--act-ink)' : 'var(--text-2)',
                      }}
                    >
                      {conf === 'guess' ? 'Guess' : conf === 'fairly_sure' ? 'Fairly sure' : 'Certain'}
                    </button>
                  ))}
                </div>
              </div>

              {!attemptValidation.valid && attemptValidation.reason && (
                <div className="text-[10px]" style={{ color: 'var(--text-2)' }}>{attemptValidation.reason}</div>
              )}
            </div>
          )}

          {/* Quick action request buttons (disabled until StructuredLearnerAttempt is valid) */}
          <div
            className="p-2 border-b grid grid-cols-3 gap-1 text-xs"
            style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
          >
            <button
              type="button"
              data-testid="tutor-btn-hint"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('hint')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Get a hint pointing where to look"
            >
              Hint
            </button>
            <button
              type="button"
              data-testid="tutor-btn-narrow"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('narrow')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Narrow diagnostic or management categories"
            >
              Narrow
            </button>
            <button
              type="button"
              data-testid="tutor-btn-explain"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('explain')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Explain the physiology within current cap"
            >
              Explain
            </button>
            <button
              type="button"
              data-testid="tutor-btn-go_deeper"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('go_deeper')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Go deeper into mechanism"
            >
              Go deeper
            </button>
            <button
              type="button"
              data-testid="tutor-btn-worked_example"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('worked_example')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Worked calculation with patient numbers"
            >
              Worked ex.
            </button>
            <button
              type="button"
              data-testid="tutor-btn-challenge_me"
              disabled={buttonsDisabled}
              onClick={() => void handleSend('challenge_me')}
              className="disabled:opacity-40 disabled:cursor-not-allowed py-1 px-1.5 rounded text-center truncate border"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
              title="Ask a challenge question"
            >
              Challenge me
            </button>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs leading-relaxed">
            {messages.length === 0 && (
              <p className="italic text-center mt-4" style={{ color: 'var(--text-3)' }}>
                Complete the Pre-Attempt Gate above (observation, mechanism hypothesis, confidence) before requesting guidance.
              </p>
            )}

            {messages.map(m => {
              const isMasked =
                episodeState.maskTutorResponses && m.sender === 'tutor';

              return (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.sender === 'learner' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className="max-w-[92%] rounded-lg px-3 py-2 border"
                  style={{
                    backgroundColor: m.sender === 'learner' ? 'var(--surface-3)' : 'var(--surface-2)',
                    borderColor: m.sender === 'learner' ? 'var(--act)' : 'var(--line)',
                    color: 'var(--text)',
                  }}
                >
                  {isMasked ? (
                    <p
                      data-testid="tutor-masked-message"
                      className="italic"
                      style={{ color: 'var(--text-2)' }}
                    >
                      [Tutor explanation masked during causal reconstruction — synthesize the mechanism from memory.]
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  )}

                  {!isMasked && m.reasoningGrade && (
                    <div
                      className="mt-1.5 pt-1.5 border-t text-[10px]"
                      style={{ borderColor: 'var(--line)', color: 'var(--warn-ink)' }}
                    >
                      Reasoning: {m.reasoningGrade.replace(/_/g, ' ')}
                    </div>
                  )}

                  {!isMasked && m.claims && m.claims.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t space-y-1" style={{ borderColor: 'var(--line)' }}>
                      {m.claims.map((c, i) => (
                        <div key={i} className="flex items-start gap-1 text-[10px]" style={{ color: 'var(--text-2)' }}>
                          <span
                            className="px-1 py-0.2 rounded uppercase font-semibold text-[9px] border"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--line)',
                              color: c.evidence_level === 'guideline' ? 'var(--ok)' : 'var(--act)',
                            }}
                          >
                            {c.evidence_level}
                          </span>
                          <span className="flex-1">{c.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isMasked && m.question && (
                    <div
                      className="mt-2 p-2 rounded border text-xs"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--act)', color: 'var(--text)' }}
                    >
                      <strong>Check question:</strong> {m.question}
                    </div>
                  )}
                </div>
                <span className="text-[9px] mt-0.5 px-1" style={{ color: 'var(--text-3)' }}>
                  {m.timestamp} {m.provider ? `(${m.provider})` : ''}
                </span>
              </div>
              );
            })}

            {episodeState.state === 'REVEAL' &&
              episodeState.reconstructionRequired &&
              episodeState.reconstructionPassed !== true && (
                <div
                  className="p-2.5 rounded border space-y-2 text-[11px]"
                  style={{ backgroundColor: 'var(--warn-bg)', borderColor: 'var(--warn-line)', color: 'var(--text)' }}
                >
                  <div>
                    Worked teaching / narrowing explanation provided (Level {episodeState.maxHelpLevelUsedInEpisode}).
                    Close this explanation and reconstruct the causal mechanism independently from memory before finishing.
                  </div>
                  <button
                    type="button"
                    data-testid="tutor-start-reconstruct-btn"
                    onClick={handleStartReconstruct}
                    className="w-full py-1.5 rounded font-semibold"
                    style={{ backgroundColor: 'var(--act)', color: 'var(--act-ink)' }}
                  >
                    Close Explanation &amp; Reconstruct from Memory
                  </button>
                </div>
              )}

            {episodeState.state === 'RECONSTRUCT' && (
              <form
                data-testid="tutor-reconstruct-panel"
                onSubmit={e => void handleSubmitReconstruction(e)}
                className="p-2.5 rounded border space-y-2 text-[11px]"
                style={{ backgroundColor: 'var(--warn-bg)', borderColor: 'var(--warn-line)', color: 'var(--text)' }}
              >
                <div className="font-semibold" style={{ color: 'var(--warn-ink)' }}>
                  Causal Reconstruction Required (Tutor Text Masked)
                </div>
                <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>
                  In 1–2 causal sentences from memory, explain what physical mechanism connects the ventilator setting, measured mechanics, and patient trajectory.
                </p>
                <textarea
                  rows={3}
                  data-testid="tutor-reconstruct-input"
                  aria-label="Causal reconstruction from memory"
                  placeholder="Because reducing respiratory rate lengthens expiratory time, trapped alveolar gas empties and total PEEP falls..."
                  value={reconstructInput}
                  onChange={e => setReconstructInput(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-[11px]"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--warn-line)', color: 'var(--text)' }}
                />
                {episodeState.reconstructionError && (
                  <div
                    data-testid="tutor-reconstruct-error"
                    className="text-[10px] font-medium"
                    style={{ color: 'var(--alarm-high)' }}
                  >
                    {episodeState.reconstructionError}
                  </div>
                )}
                <button
                  type="submit"
                  data-testid="tutor-reconstruct-submit"
                  className="w-full py-1.5 rounded font-semibold"
                  style={{ backgroundColor: 'var(--ok)', color: '#000' }}
                >
                  Verify Reconstruction &amp; Schedule 48h Retest
                </button>
              </form>
            )}

            {episodeState.state === 'DELAYED_RETEST' && (
              <div
                data-testid="tutor-retest-scheduled"
                className="p-2 rounded border text-[11px]"
                style={{ backgroundColor: 'var(--ok-bg)', borderColor: 'var(--ok)', color: 'var(--ok)' }}
              >
                Causal reconstruction logged. 48-hour delayed spaced retest scheduled; case completion unlocked.
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-xs p-2" style={{ color: 'var(--act)' }}>
                <span className="animate-spin">●</span>
                <span>Tutor analyzing respiratory mechanics...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Exception C: Pure Simulator UI Help toggle & input */}
          <div
            className="p-2 border-t space-y-1.5"
            style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}
          >
            <button
              type="button"
              data-testid="tutor-ui-help-btn"
              onClick={() => setShowUiHelp(v => !v)}
              className="text-[10px] underline"
              style={{ color: 'var(--text-2)' }}
            >
              {showUiHelp ? 'Hide simulator UI help' : 'Simulator UI / button location help (Exception C)'}
            </button>
            {showUiHelp && (
              <form onSubmit={e => void handleSendUiHelp(e)} className="flex gap-1.5">
                <input
                  type="text"
                  aria-label="Simulator UI question"
                  placeholder="e.g., Where is the inspiratory hold button?"
                  value={uiHelpText}
                  onChange={e => setUiHelpText(e.target.value)}
                  disabled={loading}
                  className="flex-1 border rounded px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}
                />
                <button
                  type="submit"
                  disabled={loading || !uiHelpText.trim()}
                  className="rounded px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: loading || !uiHelpText.trim() ? 'var(--surface-3)' : 'var(--act)',
                    color: loading || !uiHelpText.trim() ? 'var(--text-3)' : 'var(--act-ink)',
                  }}
                >
                  UI Help
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
