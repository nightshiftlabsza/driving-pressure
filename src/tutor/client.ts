import type {
  TutorRequest,
  TutorResult,
  TutorSuccessResult,
  TutorFailureResult,
  HelpLevel,
  LearnerRequestKind,
  StructuredLearnerAttempt,
} from './types';
import { validateTutorResponse } from './validate';
import { saveTutorExchange, type TutorExchangeRecord } from './store';

export interface ProviderStatusInfo {
  gemini: { configured: boolean; remainingToday: number };
  groq: { configured: boolean; remainingToday: number };
  ollama: { configured: boolean };
}

export async function fetchTutorStatus(): Promise<ProviderStatusInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/tutor', {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as ProviderStatusInfo;
  } catch {
    return null;
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export async function sendTutorRequest(
  request: TutorRequest,
  options: {
    helpLevelCap: HelpLevel;
    forbiddenPhrases?: string[];
    requestKind?: LearnerRequestKind;
    isDebrief?: boolean;
    abortMs?: number;
    runId?: string;
    simTimeSec?: number;
    assisted?: boolean;
    learnerAttempt?: StructuredLearnerAttempt;
    verifiedEngineNumbers?: Record<string, number>;
    activeAbnormalities?: string[];
  }
): Promise<TutorResult> {
  const abortMs = options.abortMs ?? 25000;

  async function callServer(): Promise<TutorResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), abortMs);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await res.json()) as TutorResult;
      return data;
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort =
        Boolean(err) &&
        ((typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError') ||
          (err instanceof Error && err.message.toLowerCase().includes('abort')) ||
          String(err).toLowerCase().includes('abort'));
      if (isAbort) {
        return {
          success: false,
          failureKind: 'timeout',
          error: 'Request timed out after 25s.',
        };
      }
      return {
        success: false,
        failureKind: 'network',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // First call
  let serverResult = await callServer();

  // If server returned failure
  if (!serverResult.success) {
    return serverResult;
  }

  const validationOpts = {
    helpLevelCap: options.helpLevelCap,
    forbiddenPhrases: options.forbiddenPhrases,
    requestKind: options.requestKind,
    isDebrief: options.isDebrief,
    verifiedEngineNumbers: options.verifiedEngineNumbers,
    activeAbnormalities: options.activeAbnormalities,
    learnerAttempt: options.learnerAttempt ?? request.learnerAttempt,
    promptVersion: request.promptVersion,
  };

  // Validate the response
  let validation = validateTutorResponse(serverResult.data, validationOpts);

  // If validation failed or blocked by leakage / numeric contradiction, regenerate once
  if (!validation.valid) {
    // Attempt 1 regeneration
    serverResult = await callServer();
    if (!serverResult.success) {
      return {
        success: false,
        failureKind: 'policy_blocked',
        error: 'Tutor unavailable for this question; your case continues.',
      };
    }

    validation = validateTutorResponse(serverResult.data, validationOpts);

    if (!validation.valid) {
      return {
        success: false,
        failureKind: 'policy_blocked',
        error: 'Tutor unavailable for this question; your case continues.',
      };
    }
  }

  const successResult: TutorSuccessResult = {
    success: true,
    data: validation.sanitizedResponse!,
    provider: serverResult.provider,
    model: serverResult.model,
    latencyMs: serverResult.latencyMs,
    promptVersion: serverResult.promptVersion || 'v1',
    rawJson: serverResult.rawJson,
    notice: serverResult.notice,
  };

  // Save exchange to IndexedDB (asynchronously, never blocking UI)
  const isCase = request.contextKind === 'active_case';
  const exchangeRecord: TutorExchangeRecord = {
    id: `tut_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    contextHash: simpleHash(request.contextText),
    contextKind: request.contextKind,
    provider: successResult.provider,
    model: successResult.model,
    promptVersion: successResult.promptVersion,
    cap: options.helpLevelCap,
    levelUsed: successResult.data.help_level_used,
    rawOutput: successResult.rawJson || JSON.stringify(successResult.data),
    validatedOutput: successResult.data,
    latencyMs: successResult.latencyMs,
    tokens: { inputTokens: 0, outputTokens: 0 },
    suggestions: [
      ...successResult.data.misconception_ids.map(mid => ({
        misconceptionId: mid,
        confidence: successResult.data.confidence,
        status: 'suggested' as const,
      })),
      ...(successResult.data.reasoning_grade
        ? [
            {
              reasoningGrade: successResult.data.reasoning_grade,
              confidence: successResult.data.confidence,
              status: 'suggested' as const,
            },
          ]
        : []),
    ],
    assisted: options.assisted ?? (isCase ? true : undefined),
    runId: options.runId,
    simTimeSec: options.simTimeSec,
  };

  // Run assistance is counted by the case runner when it receives this successful reply;
  // the client itself never touches the runtime.
  void saveTutorExchange(exchangeRecord).catch(() => {});

  return successResult;
}
