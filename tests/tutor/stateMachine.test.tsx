// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  canRequestSocraticTurn,
  createTutorStateMachineState,
  getMetaSocraticPrompt,
  MAX_SOCRATIC_TURNS,
  scheduleTutorDelayedRetest,
  transitionTutorEpisode,
  validateCausalReconstruction,
} from '../../src/tutor/stateMachine';
import {
  CONTRACT_ACCEPT_BUTTON_LABEL,
  CONTRACT_SECTION_TITLE,
  ContractModal,
} from '../../src/tutor/ContractModal';
import { TutorPanel } from '../../src/tutor/TutorPanel';
import { clearTutorExchanges, getContractAccepted, listDelayedRetests } from '../../src/tutor/store';
import type { StructuredLearnerAttempt, TutorResponse } from '../../src/tutor/types';

function makeAttempt(turn = 1): StructuredLearnerAttempt {
  return {
    observation: 'Peak pressure is 45 cmH2O while plateau pressure is 22 cmH2O',
    mechanismHypothesis: 'High airway resistance or secretions are obstructing the breathing circuit',
    predictedConsequence: 'Suctioning or bronchodilator will reduce peak pressure',
    confidence: 'fairly_sure',
    maneuversPerformed: ['inspiratory_hold'],
    attemptNumberInProblem: turn,
    latencyMs: 6000,
  };
}

function makeResponse(helpLevelUsed: 0 | 1 | 2 | 3, message = 'Explanation'): TutorResponse {
  return {
    message,
    help_level_used: helpLevelUsed,
    question: helpLevelUsed === 3 ? 'What happens to Pplat?' : null,
    needs_clarification: false,
    reasoning_grade: 'correct_superficial',
    misconception_ids: [],
    claims: [{ text: 'Airway resistance drives peak-to-plateau gap.', evidence_level: 'physiology' }],
    confidence: 0.9,
  };
}

describe('Tutor v2 Five-State Machine & Contract Modal (Item 6)', () => {
  const storageMap = new Map<string, string>();

  beforeEach(async () => {
    storageMap.clear();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, String(v));
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
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
    await clearTutorExchanges();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('transitions ATTEMPT -> COMMIT -> REVEAL -> RECONSTRUCT -> DELAYED_RETEST with masking and 3-turn cap', () => {
    let st = createTutorStateMachineState({
      runId: 'run-sm-1',
      problemId: 'vent-high-pressure-01',
      guidanceLevel: 'guided',
      competencyIds: ['mech.res-vs-comp'],
    });
    expect(st.state).toBe('ATTEMPT');
    expect(st.metaSocraticPrompt).not.toBeNull();
    expect(canRequestSocraticTurn(st)).toBe(true);

    // Invalid short attempt stays in ATTEMPT
    st = transitionTutorEpisode(st, {
      type: 'SUBMIT_ATTEMPT',
      attempt: { ...makeAttempt(1), observation: 'too short' },
    });
    expect(st.state).toBe('ATTEMPT');

    // Valid Turn 1 -> COMMIT
    st = transitionTutorEpisode(st, { type: 'SUBMIT_ATTEMPT', attempt: makeAttempt(1) });
    expect(st.state).toBe('COMMIT');
    st = transitionTutorEpisode(st, { type: 'RECORD_TUTOR_RESPONSE', response: makeResponse(0) });
    expect(st.state).toBe('COMMIT');
    expect(st.turnCount).toBe(1);
    expect(st.caseCompletionBlocked).toBe(false);

    // Turn 2 (Level 1)
    st = transitionTutorEpisode(st, { type: 'SUBMIT_ATTEMPT', attempt: makeAttempt(2) });
    st = transitionTutorEpisode(st, { type: 'RECORD_TUTOR_RESPONSE', response: makeResponse(1) });
    expect(st.turnCount).toBe(2);
    expect(st.caseCompletionBlocked).toBe(false);

    // Turn 3 (Level 2 teach/narrowing) -> REVEAL + caps at MAX_SOCRATIC_TURNS (3) + blocks completion
    st = transitionTutorEpisode(st, { type: 'SUBMIT_ATTEMPT', attempt: makeAttempt(3) });
    st = transitionTutorEpisode(st, { type: 'RECORD_TUTOR_RESPONSE', response: makeResponse(2) });
    expect(st.turnCount).toBe(MAX_SOCRATIC_TURNS);
    expect(canRequestSocraticTurn(st)).toBe(false);
    expect(st.state).toBe('REVEAL');
    expect(st.reconstructionRequired).toBe(true);
    expect(st.caseCompletionBlocked).toBe(true);

    // START_RECONSTRUCT -> RECONSTRUCT masks prior tutor text
    st = transitionTutorEpisode(st, { type: 'START_RECONSTRUCT' });
    expect(st.state).toBe('RECONSTRUCT');
    expect(st.maskTutorResponses).toBe(true);
    expect(st.caseCompletionBlocked).toBe(true);

    // Weak acknowledgment rejected
    st = transitionTutorEpisode(st, { type: 'SUBMIT_RECONSTRUCTION', text: 'ok got it thanks' });
    expect(st.state).toBe('RECONSTRUCT');
    expect(st.reconstructionPassed).toBe(false);
    expect(st.caseCompletionBlocked).toBe(true);

    // Valid causal synthesis -> DELAYED_RETEST (+48h) & unlocks completion
    const nowMs = Date.UTC(2026, 10, 10, 12, 0, 0);
    st = transitionTutorEpisode(st, {
      type: 'SUBMIT_RECONSTRUCTION',
      text: 'Because airway resistance is elevated, peak pressure rises while plateau pressure stays normal and lower resistance reduces peak pressure.',
      nowMs,
    });
    expect(st.state).toBe('DELAYED_RETEST');
    expect(st.reconstructionPassed).toBe(true);
    expect(st.caseCompletionBlocked).toBe(false);
    expect(st.delayedRetestDueAt).toBe(nowMs + 48 * 60 * 60 * 1000);
  });

  it('fades Meta-Socratic prompt across guided, prompted, and independent levels', () => {
    expect(getMetaSocraticPrompt('guided', 0, 'ATTEMPT')).toBeTruthy();
    expect(getMetaSocraticPrompt('prompted', 0, 'ATTEMPT')).toBeTruthy();
    expect(getMetaSocraticPrompt('independent', 0, 'ATTEMPT')).toBeNull();
    expect(getMetaSocraticPrompt('independent', 1, 'RECONSTRUCT')).toBeTruthy();
  });

  it('validates causal reconstruction quality deterministically', () => {
    expect(validateCausalReconstruction('ok')).toEqual(expect.objectContaining({ valid: false }));
    expect(
      validateCausalReconstruction(
        'Reducing respiratory rate lengthens expiratory time because trapped alveolar gas empties and total PEEP falls.'
      )
    ).toEqual({ valid: true });
  });

  it('schedules 48h DELAYED_RETEST in both tutor IndexedDB store and practice scheduler CardState', async () => {
    const nowMs = Date.UTC(2026, 10, 10, 12, 0, 0);
    let savedCards: Record<string, unknown> = {};
    const scheduled = await scheduleTutorDelayedRetest({
      competencyIds: ['mech.auto-peep'],
      caseId: 'asthma-vent-01',
      nowMs,
      getPracticeCardStates: async () => ({}),
      savePracticeCardStates: async states => {
        savedCards = states;
      },
    });

    expect(scheduled.dueAt).toBe(nowMs + 48 * 60 * 60 * 1000);
    const stored = await listDelayedRetests();
    expect(stored.some(r => r.competencyId === 'mech.auto-peep' && r.dueAt === scheduled.dueAt)).toBe(
      true
    );
    const cardKey = 'delayed-retest:asthma-vent-01:mech.auto-peep';
    expect(savedCards[cardKey]).toBeDefined();
    expect(scheduled.cardStates[cardKey].intervalDays).toBe(2);
    expect(scheduled.cardStates[cardKey].dueDate).toBe('2026-11-12');
  });

  it('ContractModal renders verbatim Section 7 wording and button label', () => {
    const onAccept = vi.fn();
    render(<ContractModal isOpen={true} onAccept={onAccept} onCancel={vi.fn()} />);

    const dialog = screen.getByTestId('tutor-contract-modal');
    expect(dialog.textContent).toContain(CONTRACT_SECTION_TITLE);
    expect(dialog.textContent).toContain('Think Before Asking');
    expect(dialog.textContent).toContain('Defend Mechanisms, Not Labels');
    expect(dialog.textContent).toContain('Calibrate Uncertainty');
    expect(dialog.textContent).toContain('Reconstruct Unaided');
    expect(dialog.textContent).toContain('Deterministic Physiological Truth');

    fireEvent.click(screen.getByRole('button', { name: CONTRACT_ACCEPT_BUTTON_LABEL }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('TutorPanel shows ContractModal once before enabling on fresh session and persists acceptance in IndexedDB, then enforces REVEAL -> RECONSTRUCT masking', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/tutor') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            provider: 'ollama',
            model: 'qwen3:8b',
            latencyMs: 50,
            promptVersion: 'v2',
            data: {
              message: 'SECRET WORKED EXPLANATION: Lengthen expiratory time to clear trapped gas.',
              help_level_used: 2,
              question: null,
              needs_clarification: false,
              reasoning_grade: 'correct_superficial',
              misconception_ids: [],
              claims: [{ text: 'Longer Te decreases auto-PEEP.', evidence_level: 'physiology' }],
              confidence: 0.9,
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          gemini: { configured: false, remainingToday: 0 },
          groq: { configured: false, remainingToday: 0 },
          ollama: { configured: true },
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const completionChanges: boolean[] = [];

    render(
      <TutorPanel
        contextKind="active_case"
        contextText="Ppeak 46, Pplat 24, Total PEEP 14 cmH2O"
        caseId="asthma-vent-01"
        competencyIds={['mech.auto-peep']}
        guidanceLevel="guided"
        helpLevelCap={2}
        onEpisodeStateChange={st => completionChanges.push(st.caseCompletionBlocked)}
      />
    );

    // Click enable on fresh session -> opens ContractModal first
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByTestId('tutor-contract-modal')).toBeDefined();

    fireEvent.click(screen.getByTestId('tutor-contract-accept-btn'));

    await waitFor(async () => {
      const acc = await getContractAccepted();
      expect(acc?.accepted).toBe(true);
    });
    expect(screen.getByTestId('tutor-panel')).toBeDefined();

    // Fill structured attempt & trigger Level 2 response
    fireEvent.change(screen.getByTestId('tutor-attempt-observation'), {
      target: { value: 'Peak pressure 46 cmH2O plateau 24 cmH2O total PEEP 14' },
    });
    fireEvent.change(screen.getByTestId('tutor-attempt-mechanism'), {
      target: { value: 'Incomplete exhalation traps air and increases intrinsic end-expiratory alveolar pressure' },
    });
    fireEvent.click(screen.getByTestId('tutor-attempt-confidence-fairly_sure'));
    fireEvent.click(screen.getByTestId('tutor-btn-narrow'));

    await waitFor(() => {
      expect(screen.getByText(/SECRET WORKED EXPLANATION/)).toBeDefined();
      expect(screen.getByTestId('tutor-state-badge').textContent).toContain('REVEAL');
      expect(completionChanges[completionChanges.length - 1]).toBe(true);
    });

    // Enter RECONSTRUCT -> masks previous explanation!
    fireEvent.click(screen.getByTestId('tutor-start-reconstruct-btn'));
    expect(screen.queryByText(/SECRET WORKED EXPLANATION/)).toBeNull();
    expect(screen.getByTestId('tutor-masked-message')).toBeDefined();
    expect(screen.getByTestId('tutor-reconstruct-panel')).toBeDefined();

    // Submit valid reconstruction -> unlocks completion & schedules 48h delayed retest
    fireEvent.change(screen.getByTestId('tutor-reconstruct-input'), {
      target: {
        value:
          'Because airway obstruction prolongs the expiratory time constant, lengthening Te empties trapped alveoli and lowers intrinsic PEEP.',
      },
    });
    fireEvent.click(screen.getByTestId('tutor-reconstruct-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('tutor-retest-scheduled')).toBeDefined();
      expect(screen.getByTestId('tutor-state-badge').textContent).toContain('DELAYED_RETEST');
      expect(completionChanges[completionChanges.length - 1]).toBe(false);
    });
  });

  it('unblocks case completion when AI Tutor is toggled off mid-case', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/tutor') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            provider: 'ollama',
            model: 'qwen3:8b',
            latencyMs: 50,
            promptVersion: 'v2',
            data: {
              message: 'SECRET WORKED EXPLANATION: Lengthen expiratory time to clear trapped gas.',
              help_level_used: 2,
              question: null,
              needs_clarification: false,
              reasoning_grade: 'correct_superficial',
              misconception_ids: [],
              claims: [{ text: 'Longer Te decreases auto-PEEP.', evidence_level: 'physiology' }],
              confidence: 0.9,
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          gemini: { configured: false, remainingToday: 0 },
          groq: { configured: false, remainingToday: 0 },
          ollama: { configured: true },
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const completionChanges: boolean[] = [];

    render(
      <TutorPanel
        contextKind="active_case"
        contextText="Ppeak 46, Pplat 24, Total PEEP 14 cmH2O"
        caseId="asthma-vent-01"
        competencyIds={['mech.auto-peep']}
        guidanceLevel="guided"
        helpLevelCap={2}
        onEpisodeStateChange={st => completionChanges.push(st.caseCompletionBlocked)}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('tutor-contract-accept-btn'));

    await waitFor(async () => {
      const acc = await getContractAccepted();
      expect(acc?.accepted).toBe(true);
    });

    fireEvent.change(screen.getByTestId('tutor-attempt-observation'), {
      target: { value: 'Peak pressure 46 cmH2O plateau 24 cmH2O total PEEP 14' },
    });
    fireEvent.change(screen.getByTestId('tutor-attempt-mechanism'), {
      target: { value: 'Incomplete exhalation traps air and increases intrinsic end-expiratory alveolar pressure' },
    });
    fireEvent.click(screen.getByTestId('tutor-attempt-confidence-fairly_sure'));
    fireEvent.click(screen.getByTestId('tutor-btn-narrow'));

    await waitFor(() => {
      expect(screen.getByTestId('tutor-state-badge').textContent).toContain('REVEAL');
      expect(completionChanges[completionChanges.length - 1]).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /Turn off/i }));

    await waitFor(() => {
      expect(completionChanges[completionChanges.length - 1]).toBe(false);
    });
  });
});
