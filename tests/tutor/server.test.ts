import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../../server/tutor/providers/gemini';
import { GroqProvider } from '../../server/tutor/providers/groq';
import { OllamaProvider } from '../../server/tutor/providers/ollama';
import { BudgetTracker } from '../../server/tutor/budget';
import {
  runTutorCompletion,
  resolvePromptFile,
  selectOllamaModel,
} from '../../server/tutor/router';
import type { TutorRequest } from '../../src/tutor/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

const testDir = path.resolve(os.tmpdir(), `ovs-tutor-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

describe('Server Providers & Router (Mocked Fetch)', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  describe('GeminiProvider', () => {
    it('sends key in x-goog-api-key header, never in URL', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      global.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = (init.headers as Record<string, string>) || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ message: 'Focus on peak pressure', help_level_used: 0, question: null, needs_clarification: false, reasoning_grade: null, misconception_ids: [], claims: [], confidence: 0.9 }) }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30 },
          }),
        } as unknown as Response;
      });

      const gemini = new GeminiProvider('secret-gemini-key');
      const result = await gemini.complete({
        systemPrompt: 'System instruction',
        userPrompt: 'What should I do?',
      });

      expect(capturedUrl).not.toContain('secret-gemini-key');
      expect(capturedHeaders['x-goog-api-key']).toBe('secret-gemini-key');
      expect((result.json as any).message).toBe('Focus on peak pressure');
      expect(result.usage.inputTokens).toBe(50);
      expect(result.usage.outputTokens).toBe(30);
      expect(result.model).toBe('gemini-flash-latest');
    });

    it('throws with status on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Quota exceeded',
      } as unknown as Response);

      const gemini = new GeminiProvider('secret-key');
      await expect(
        gemini.complete({ systemPrompt: 'Sys', userPrompt: 'User' })
      ).rejects.toThrow('Gemini request failed (429)');
    });
  });

  describe('GroqProvider', () => {
    it('refuses requests with estimated input tokens > 6000 without calling fetch', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const groq = new GroqProvider('secret-groq-key');
      // Create a large text > 24000 chars (> 6000 tokens)
      const bigText = 'a'.repeat(25000);

      await expect(
        groq.complete({ systemPrompt: 'System', userPrompt: bigText })
      ).rejects.toThrow(/Groq token limit/);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends Bearer token and json_object response format', async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any;

      global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedHeaders = (init.headers as Record<string, string>) || {};
        capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({ message: 'Examine resistance', help_level_used: 1, question: null, needs_clarification: false, reasoning_grade: null, misconception_ids: [], claims: [], confidence: 0.85 }),
                },
              },
            ],
            usage: { prompt_tokens: 60, completion_tokens: 40 },
          }),
        } as unknown as Response;
      });

      const groq = new GroqProvider('secret-groq-key');
      const result = await groq.complete({ systemPrompt: 'Sys', userPrompt: 'User' });

      expect(capturedHeaders['Authorization']).toBe('Bearer secret-groq-key');
      expect(capturedBody.response_format).toEqual({ type: 'json_object' });
      expect((result.json as any).message).toBe('Examine resistance');
      expect(result.usage.inputTokens).toBe(60);
      expect(result.model).toBe('openai/gpt-oss-120b');
    });
  });

  describe('OllamaProvider', () => {
    it('returns unavailable if fetch fails and does not crash', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const ollama = new OllamaProvider('qwen3:8b');
      await expect(
        ollama.complete({ systemPrompt: 'Sys', userPrompt: 'User' })
      ).rejects.toThrow(/Ollama unavailable/);
    });

    it('returns json and latency on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'qwen3:8b',
          message: {
            content: JSON.stringify({ message: 'Check auto-PEEP', help_level_used: 1, question: null, needs_clarification: false, reasoning_grade: null, misconception_ids: [], claims: [], confidence: 0.9 }),
          },
          prompt_eval_count: 70,
          eval_count: 35,
        }),
      } as unknown as Response);

      const ollama = new OllamaProvider('qwen3:8b');
      const result = await ollama.complete({ systemPrompt: 'Sys', userPrompt: 'User' });

      expect((result.json as any).message).toBe('Check auto-PEEP');
      expect(result.usage.inputTokens).toBe(70);
      expect(result.model).toBe('qwen3:8b');
    });
  });

  describe('BudgetTracker', () => {
    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('tracks limits and consumes budget correctly', () => {
      const budget = new BudgetTracker({
        dataDir: testDir,
        geminiDailyLimit: 2,
        groqDailyLimit: 3,
      });

      expect(budget.hasBudget('gemini')).toBe(true);
      expect(budget.getRemaining('gemini')).toBe(2);

      budget.consume('gemini');
      expect(budget.getRemaining('gemini')).toBe(1);

      budget.consume('gemini');
      expect(budget.hasBudget('gemini')).toBe(false);
      expect(budget.getRemaining('gemini')).toBe(0);
    });

    it('logs usage without sensitive keys or prompts', () => {
      const budget = new BudgetTracker({ dataDir: testDir });
      budget.logUsage({
        provider: 'gemini',
        model: 'gemini-flash-latest',
        tokens: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 320,
        outcome: 'success',
      });

      const logPath = path.join(testDir, 'usage.jsonl');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.provider).toBe('gemini');
      expect(parsed.tokens.inputTokens).toBe(100);
      expect(parsed.tokens.outputTokens).toBe(50);
      expect(parsed).not.toHaveProperty('apiKey');
      expect(parsed).not.toHaveProperty('prompt');
    });
  });

  describe('Router fallback sequence', () => {
    const sampleReq: TutorRequest = {
      contextKind: 'active_case',
      helpLevelCap: 1,
      contextText: 'PaO2: 60, SpO2: 88, Ppeak: 35',
      learnerMessage: 'Patient is hypoxemic',
    };

    it('falls back from Gemini (429) to Groq', async () => {
      const budget = new BudgetTracker({ dataDir: testDir });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return {
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
          } as unknown as Response;
        }
        if (url.includes('api.groq.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      message: 'Check compliance vs resistance',
                      help_level_used: 1,
                      question: null,
                      needs_clarification: false,
                      reasoning_grade: null,
                      misconception_ids: [],
                      claims: [],
                      confidence: 0.9,
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 25 },
            }),
          } as unknown as Response;
        }
        throw new Error('Unexpected URL ' + url);
      });

      const env = {
        GEMINI_API_KEY: 'mock-gemini-key',
        GROQ_API_KEY: 'mock-groq-key',
      };

      const result = await runTutorCompletion(sampleReq, env, { budgetTracker: budget });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe('groq');
        expect(result.data.message).toBe('Check compliance vs resistance');
      }
    });

    it('falls back from Gemini (402 billing error) to Groq and includes clear notice', async () => {
      const budget = new BudgetTracker({ dataDir: testDir });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return {
            ok: false,
            status: 402,
            text: async () => 'Your prepayment credits are depleted',
          } as unknown as Response;
        }
        if (url.includes('api.groq.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      message: 'Groq fallback response',
                      help_level_used: 1,
                      question: null,
                      needs_clarification: false,
                      reasoning_grade: null,
                      misconception_ids: [],
                      claims: [],
                      confidence: 0.9,
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 25 },
            }),
          } as unknown as Response;
        }
        throw new Error('Unexpected URL ' + url);
      });

      const env = {
        GEMINI_API_KEY: 'mock-gemini-key',
        GROQ_API_KEY: 'mock-groq-key',
      };

      const result = await runTutorCompletion(sampleReq, env, { budgetTracker: budget });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe('groq');
        expect(result.data.message).toBe('Groq fallback response');
        expect(result.notice).toContain('Gemini key is in a billing project with no credit. Make a free key in a new AI Studio project with no billing.');
      }
    });

    it('falls back to Ollama when Gemini and Groq fail or have no keys', async () => {
      const budget = new BudgetTracker({ dataDir: testDir });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('localhost:11434')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model: 'qwen3:8b',
              message: {
                content: JSON.stringify({
                  message: 'Ollama local advice',
                  help_level_used: 0,
                  question: null,
                  needs_clarification: false,
                  reasoning_grade: null,
                  misconception_ids: [],
                  claims: [],
                  confidence: 0.8,
                }),
              },
              prompt_eval_count: 40,
              eval_count: 20,
            }),
          } as unknown as Response;
        }
        throw new Error('No internet');
      });

      const env = {}; // No keys
      const result = await runTutorCompletion(sampleReq, env, { budgetTracker: budget });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe('ollama');
        expect(result.data.message).toBe('Ollama local advice');
      }
    });

    it('returns failureKind no_ai / unavailable when all providers fail', async () => {
      const budget = new BudgetTracker({ dataDir: testDir });

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error / ECONNREFUSED'));

      const env = {};
      const result = await runTutorCompletion(sampleReq, env, { budgetTracker: budget });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(['unavailable', 'no_ai', 'network']).toContain(result.failureKind);
      }
    });

    it('routes Tutor v2 prompt by default, keeps tutor-v1 intact, sends keep_alive 30m, and supports dual Ollama model routing', async () => {
      const savedVer = process.env.TUTOR_PROMPT_VERSION;
      try {
        delete process.env.TUTOR_PROMPT_VERSION;
        expect(resolvePromptFile('v2').path).toMatch(/prompts[\\/]tutor-v3\.md$/);
        expect(resolvePromptFile('v2').version).toBe('v3');
        process.env.TUTOR_PROMPT_VERSION = 'v2';
        expect(resolvePromptFile('v2').path).toMatch(/prompts[\\/]tutor-v2\.md$/);
        expect(resolvePromptFile('v2').version).toBe('v2');
      } finally {
        if (savedVer === undefined) delete process.env.TUTOR_PROMPT_VERSION;
        else process.env.TUTOR_PROMPT_VERSION = savedVer;
      }
      expect(resolvePromptFile('v1').path).toMatch(/prompts[\\/]tutor-v1\.md$/);
      expect(fs.existsSync(path.resolve(process.cwd(), 'prompts/tutor-v1.md'))).toBe(true);
      expect(fs.existsSync(path.resolve(process.cwd(), 'prompts/tutor-v2.md'))).toBe(true);

      expect(
        selectOllamaModel('active_case', {
          OLLAMA_MODEL: 'qwen3:8b',
          OLLAMA_DEBRIEF_MODEL: 'qwen3:14b',
        })
      ).toBe('qwen3:8b');
      expect(
        selectOllamaModel('debrief', {
          OLLAMA_MODEL: 'qwen3:8b',
          OLLAMA_DEBRIEF_MODEL: 'qwen3:14b',
        })
      ).toBe('qwen3:14b');

      const budget = new BudgetTracker({ dataDir: testDir });
      type CapturedChatBody = {
        model?: string;
        keep_alive?: string;
        messages?: Array<{ role: string; content: string }>;
      };
      let capturedBody: CapturedChatBody | null = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('11434/api/chat')) {
          const parsed = JSON.parse(String(init?.body ?? '{}')) as CapturedChatBody;
          capturedBody = parsed;
          return {
            ok: true,
            json: async () => ({
              model: parsed.model ?? 'qwen3:14b',
              message: {
                content: JSON.stringify({
                  message: 'Verified reasoning review.',
                  help_level_used: 2,
                  question: 'What happens to Pplat?',
                  needs_clarification: false,
                  reasoning_grade: 'correct_superficial',
                  misconception_ids: [],
                  claims: [{ text: 'Reducing Vt lowers Pplat.', evidence_level: 'physiology' }],
                  confidence: 0.9,
                }),
              },
            }),
          } as unknown as Response;
        }
        throw new Error('Unexpected fetch');
      });

      const v2Req: TutorRequest = {
        contextKind: 'debrief',
        helpLevelCap: 2,
        contextText: 'ARDS case summary',
        promptVersion: 'v2',
        tutorMode: 'coaching',
        derivedIndicesSummary: '- Driving Pressure (Delta_P): 17 cmH2O',
        unaccountedAbnormalities: ['Severe hypoxaemia with P/F 95 mmHg'],
        ragPearls: ['[disease.ards | ESICM 2023] Keep Delta_P < 15 cmH2O.', 'Pearl 2', 'Pearl 3 ignored'],
        learnerAttempt: {
          observation: 'Pplat is 32 and PEEP is 15',
          mechanismHypothesis: 'Alveolar overdistension from excessive tidal volume',
          predictedConsequence: 'Pplat drops when Vt reduced',
          confidence: 'fairly_sure',
          maneuversPerformed: ['inspiratory_hold'],
          attemptNumberInProblem: 1,
          latencyMs: 5000,
        },
      };

      const res = await runTutorCompletion(
        v2Req,
        { OLLAMA_MODEL: 'qwen3:8b', OLLAMA_DEBRIEF_MODEL: 'qwen3:14b' },
        { budgetTracker: budget }
      );
      expect(res.success).toBe(true);
      const sentBody = capturedBody as CapturedChatBody | null;
      expect(sentBody?.model).toBe('qwen3:14b');
      expect(sentBody?.keep_alive).toBe('30m');
      const userMsg = sentBody?.messages?.find(m => m.role === 'user')?.content ?? '';
      expect(userMsg).toContain('Driving Pressure (Delta_P): 17 cmH2O');
      expect(userMsg).toContain('Local reference teaching pearls');
      expect(userMsg).not.toContain('Pearl 3 ignored');
      if (res.success) {
        expect(res.promptVersion).toBe('v3');
      }
    });

    it('includes the tutor previous replies in the history block, cuts long ones to 500 chars, and adds the build-on instruction', async () => {
      const budget = new BudgetTracker({ dataDir: testDir });
      let capturedUser = '';
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('11434/api/chat')) {
          const parsed = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role: string; content: string }>;
          };
          capturedUser = parsed.messages?.find(m => m.role === 'user')?.content ?? '';
          return {
            ok: true,
            json: async () => ({
              model: 'qwen3:8b',
              message: {
                content: JSON.stringify({
                  message: 'ok',
                  help_level_used: 1,
                  question: null,
                  needs_clarification: false,
                  reasoning_grade: null,
                  misconception_ids: [],
                  claims: [],
                  confidence: 0.9,
                }),
              },
            }),
          } as unknown as Response;
        }
        throw new Error('Unexpected fetch');
      });

      const attempt = (observation: string) => ({
        observation,
        mechanismHypothesis: 'mech text',
        predictedConsequence: 'pred',
        confidence: 'fairly_sure' as const,
        maneuversPerformed: [],
        attemptNumberInProblem: 1,
        latencyMs: 1000,
      });
      const longReply = 'L'.repeat(900);
      const req: TutorRequest = {
        contextKind: 'active_case',
        helpLevelCap: 1,
        contextText: 'PaO2: 60',
        learnerMessage: 'follow up',
        history: [
          {
            turnIndex: 1,
            learnerAttempt: attempt('obs one'),
            tutorMessage: 'First tutor reply about compliance.',
            helpLevelUsed: 1,
            reasoningGrade: null,
          },
          {
            turnIndex: 2,
            learnerAttempt: attempt('obs two'),
            tutorMessage: longReply,
            helpLevelUsed: 2,
            reasoningGrade: null,
          },
        ],
      };

      const res = await runTutorCompletion(req, { OLLAMA_MODEL: 'qwen3:8b' }, { budgetTracker: budget });
      expect(res.success).toBe(true);
      expect(capturedUser).toContain('Turn 1 learner: obs="obs one" mech="mech text"');
      expect(capturedUser).toContain('Turn 1 tutor (level 1): "First tutor reply about compliance."');
      expect(capturedUser).toContain(`Turn 2 tutor (level 2): "${'L'.repeat(500)}..."`);
      expect(capturedUser).not.toContain('L'.repeat(501));
      expect(capturedUser).toContain(
        'Build on your previous turn. Do not repeat a question you already asked. If the learner answered it, respond to their answer.'
      );
    });
  });
});
