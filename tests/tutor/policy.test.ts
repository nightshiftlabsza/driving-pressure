import { describe, it, expect } from 'vitest';
import {
  classifyFatigue,
  classifyStruggle,
  computeHelpLevelCap,
  isSafetyCrisisVitals,
  tokenJaccardDistance,
  type PolicyInputs,
} from '../../src/tutor/policy';
import type { CaseFile } from '../../src/shared/caseSchema';

describe('Tutor Policy Rules (Graduated v2)', () => {
  const baseInput: PolicyInputs = {
    guidanceLevel: 'independent',
    isProbe: false,
    hasCommittedDecision: false,
    failedAttemptsCount: 0,
    hasConfidentError: false,
    isStuck: false,
    isImmediateDanger: false,
    contextKind: 'active_case',
    attemptNumberInProblem: 1,
  };

  describe('Debrief self-critique gate & surface baselines', () => {
    it('keeps debrief cap low (1) until self-critique is submitted, then unlocks cap 3', () => {
      expect(
        computeHelpLevelCap({
          ...baseInput,
          contextKind: 'debrief',
          debriefSelfCritiqueSubmitted: false,
        })
      ).toBe(1);

      expect(
        computeHelpLevelCap({
          ...baseInput,
          contextKind: 'debrief',
          debriefSelfCritiqueSubmitted: true,
        })
      ).toBe(3);
    });

    it('caps free_discussion at 2 on Turn 1 and 3 on follow-up', () => {
      expect(
        computeHelpLevelCap({ ...baseInput, contextKind: 'free_discussion', attemptNumberInProblem: 1 })
      ).toBe(2);
      expect(
        computeHelpLevelCap({ ...baseInput, contextKind: 'free_discussion', attemptNumberInProblem: 2 })
      ).toBe(3);
    });
  });

  describe('Turn 1 and removed shortcuts (Acceptance Checks)', () => {
    it('turn 1 outside danger never exceeds cap 1 even for guided + explain request', () => {
      expect(
        computeHelpLevelCap({
          ...baseInput,
          guidanceLevel: 'guided',
          attemptNumberInProblem: 1,
          learnerRequest: 'explain',
        })
      ).toBeLessThanOrEqual(1);
    });

    it('"I\'m stuck" on turn 1 stays at cap 0 or 1 (shortcut removed)', () => {
      const capIndep = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'independent',
        attemptNumberInProblem: 1,
        isStuck: true,
        learnerMessage: "I'm stuck and don't know what to do next",
      });
      expect(capIndep).toBeLessThanOrEqual(1);

      const capGuided = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'guided',
        attemptNumberInProblem: 1,
        isStuck: true,
        learnerMessage: "I'm stuck",
      });
      expect(capGuided).toBeLessThanOrEqual(1);
    });

    it('confident wrong prediction sets cap 1, not 3 (hypercorrection contrast)', () => {
      const cap = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'guided',
        attemptNumberInProblem: 3,
        failedAttemptsCount: 3,
        hasConfidentError: true,
      });
      expect(cap).toBe(1);
    });

    it('Level 3 unlocked ONLY after three failed guided attempts (not 2)', () => {
      // 2 failed guided attempts on turn 2 -> cap 2, NOT 3
      expect(
        computeHelpLevelCap({
          ...baseInput,
          guidanceLevel: 'guided',
          attemptNumberInProblem: 2,
          failedAttemptsCount: 2,
        })
      ).toBe(2);

      // 3 failed guided attempts on turn 3 -> cap 3
      expect(
        computeHelpLevelCap({
          ...baseInput,
          guidanceLevel: 'guided',
          attemptNumberInProblem: 3,
          failedAttemptsCount: 3,
        })
      ).toBe(3);

      // 3 failed prompted attempts -> max 2, not 3
      expect(
        computeHelpLevelCap({
          ...baseInput,
          guidanceLevel: 'prompted',
          attemptNumberInProblem: 3,
          failedAttemptsCount: 3,
        })
      ).toBe(2);
    });
  });

  describe('Exceptions A, B, C and TutorMode', () => {
    it('Exception A safety crisis unlocks cap 2 immediately when asking or after failed attempt', () => {
      const capByFlag = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'independent',
        isImmediateDanger: true,
        learnerMessage: 'Patient is crashing, BP is 60/40',
      });
      expect(capByFlag).toBe(2);

      const capByVitals = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'independent',
        failedAttemptsCount: 1,
        vitals: { spo2Pct: 82, dangerDurationSec: 75 },
      });
      expect(capByVitals).toBe(2);

      expect(isSafetyCrisisVitals({ spo2Pct: 82, dangerDurationSec: 30 })).toBe(false);
      expect(isSafetyCrisisVitals({ mapMmHg: 50, dangerDurationSec: 65 })).toBe(true);
      expect(isSafetyCrisisVitals({ ph: 7.05, dangerDurationSec: 65 })).toBe(true);
      expect(isSafetyCrisisVitals({ pplatCmH2O: 38, dangerDurationSec: 65 })).toBe(true);
    });

    it('Exception B unlocks cap 2 for not_seen competency after >=2 guess failures', () => {
      const cap = computeHelpLevelCap({
        ...baseInput,
        guidanceLevel: 'prompted',
        attemptNumberInProblem: 2,
        failedAttemptsCount: 2,
        competencyStatus: 'not_seen',
        consecutiveGuessFailures: 2,
      });
      expect(cap).toBe(2);
    });

    it('Exception C returns cap 0 for UI help questions', () => {
      expect(
        computeHelpLevelCap({
          ...baseInput,
          isProbe: true,
          isUiHelpQuestion: true,
          learnerMessage: 'Where is the inspiratory hold button?',
        })
      ).toBe(0);
    });

    it('Exam-Silent mode locks cap at 0 outside safety crisis', () => {
      expect(
        computeHelpLevelCap({
          ...baseInput,
          guidanceLevel: 'guided',
          tutorMode: 'exam_silent',
          attemptNumberInProblem: 3,
          failedAttemptsCount: 3,
        })
      ).toBe(0);
    });
  });

  describe('Struggle & Fatigue classifiers', () => {
    it('classifies productive struggle when revising hypothesis with maneuvers and keeps cap <= 1', () => {
      const dist = tokenJaccardDistance(
        'airway resistance high from secretions in endotracheal tube',
        'dynamic hyperinflation from prolonged expiratory time constant causing air trapping'
      );
      expect(dist).toBeGreaterThan(0.25);

      const state = classifyStruggle({
        failedAttemptsCount: 1,
        recentManeuversCount: 1,
        previousHypothesis: 'airway resistance high from secretions',
        currentHypothesis: 'dynamic hyperinflation prolonged expiratory time',
        latencyMs: 35_000,
      });
      expect(state).toBe('productive_struggle');
    });

    it('classifies unproductive wheel-spinning on repeated identical hypotheses or >=3 consecutive errors', () => {
      const state = classifyStruggle({
        failedAttemptsCount: 2,
        previousHypothesis: 'maybe stiff lungs causing high pressure',
        currentHypothesis: 'maybe stiff lungs causing high pressure',
        latencyMs: 40_000,
      });
      expect(state).toBe('unproductive_struggle');
    });

    it('detects late-night or >60min fatigue with latency spike and offers bookmark/low-bandwidth without unlocking level 3', () => {
      const fatigue = classifyFatigue({
        localTime: new Date('2026-11-10T01:40:00'),
        sessionDurationMs: 72 * 60 * 1000,
        latencyMs: 95_000,
        baselineLatencyMs: 25_000,
        currentInput: 'just tell me',
        failedAttemptsCount: 1,
      });
      expect(fatigue.fatigued).toBe(true);
      expect(fatigue.offerBookmark).toBe(true);
      expect(fatigue.offerLowBandwidth).toBe(true);
    });
  });

  describe('Case Adapter getCap with Real RunState', () => {
    it('implements probe caps, turn 1 <= 1 ceiling, and safety exception with real RunState', async () => {
      const { createCaseTutorAdapter } = await import('../../src/tutor/caseAdapter');
      const { engine } = await import('../../src/engine/index');
      const { MemoryEventSink } = await import('../../src/shared/eventSink');
      const { CaseSchema } = await import('../../src/shared/caseSchema');
      const { startRun, placeOrder, answerPrediction } = await import('../../src/runtime/caseRuntime');
      const asthmaRaw = (await import('../../src/cases/library/asthma-vent-01.json')).default;

      const caseFile = CaseSchema.parse(asthmaRaw) as CaseFile;
      const sink = new MemoryEventSink();
      const rt = { engine, sink };

      const run = await startRun(rt, caseFile, {
        sessionId: 'test-s1',
        guidance: {
          'mech.auto-peep': 'prompted',
          'circ.auto-peep-hypotension': 'prompted',
          'disease.obstructive': 'prompted',
          'modes.ie-flow-ti': 'prompted',
          'safety.crisis': 'prompted',
          'safety.reassess': 'prompted',
          'gas.acid-base': 'prompted',
        },
      });

      const adapterBeforeCommit = createCaseTutorAdapter(run, caseFile);
      expect(adapterBeforeCommit.getCap()).toBe(0);
      expect(adapterBeforeCommit.getCap('hint')).toBe(1);
      expect(adapterBeforeCommit.getCap('explain')).toBe(1);

      await placeOrder(rt, run, 'change-settings', { settings: { rrSetBpm: 14 } });
      expect(run.pendingPrediction?.id).toBe('p-asthma-mechanics');
      const adapterDuringPrediction = createCaseTutorAdapter(run, caseFile);
      expect(adapterDuringPrediction.getCap()).toBe(0);
      expect(adapterDuringPrediction.getCap('explain')).toBe(1);

      await answerPrediction(rt, run, { autoPeep: 'down', ppeak: 'down', sbp: 'up', paco2: 'up' }, 'fairly_sure');
      const adapterAfterCommit = createCaseTutorAdapter(run, caseFile);
      // Turn 1 outside danger never exceeds cap 1
      expect(adapterAfterCommit.getCap(undefined, undefined, {
        observation: 'Plateau fell',
        mechanismHypothesis: 'Trapped gas decreased',
        confidence: 'fairly_sure',
        maneuversPerformed: ['expiratory_hold'],
        attemptNumberInProblem: 1,
        latencyMs: 12000,
      })).toBe(1);

      // Turn 2 prompted unlocks cap 2
      expect(adapterAfterCommit.getCap('narrow', undefined, {
        observation: 'Plateau fell',
        mechanismHypothesis: 'Trapped gas decreased',
        confidence: 'fairly_sure',
        maneuversPerformed: ['expiratory_hold'],
        attemptNumberInProblem: 2,
        latencyMs: 12000,
      })).toBe(2);

      // Safety exception with SpO2 < 85 unlocks cap 2 even at independent guidance
      for (const c of caseFile.competencies) {
        run.guidance[c] = 'independent';
      }
      run.engine.monitored.spo2Pct = 82;
      const adapterDanger = createCaseTutorAdapter(run, caseFile);
      expect(adapterDanger.getCap()).toBe(0);
      expect(adapterDanger.getCap(undefined, 'Patient is desaturating rapidly!')).toBe(2);
      expect(adapterDanger.getCap('hint')).toBe(2);
    });
  });
});
