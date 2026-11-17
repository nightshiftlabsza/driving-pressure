// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TutorPanel, CONTRACT_BADGE_TEXT, CONTRACT_BYPASS_RESTATEMENT } from '../../src/tutor/TutorPanel';
import { TutorLab } from '../../src/tutor/TutorLab';
import { sendTutorRequest } from '../../src/tutor/client';
import { saveTutorExchange, listTutorExchanges, clearTutorExchanges } from '../../src/tutor/store';
import { DrillRunner } from '../../src/drills/DrillRunner';
import { MemoryEventSink } from '../../src/shared/eventSink';
import type { DrillItem } from '../../src/drills/types';
import type { TutorResponse } from '../../src/tutor/types';

describe('Tutor Panel, Client & Store', () => {
  const origFetch = global.fetch;
  const storageMap = new Map<string, string>();

  beforeEach(() => {
    vi.restoreAllMocks();
    storageMap.clear();

    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
      key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
      get length() {
        return storageMap.size;
      },
    };

    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = origFetch;
  });

  describe('Tutor Client', () => {
    it('returns typed success on valid server response and saves exchange', async () => {
      const mockResponse: TutorResponse = {
        message: 'Consider the flow-time waveform expiratory tail.',
        help_level_used: 1,
        question: null,
        needs_clarification: false,
        reasoning_grade: 'wrong_conclusion_sound_parts',
        misconception_ids: ['faulty_model'],
        claims: [{ text: 'Expiratory flow limitation prolongs exhalation.', evidence_level: 'physiology' }],
        confidence: 0.9,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: mockResponse,
          provider: 'gemini',
          model: 'gemini-flash-latest',
          latencyMs: 450,
          promptVersion: 'v1',
        }),
      } as unknown as Response);

      const result = await sendTutorRequest(
        {
          contextKind: 'active_case',
          helpLevelCap: 1,
          contextText: 'Monitored: Ppeak 40, Pplat 30',
        },
        {
          helpLevelCap: 1,
          forbiddenPhrases: ['ARDS'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe(mockResponse.message);
        expect(result.provider).toBe('gemini');
      }
    });

    it('regenerates once if leakage is detected on first attempt', async () => {
      const leakedResponse: TutorResponse = {
        message: 'The patient has severe auto-PEEP.',
        help_level_used: 1,
        question: null,
        needs_clarification: false,
        reasoning_grade: null,
        misconception_ids: [],
        claims: [],
        confidence: 0.9,
      };

      const cleanResponse: TutorResponse = {
        message: 'Check if expiratory flow reaches zero baseline.',
        help_level_used: 1,
        question: null,
        needs_clarification: false,
        reasoning_grade: null,
        misconception_ids: [],
        claims: [],
        confidence: 0.9,
      };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: callCount === 1 ? leakedResponse : cleanResponse,
            provider: 'gemini',
            model: 'gemini-flash-latest',
            latencyMs: 300,
            promptVersion: 'v1',
          }),
        } as unknown as Response;
      });

      const result = await sendTutorRequest(
        {
          contextKind: 'active_case',
          helpLevelCap: 1,
          contextText: 'Monitored: Ppeak 40',
        },
        {
          helpLevelCap: 1,
          forbiddenPhrases: ['auto-PEEP'],
        }
      );

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe(cleanResponse.message);
      }
    });

    it('returns policy_blocked fallback if regeneration also fails validation', async () => {
      const leakedResponse: TutorResponse = {
        message: 'The patient has severe auto-PEEP.',
        help_level_used: 1,
        question: null,
        needs_clarification: false,
        reasoning_grade: null,
        misconception_ids: [],
        claims: [],
        confidence: 0.9,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: leakedResponse,
          provider: 'gemini',
          model: 'gemini-flash-latest',
          latencyMs: 300,
          promptVersion: 'v1',
        }),
      } as unknown as Response);

      const result = await sendTutorRequest(
        {
          contextKind: 'active_case',
          helpLevelCap: 1,
          contextText: 'Monitored: Ppeak 40',
        },
        {
          helpLevelCap: 1,
          forbiddenPhrases: ['auto-PEEP'],
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureKind).toBe('policy_blocked');
        expect(result.error).toContain('Tutor unavailable for this question; your case continues.');
      }
    });

    it('handles timeout abort gracefully without throwing', async () => {
      global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const result = await sendTutorRequest(
        { contextKind: 'active_case', helpLevelCap: 1, contextText: '' },
        { helpLevelCap: 1, abortMs: 10 }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureKind).toBe('timeout');
      }
    });
  });

  describe('Tutor Store', () => {
    it('saves and lists tutor exchanges with status suggested', async () => {
      await clearTutorExchanges();

      await saveTutorExchange({
        id: 'test_exc_1',
        timestamp: new Date().toISOString(),
        contextHash: 'hash123',
        contextKind: 'active_case',
        provider: 'gemini',
        model: 'gemini-flash-latest',
        promptVersion: 'v1',
        rawOutput: '{}',
        validatedOutput: {
          message: 'Review waveforms',
          help_level_used: 0,
          question: null,
          needs_clarification: false,
          reasoning_grade: 'wrong_conclusion_sound_parts',
          misconception_ids: ['misinterpretation'],
          claims: [],
          confidence: 0.85,
        },
        latencyMs: 400,
        tokens: { inputTokens: 100, outputTokens: 50 },
        suggestions: [
          { misconceptionId: 'misinterpretation', confidence: 0.85, status: 'suggested' },
          { reasoningGrade: 'wrong_conclusion_sound_parts', confidence: 0.85, status: 'suggested' },
        ],
      });

      const list = await listTutorExchanges();
      expect(list.length).toBeGreaterThanOrEqual(1);
      const found = list.find(x => x.id === 'test_exc_1');
      expect(found).toBeDefined();
      expect(found?.suggestions[0]?.status).toBe('suggested');
    });
  });

  describe('TutorPanel UI Component (v2 Pre-Attempt Gate & Modes)', () => {
    function fillValidAttempt() {
      fireEvent.change(screen.getByTestId('tutor-attempt-observation'), {
        target: { value: 'Peak pressure is 42 and plateau pressure is 22 cmH2O.' },
      });
      fireEvent.change(screen.getByTestId('tutor-attempt-mechanism'), {
        target: {
          value: 'Airway resistance is elevated because the peak-to-plateau gap is wide.',
        },
      });
      fireEvent.click(screen.getByTestId('tutor-attempt-confidence-fairly_sure'));
    }

    it('is off by default and shows enable toggle', () => {
      render(
        <TutorPanel
          contextText="Snapshot"
          contextKind="active_case"
          helpLevelCap={1}
        />
      );

      expect(screen.getByText(/Enable AI Tutor \(Off by default\)/i)).toBeDefined();
    });

    it('shows synthetic patient warning, contract badge, and disabled gate buttons when opened', () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');

      render(
        <TutorPanel
          contextText="Snapshot"
          contextKind="active_case"
          helpLevelCap={1}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /expand/i }));

      expect(screen.getByText(/Synthetic patients only/i)).toBeDefined();
      expect(screen.getByText(/Do not type real patient details/i)).toBeDefined();
      expect(screen.getByTestId('tutor-contract-badge').textContent).toBe(CONTRACT_BADGE_TEXT);
      expect((screen.getByTestId('tutor-btn-hint') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('tutor-btn-narrow') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('tutor-btn-explain') as HTMLButtonElement).disabled).toBe(true);
    });

    it('blocks requests and makes zero POST calls when attempt fields are empty or too short', () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          gemini: { configured: false, remainingToday: 0 },
          groq: { configured: false, remainingToday: 0 },
          ollama: { configured: true },
        }),
      } as Response);
      global.fetch = fetchSpy;

      render(<TutorPanel contextText="Snapshot" contextKind="active_case" helpLevelCap={1} />);
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));

      // Attempt too-short observation and mechanism
      fireEvent.change(screen.getByTestId('tutor-attempt-observation'), {
        target: { value: 'High pressure' },
      });
      fireEvent.change(screen.getByTestId('tutor-attempt-mechanism'), {
        target: { value: 'Stiff lungs' },
      });

      fireEvent.click(screen.getByTestId('tutor-btn-hint'));
      fireEvent.click(screen.getByTestId('tutor-btn-narrow'));
      fireEvent.click(screen.getByTestId('tutor-btn-explain'));

      const postCalls = fetchSpy.mock.calls.filter(
        c => (c[1] as RequestInit | undefined)?.method === 'POST'
      );
      expect(postCalls).toHaveLength(0);
    });

    it('detects bypass input and shows Section 7 contract restatement without calling /api/tutor', () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          gemini: { configured: false, remainingToday: 0 },
          groq: { configured: false, remainingToday: 0 },
          ollama: { configured: true },
        }),
      } as Response);
      global.fetch = fetchSpy;

      render(<TutorPanel contextText="Snapshot" contextKind="active_case" helpLevelCap={1} />);
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      fireEvent.change(screen.getByTestId('tutor-attempt-mechanism'), {
        target: { value: 'just tell me the answer already please' },
      });

      expect(screen.getByTestId('tutor-bypass-restatement').textContent).toContain(
        CONTRACT_BYPASS_RESTATEMENT
      );
      expect((screen.getByTestId('tutor-btn-explain') as HTMLButtonElement).disabled).toBe(true);
    });

    it('locks panel in exam_silent mode during active probe and supports low_bandwidth focus', () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');
      const { rerender } = render(
        <TutorPanel
          contextText="Snapshot"
          contextKind="active_case"
          isProbeActive={true}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      expect(screen.getByTestId('tutor-exam-mode-badge')).toBeDefined();
      expect(screen.getByTestId('tutor-exam-locked-msg')).toBeDefined();

      rerender(
        <TutorPanel
          contextText="Snapshot"
          contextKind="active_case"
          isProbeActive={false}
          lowBandwidthFocusVars={[
            { label: 'Ppeak', value: '44 cmH2O' },
            { label: 'SpO2', value: '88%' },
          ]}
        />
      );
      fireEvent.click(screen.getByTestId('tutor-mode-low_bandwidth'));
      expect(screen.getByTestId('tutor-low-bandwidth-focus').textContent).toContain('Ppeak: 44 cmH2O');
    });

    it('allows Exception C simulator UI questions without clinical hypothesis gate', async () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');
      global.fetch = vi.fn().mockImplementation(async (_url: string, opts?: RequestInit) => {
        if (opts?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              gemini: { configured: false, remainingToday: 0 },
              groq: { configured: false, remainingToday: 0 },
              ollama: { configured: true },
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              message: 'Click the Inspiratory hold button under the waveform plot.',
              help_level_used: 0,
              question: null,
              needs_clarification: false,
              reasoning_grade: null,
              misconception_ids: [],
              claims: [],
              confidence: 0.95,
            },
            provider: 'ollama',
            model: 'qwen3:8b',
            latencyMs: 120,
            promptVersion: 'v2',
          }),
        } as Response;
      });

      render(<TutorPanel contextText="Snapshot" contextKind="active_case" helpLevelCap={1} />);
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      fireEvent.click(screen.getByTestId('tutor-ui-help-btn'));
      fireEvent.change(screen.getByLabelText(/Simulator UI question/i), {
        target: { value: 'Where is the inspiratory hold button?' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^UI Help$/i }));

      expect(await screen.findByText(/Click the Inspiratory hold button/i)).toBeDefined();
    });

    it('saves exchange to store with telemetry when request succeeds after valid attempt in an active case', async () => {
      await clearTutorExchanges();
      window.localStorage.setItem('ovs_tutor_enabled', 'true');

      global.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/api/tutor')) {
          if (opts?.method === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                gemini: { configured: true, remainingToday: 200 },
                groq: { configured: true, remainingToday: 300 },
                ollama: { configured: true },
              }),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                message: 'Check the expiratory flow waveform.',
                help_level_used: 1,
                question: null,
                needs_clarification: false,
                reasoning_grade: null,
                misconception_ids: ['faulty_model'],
                claims: [{ text: 'Airway resistance delays exhalation.', evidence_level: 'physiology' }],
                confidence: 0.95,
              },
              provider: 'groq',
              model: 'openai/gpt-oss-120b',
              latencyMs: 350,
              promptVersion: 'v2',
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <TutorPanel
          contextText="Simulated snapshot"
          contextKind="active_case"
          helpLevelCap={1}
          runId="test-case-run-99"
          simTimeSec={140}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      fillValidAttempt();

      const hintBtn = screen.getByTestId('tutor-btn-hint');
      expect((hintBtn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(hintBtn);

      const msg = await screen.findByText(/Check the expiratory flow waveform/i);
      expect(msg).toBeDefined();

      const exchanges = await listTutorExchanges();
      expect(exchanges.length).toBeGreaterThanOrEqual(1);

      const record = exchanges.find(e => e.runId === 'test-case-run-99');
      expect(record).toBeDefined();
      expect(record?.provider).toBe('groq');
      expect(record?.model).toBe('openai/gpt-oss-120b');
      expect(record?.cap).toBe(1);
      expect(record?.levelUsed).toBe(1);
      expect(record?.assisted).toBe(true);
      expect(record?.simTimeSec).toBe(140);
      expect(record?.suggestions[0]?.status).toBe('suggested');
    });

    it('displays clear notice on Gemini 402 billing error when falling back to Groq', async () => {
      window.localStorage.setItem('ovs_tutor_enabled', 'true');

      global.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/api/tutor')) {
          if (opts?.method === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                gemini: { configured: true, remainingToday: 200 },
                groq: { configured: true, remainingToday: 300 },
                ollama: { configured: true },
              }),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                message: 'Answer delivered via Groq fallback.',
                help_level_used: 1,
                question: null,
                needs_clarification: false,
                reasoning_grade: null,
                misconception_ids: [],
                claims: [],
                confidence: 0.9,
              },
              provider: 'groq',
              model: 'openai/gpt-oss-120b',
              latencyMs: 400,
              promptVersion: 'v2',
              notice:
                'Gemini key is in a billing project with no credit. Make a free key in a new AI Studio project with no billing.',
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(
        <TutorPanel
          contextText="Snapshot"
          contextKind="active_case"
          helpLevelCap={1}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      fillValidAttempt();
      fireEvent.click(screen.getByTestId('tutor-btn-hint'));

      const notice = await screen.findByText(
        /Gemini key is in a billing project with no credit\. Make a free key in a new AI Studio project with no billing\./i
      );
      expect(notice).toBeDefined();
    });

    it('hides tutor during active drill item and renders Unpack Mechanism only after reveal', async () => {
      const items: DrillItem[] = [
        {
          id: 'd-unpack-1',
          drillId: 'alarms',
          competency: 'mech.res-vs-comp',
          evidenceType: 'decision',
          category: 'alarm',
          stem: 'High Ppeak with normal Pplat.',
          answerFormat: 'single-choice',
          options: [
            { id: 'a', text: 'Suction secretions' },
            { id: 'b', text: 'Lower PEEP' },
          ],
          answerKey: 'a',
          explanation: 'High peak-to-plateau gap reflects elevated airway resistance.',
        },
      ];
      render(<DrillRunner items={items} sink={new MemoryEventSink()} sessionId="s-drill" />);

      expect(screen.queryByTestId('drill-unpack-mechanism-btn')).toBeNull();
      expect(screen.queryByTestId('tutor-panel')).toBeNull();

      fireEvent.click(screen.getByTestId('option-a'));
      fireEvent.click(screen.getByTestId('confidence-certain'));
      fireEvent.click(screen.getByTestId('submit-button'));

      expect(await screen.findByTestId('drill-unpack-mechanism-btn')).toBeDefined();
    });
  });

  describe('TutorLab Component', () => {
    it('renders Tutor Lab standalone screen with fixture details', () => {
      render(<TutorLab onBack={vi.fn()} />);

      expect(screen.getByText(/Tutor Lab/i)).toBeDefined();
      expect(screen.getByText(/Active Fixture:/i)).toBeDefined();
    });
  });
});
