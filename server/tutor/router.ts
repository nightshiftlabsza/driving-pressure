import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { GeminiProvider } from './providers/gemini';
import { GroqProvider } from './providers/groq';
import { OllamaProvider } from './providers/ollama';
import type { ProviderCompletionResult, TutorProvider } from './providers/types';
import { BudgetTracker } from './budget';
import { TUTOR_JSON_SCHEMA, GEMINI_RESPONSE_SCHEMA } from './providers/schema';
import type { TutorRequest, TutorResult, HelpLevel, TutorFailureKind } from '../../src/tutor/types';

export interface RouterOptions {
  budgetTracker?: BudgetTracker;
  promptPath?: string;
  timeoutMs?: number;
}

/**
 * Prompt selection. The client always asks for the "v2" response contract, so
 * the file is chosen by the server: prompts/tutor-v3.md by default, or
 * prompts/tutor-v2.md when the environment variable TUTOR_PROMPT_VERSION=v2
 * is set (read with process.env only). A client request for "v1" still gets v1.
 */
export function resolvePromptFile(
  promptVersion?: string,
  explicitPath?: string
): { path: string; version: 'v1' | 'v2' | 'v3' } {
  if (explicitPath) {
    return {
      path: explicitPath,
      version: explicitPath.includes('v3') ? 'v3' : explicitPath.includes('v2') ? 'v2' : 'v1',
    };
  }
  if (promptVersion === 'v1') {
    return {
      path: path.resolve(process.cwd(), 'prompts/tutor-v1.md'),
      version: 'v1',
    };
  }
  if (process.env.TUTOR_PROMPT_VERSION !== 'v2') {
    const v3Path = path.resolve(process.cwd(), 'prompts/tutor-v3.md');
    if (fs.existsSync(v3Path)) {
      return { path: v3Path, version: 'v3' };
    }
  }
  const v2Path = path.resolve(process.cwd(), 'prompts/tutor-v2.md');
  if (fs.existsSync(v2Path)) {
    return { path: v2Path, version: 'v2' };
  }
  return {
    path: path.resolve(process.cwd(), 'prompts/tutor-v1.md'),
    version: 'v1',
  };
}

export function loadSystemPrompt(promptPath?: string, promptVersion?: string): string {
  const { path: p } = resolvePromptFile(promptVersion, promptPath);
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, 'utf8');
  }
  return 'You are the AI clinical-reasoning tutor for open-vent-sim. Output strict JSON.';
}

export function selectOllamaModel(
  contextKind: TutorRequest['contextKind'],
  env: Record<string, string> = {}
): string {
  const defaultBedside = env.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'qwen3:8b';
  if (contextKind === 'debrief') {
    return env.OLLAMA_DEBRIEF_MODEL || process.env.OLLAMA_DEBRIEF_MODEL || defaultBedside;
  }
  return defaultBedside;
}

export async function executeWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = 20000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function runTutorCompletion(
  tutorReq: TutorRequest,
  env: Record<string, string>,
  options: RouterOptions = {}
): Promise<TutorResult> {
  const budget = options.budgetTracker ?? new BudgetTracker();
  const resolvedPrompt = resolvePromptFile(tutorReq.promptVersion, options.promptPath);
  const systemPrompt = loadSystemPrompt(resolvedPrompt.path, tutorReq.promptVersion);
  const isDebrief = tutorReq.contextKind === 'debrief';
  const timeoutMs = options.timeoutMs ?? (isDebrief ? 20000 : 10000);

  const geminiKey =
    env.GEMINI_API_KEY !== undefined ? env.GEMINI_API_KEY : process.env.GEMINI_API_KEY || '';
  const groqKey =
    env.GROQ_API_KEY !== undefined ? env.GROQ_API_KEY : process.env.GROQ_API_KEY || '';

  // Assemble user prompt
  const userPromptParts: string[] = [
    `Context kind: ${tutorReq.contextKind}`,
    `Help level cap allowed: ${tutorReq.helpLevelCap}`,
  ];

  if (tutorReq.tutorMode) {
    userPromptParts.push(`Tutor mode: ${tutorReq.tutorMode}`);
  }
  if (tutorReq.freeDiscussionMode) {
    userPromptParts.push(`Free discussion mode: ${tutorReq.freeDiscussionMode}`);
  }
  if (tutorReq.requestKind) {
    userPromptParts.push(`Learner requested: ${tutorReq.requestKind}`);
  }
  if (tutorReq.learnerAttempt) {
    const a = tutorReq.learnerAttempt;
    userPromptParts.push(
      [
        'Structured learner attempt:',
        `- Observation: ${a.observation}`,
        `- Mechanism hypothesis: ${a.mechanismHypothesis}`,
        a.predictedConsequence ? `- Prediction: ${a.predictedConsequence}` : null,
        `- Confidence: ${a.confidence}`,
        `- Attempt # in problem: ${a.attemptNumberInProblem}`,
        a.maneuversPerformed && a.maneuversPerformed.length > 0
          ? `- Maneuvers performed: ${a.maneuversPerformed.join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else if (tutorReq.learnerMessage) {
    userPromptParts.push(`Learner message/reasoning: ${tutorReq.learnerMessage}`);
  }
  if (tutorReq.abgInterpretation) {
    const abg = tutorReq.abgInterpretation;
    userPromptParts.push(
      `ABG interpretation committed: disorder=${abg.primaryDisorder}, compensation=${abg.compensationStatus}, oxygenation/A-a=${abg.oxygenationAaStatus}${abg.anionGapStatus ? `, anionGap=${abg.anionGapStatus}` : ''}`
    );
  }
  if (tutorReq.history && tutorReq.history.length > 0) {
    const histLines = tutorReq.history.slice(-3).flatMap(h => {
      const lines = [
        `Turn ${h.turnIndex} learner: obs="${h.learnerAttempt.observation}" mech="${h.learnerAttempt.mechanismHypothesis}"`,
      ];
      const tutorText = (h.tutorMessage ?? '').trim();
      if (tutorText) {
        const clipped = tutorText.length > 500 ? `${tutorText.slice(0, 500)}...` : tutorText;
        lines.push(`Turn ${h.turnIndex} tutor (level ${h.helpLevelUsed}): "${clipped}"`);
      }
      return lines;
    });
    userPromptParts.push(
      `Recent turn history:\n${histLines.join('\n')}\nBuild on your previous turn. Do not repeat a question you already asked. If the learner answered it, respond to their answer.`
    );
  }
  if (tutorReq.derivedIndicesSummary) {
    userPromptParts.push(`Engine pre-computed derived indices (VERIFIED TRUTH):\n${tutorReq.derivedIndicesSummary}`);
  }
  if (tutorReq.unaccountedAbnormalities && tutorReq.unaccountedAbnormalities.length > 0) {
    userPromptParts.push(
      `Unaccounted physiological abnormalities:\n- ${tutorReq.unaccountedAbnormalities.join('\n- ')}`
    );
  }
  if (tutorReq.ragPearls && tutorReq.ragPearls.length > 0 && (tutorReq.helpLevelCap >= 2 || isDebrief)) {
    userPromptParts.push(
      `Local reference teaching pearls (max 2, grounded in local curriculum):\n- ${tutorReq.ragPearls.slice(0, 2).join('\n- ')}`
    );
  }
  if (tutorReq.withheldDiagnosis) {
    userPromptParts.push(
      `CRITICAL INSTRUCTION: Probe active: do not name or diagnose the underlying condition (${tutorReq.withheldDiagnosis}). Guide the learner to inspect relevant observations without giving away the answer.`
    );
  }
  if (tutorReq.forbiddenPhrases && tutorReq.forbiddenPhrases.length > 0) {
    userPromptParts.push(
      `CRITICAL INSTRUCTION: Hidden answer / probe active. Do NOT reveal the answer or explanation, and do NOT use any of these forbidden terms or phrases: [${tutorReq.forbiddenPhrases.join(', ')}].`
    );
  }
  userPromptParts.push(`Patient Snapshot and Simulation Data:\n${tutorReq.contextText}`);

  const userPrompt = userPromptParts.join('\n\n');

  // Candidate provider sequence
  const candidates: Array<{
    name: 'gemini' | 'groq' | 'ollama';
    create: () => TutorProvider;
  }> = [];

  if (geminiKey && budget.hasBudget('gemini')) {
    candidates.push({
      name: 'gemini',
      create: () => new GeminiProvider(geminiKey),
    });
  }

  if (groqKey && budget.hasBudget('groq')) {
    candidates.push({
      name: 'groq',
      create: () => new GroqProvider(groqKey),
    });
  }

  // Always consider Ollama as fallback with dual local routing (bedside 7-8B vs debrief optional 14B)
  const ollamaModel = selectOllamaModel(tutorReq.contextKind, env);
  const ollamaKeepAlive = env.OLLAMA_KEEP_ALIVE || process.env.OLLAMA_KEEP_ALIVE || '30m';
  candidates.push({
    name: 'ollama',
    create: () => new OllamaProvider(ollamaModel, undefined, ollamaKeepAlive),
  });

  if (candidates.length === 0) {
    return {
      success: false,
      failureKind: 'no_ai',
      error: 'No AI providers available (missing keys or budget exhausted).',
    };
  }

  let lastError: string = 'No provider succeeded';
  let lastFailureKind: TutorFailureKind = !geminiKey && !groqKey ? 'no_ai' : 'unavailable';
  let fallbackNotice: string | undefined = !geminiKey && groqKey ? 'Gemini disabled; using Groq fallback.' : undefined;

  for (const candidate of candidates) {
    const provider = candidate.create();

    // Check Groq 6000 token limit
    if (candidate.name === 'groq') {
      const groq = provider as GroqProvider;
      const estimated = groq.estimateTokens(`${systemPrompt}\n${userPrompt}`);
      if (estimated > 6000) {
        budget.logUsage({
          provider: 'groq',
          model: provider.model,
          latencyMs: 0,
          outcome: 'failure',
          error: `Refused: estimated ${estimated} tokens exceeds 6,000 token limit`,
        });
        continue;
      }
    }

    // Try call with 20s timeout and 1 retry
    let attempt = 0;
    const maxAttempts = 2; // initial + 1 retry

    while (attempt < maxAttempts) {
      attempt++;
      const startTime = Date.now();
      try {
        const schema = candidate.name === 'gemini' ? GEMINI_RESPONSE_SCHEMA : TUTOR_JSON_SCHEMA;
        const result: ProviderCompletionResult = await executeWithTimeout(
          async () => provider.complete({ systemPrompt, userPrompt }, schema),
          timeoutMs
        );

        // Success!
        if (candidate.name === 'gemini' || candidate.name === 'groq') {
          budget.consume(candidate.name);
        }

        budget.logUsage({
          provider: candidate.name,
          model: result.model,
          tokens: result.usage,
          latencyMs: result.latencyMs,
          outcome: 'success',
        });

        // Ensure result json conforms roughly to structure
        const rawJson = JSON.stringify(result.json);
        const parsedData = result.json as Record<string, unknown>;

        return {
          success: true,
          data: {
            message: String(parsedData.message ?? ''),
            help_level_used: (Number(parsedData.help_level_used) || 0) as HelpLevel,
            question: parsedData.question ? String(parsedData.question) : null,
            needs_clarification: Boolean(parsedData.needs_clarification),
            reasoning_grade: (parsedData.reasoning_grade as any) ?? null,
            misconception_ids: Array.isArray(parsedData.misconception_ids)
              ? (parsedData.misconception_ids as string[])
              : [],
            claims: Array.isArray(parsedData.claims) ? (parsedData.claims as any[]) : [],
            confidence:
              typeof parsedData.confidence === 'number'
                ? Math.max(0, Math.min(1, parsedData.confidence))
                : 0.8,
          },
          provider: candidate.name,
          model: result.model,
          latencyMs: result.latencyMs,
          promptVersion: resolvedPrompt.version,
          rawJson,
          notice: fallbackNotice,
        };
      } catch (err: unknown) {
        const elapsed = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStatus = (err as unknown as { status?: number }).status;
        const errCode = (err as unknown as { code?: string }).code;

        budget.logUsage({
          provider: candidate.name,
          model: provider.model,
          latencyMs: elapsed,
          outcome: 'failure',
          error: errMsg,
        });

        // 429, 402, or quota/credit error -> do not retry, move immediately to next provider
        if (
          errStatus === 429 ||
          errStatus === 402 ||
          errStatus === 503 ||
          errMsg.includes('429') ||
          errMsg.includes('402') ||
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.toLowerCase().includes('quota') ||
          errMsg.toLowerCase().includes('prepayment') ||
          errMsg.toLowerCase().includes('abort') ||
          errMsg.toLowerCase().includes('timeout')
        ) {
          if (
            candidate.name === 'gemini' &&
            (errStatus === 402 ||
              errMsg.includes('402') ||
              errMsg.toLowerCase().includes('prepayment') ||
              errMsg.toLowerCase().includes('billing'))
          ) {
            fallbackNotice =
              'Gemini key is in a billing project with no credit. Make a free key in a new AI Studio project with no billing.';
          } else if (
            candidate.name === 'gemini' &&
            (errStatus === 503 || errMsg.includes('503') || errMsg.includes('UNAVAILABLE'))
          ) {
            fallbackNotice = 'Gemini temporarily unavailable; falling back to Groq.';
          } else if (candidate.name === 'gemini') {
            fallbackNotice = 'Gemini unavailable; falling back to Groq.';
          }
          lastError = `${candidate.name} unavailable/quota exhausted (${errStatus || 'error'})`;
          lastFailureKind = errStatus === 503 || errMsg.includes('503') || errMsg.includes('abort') ? 'unavailable' : 'quota';
          break; // break retry loop, next provider
        }

        if (errCode === 'OLLAMA_UNAVAILABLE' || errMsg.includes('ECONNREFUSED')) {
          lastError = !geminiKey && !groqKey ? 'No AI providers available (missing keys and Ollama offline).' : 'Ollama unavailable';
          lastFailureKind = !geminiKey && !groqKey ? 'no_ai' : 'unavailable';
          break; // next provider
        }

        // Malformed JSON repair attempt if attempt == 1
        if (errMsg.includes('invalid JSON') && attempt === 1) {
          // Attempt 1 repair attempt
          try {
            const repairPrompt = `The previous response produced malformed JSON. Return ONLY the valid JSON object conforming to the schema:\n${errMsg}`;
            const repaired = await executeWithTimeout(
              async () =>
                provider.complete({ systemPrompt, userPrompt: repairPrompt }, TUTOR_JSON_SCHEMA),
              timeoutMs
            );
            if (candidate.name === 'gemini' || candidate.name === 'groq') {
              budget.consume(candidate.name);
            }
            budget.logUsage({
              provider: candidate.name,
              model: repaired.model,
              tokens: repaired.usage,
              latencyMs: repaired.latencyMs,
              outcome: 'success',
            });
            const parsedData = repaired.json as Record<string, unknown>;
            return {
              success: true,
              data: {
                message: String(parsedData.message ?? ''),
                help_level_used: (Number(parsedData.help_level_used) || 0) as HelpLevel,
                question: parsedData.question ? String(parsedData.question) : null,
                needs_clarification: Boolean(parsedData.needs_clarification),
                reasoning_grade: (parsedData.reasoning_grade as any) ?? null,
                misconception_ids: Array.isArray(parsedData.misconception_ids)
                  ? (parsedData.misconception_ids as string[])
                  : [],
                claims: Array.isArray(parsedData.claims) ? (parsedData.claims as any[]) : [],
                confidence: typeof parsedData.confidence === 'number' ? parsedData.confidence : 0.8,
              },
              provider: candidate.name,
              model: repaired.model,
              latencyMs: repaired.latencyMs,
              promptVersion: resolvedPrompt.version,
              rawJson: JSON.stringify(repaired.json),
            };
          } catch {
            // repair failed, break to next provider
            lastError = `${candidate.name} malformed JSON repair failed`;
            lastFailureKind = 'malformed';
            break;
          }
        }

        // If timed out or general error, retry once if attempt == 1
        if (attempt < maxAttempts) {
          continue;
        }

        lastError = `${candidate.name} failed: ${errMsg}`;
        if (errMsg.toLowerCase().includes('abort') || errMsg.toLowerCase().includes('timeout')) {
          lastFailureKind = 'timeout';
        } else {
          lastFailureKind = 'network';
        }
      }
    }
  }

  return {
    success: false,
    failureKind: lastFailureKind,
    error: lastError,
    notice: fallbackNotice,
  };
}

export async function handleTutorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string>,
  options: RouterOptions = {}
): Promise<void> {
  if (req.method === 'GET') {
    // Status endpoint
    const budget = options.budgetTracker ?? new BudgetTracker();
    const geminiKey =
      env.GEMINI_API_KEY !== undefined
        ? Boolean(env.GEMINI_API_KEY)
        : Boolean(process.env.GEMINI_API_KEY);
    const groqKey =
      env.GROQ_API_KEY !== undefined
        ? Boolean(env.GROQ_API_KEY)
        : Boolean(process.env.GROQ_API_KEY);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        gemini: { configured: geminiKey, remainingToday: geminiKey ? budget.getRemaining('gemini') : 0 },
        groq: { configured: groqKey, remainingToday: groqKey ? budget.getRemaining('groq') : 0 },
        ollama: { configured: true },
      })
    );
    return;
  }

  // Read POST body
  const chunks: Buffer[] = [];
  req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

  req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const tutorReq = JSON.parse(raw) as TutorRequest;
      const result = await runTutorCompletion(tutorReq, env, options);

      res.statusCode = result.success ? 200 : 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          failureKind: 'malformed',
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });
}
