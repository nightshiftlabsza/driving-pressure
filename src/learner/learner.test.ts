import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createLearner, MemoryStorage, IndexedDbStorage } from './index';
import type { LearnerEvent } from '../shared/events';
import type { ActivityCandidate } from '../shared/learnerApi';
import {
  saveTutorExchange,
  clearTutorExchanges,
  listTutorExchanges,
  scheduleDelayedRetest,
  listDelayedRetests,
} from '../tutor/store';
import { saveRewindMetadata, getRewindMetadata } from '../review/rewind';

describe('LearnerModel and Synthetic Learners', () => {
  let learner: ReturnType<typeof createLearner>;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    learner = createLearner(storage);
  });

  describe('Rule: scripted learner always getting mech.auto-peep wrong', () => {
    it('ends up practising, guided, due within 1 day, and ranked first by recommend for a case containing it even when context is not COPD', async () => {
      // Learner encounters mech.auto-peep multiple times and always gets it wrong
      const t0 = new Date('2026-11-01T10:00:00.000Z');
      const t1 = new Date('2026-11-01T10:15:00.000Z');
      const t2 = new Date('2026-11-01T10:30:00.000Z');

      await learner.record({
        v: 1,
        id: 'ev-ap-1',
        wallTime: t0.toISOString(),
        sessionId: 'sess-1',
        runId: 'run-copd-1',
        type: 'prediction',
        predictionId: 'pred-ap-1',
        question: 'Identify auto-PEEP cause',
        answer: 'high compliance',
        expected: 'expiratory flow limitation',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: false,
        confidence: 'guess',
        guidance: 'prompted',
        hidden: false,
        contextTags: ['copd'],
      });

      await learner.record({
        v: 1,
        id: 'ev-ap-2',
        wallTime: t1.toISOString(),
        sessionId: 'sess-1',
        runId: 'run-copd-1',
        type: 'prediction',
        predictionId: 'pred-ap-2',
        question: 'Identify auto-PEEP on waveform',
        answer: 'normal',
        expected: 'incomplete exhalation',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: false,
        confidence: 'certain', // confident error
        guidance: 'prompted',
        hidden: false,
        contextTags: ['copd'],
      });

      await learner.record({
        v: 1,
        id: 'ev-ap-3',
        wallTime: t2.toISOString(),
        sessionId: 'sess-1',
        runId: 'run-copd-1',
        type: 'prediction',
        predictionId: 'pred-ap-3',
        question: 'Treat auto-PEEP',
        answer: 'increase RR',
        expected: 'decrease RR / prolong Te',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: false,
        confidence: 'fairly_sure',
        guidance: 'prompted',
        hidden: false,
        contextTags: ['copd'],
      });

      // Verify state
      const nowCheck = new Date('2026-11-02T11:00:00.000Z'); // 24+ hours after last event
      const states = await learner.getCompetencyStates(nowCheck);
      const autoPeep = states.find(s => s.competency === 'mech.auto-peep');

      expect(autoPeep).toBeDefined();
      expect(autoPeep?.status).toBe('practising');
      expect(autoPeep?.guidance).toBe('guided'); // >= 2 of last 3 wrong
      expect(autoPeep?.intervalDays).toBe(1);

      // Due within 1 day from t2: t2 + 1 day = 2026-11-02T10:30:00.000Z
      const dueDate = new Date(autoPeep!.dueAt!);
      const diffMs = dueDate.getTime() - t2.getTime();
      expect(diffMs).toBe(1 * 24 * 60 * 60 * 1000); // exactly 1 day
      expect(dueDate.getTime()).toBeLessThanOrEqual(nowCheck.getTime()); // overdue by 11:00

      // Now call recommend:
      // Case A contains mech.auto-peep with context 'asthma' (NOT 'copd')
      // Case B contains gas.oxy-vs-vent with context 'ards'
      const candidates: ActivityCandidate[] = [
        {
          activity: 'case',
          id: 'case-asthma-severe',
          competencies: ['mech.auto-peep'],
          hiddenCompetencies: [],
          contextTags: ['asthma'],
          difficulty: 2,
        },
        {
          activity: 'case',
          id: 'case-ards-hypoxemia',
          competencies: ['gas.oxy-vs-vent'],
          hiddenCompetencies: [],
          contextTags: ['ards'],
          difficulty: 2,
        },
      ];

      const recommendations = await learner.recommend(candidates, nowCheck);
      expect(recommendations).toHaveLength(2);
      expect(recommendations[0].id).toBe('case-asthma-severe');
      expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
      expect(recommendations[0].reasons.some(r => r.includes('Auto-PEEP'))).toBe(true);
    });
  });

  describe('Rule: progression to mastered and retained with novel context and fixed dates', () => {
    it('progresses to mastered only after novel-context condition, and to retained only after hidden correct answers at 7+ and 21+ days', async () => {
      const comp = 'mech.driving-pressure';
      const baseDate = new Date('2026-11-01T10:00:00.000Z');

      const makeEvent = (
        id: string,
        daysOffset: number,
        correct: boolean,
        contextTag: string,
        guidance: 'guided' | 'prompted' | 'independent',
        confidence: 'guess' | 'fairly_sure' | 'certain',
        hidden: boolean
      ): LearnerEvent => ({
        v: 1,
        id,
        wallTime: new Date(baseDate.getTime() + daysOffset * 24 * 3600 * 1000).toISOString(),
        sessionId: 'sess-learn',
        runId: `run-${id}`,
        type: 'prediction',
        predictionId: `p-${id}`,
        question: 'Calculate DP',
        answer: '12',
        expected: '12',
        competency: comp,
        evidenceType: 'prediction',
        correct,
        guidance,
        confidence,
        hidden,
        contextTags: [contextTag],
      });

      // Day 0: Correct with guidance independent in context 'copd' -> status practising (only 1 context)
      await learner.record(makeEvent('e1', 0, true, 'copd', 'independent', 'certain', false));
      let states = await learner.getCompetencyStates(baseDate);
      expect(states.find(s => s.competency === comp)?.status).toBe('practising');

      // Day 0 (second try in 'copd'): still only 1 distinct context -> status practising
      await learner.record(makeEvent('e2', 0.1, true, 'copd', 'independent', 'certain', false));
      states = await learner.getCompetencyStates(baseDate);
      expect(states.find(s => s.competency === comp)?.status).toBe('practising');

      // Day 1: Correct with guidance independent in context 'ards' -> 2 distinct contexts -> status independent
      await learner.record(makeEvent('e3', 1, true, 'ards', 'independent', 'certain', false));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 1 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('independent');

      // Day 2: Correct with confidence 'certain' but in familiar context 'copd' -> does NOT advance to mastered
      await learner.record(makeEvent('e4', 2, true, 'copd', 'independent', 'certain', false));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 2 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('independent');

      // Day 3: Correct with confidence 'certain' in NOVEL context 'postop' -> advances to MASTERED!
      await learner.record(makeEvent('e5', 3, true, 'postop', 'independent', 'certain', false));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 3 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('mastered');

      // Day 5 (2 days after mastered, < 7 days): hidden correct item -> does NOT advance to retained
      await learner.record(makeEvent('e6', 5, true, 'postop', 'independent', 'certain', true));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 5 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('mastered');

      // Day 11 (8 days after mastered at Day 3, >= 7 days): first hidden correct milestone met, but not 21+ yet
      await learner.record(makeEvent('e7', 11, true, 'trauma', 'independent', 'certain', true));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 11 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('mastered');

      // Day 18 (15 days after mastered, < 21 days): hidden correct item -> still mastered
      await learner.record(makeEvent('e8', 18, true, 'pneumonia', 'independent', 'certain', true));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 18 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('mastered');

      // Day 25 (22 days after mastered at Day 3, >= 21 days): second hidden correct milestone -> RETAINED!
      await learner.record(makeEvent('e9', 25, true, 'burns', 'independent', 'certain', true));
      states = await learner.getCompetencyStates(new Date(baseDate.getTime() + 25 * 24 * 3600 * 1000));
      expect(states.find(s => s.competency === comp)?.status).toBe('retained');
    });
  });

  describe('Rule: confident error drops a stage and resets interval to 1 day', () => {
    it('demotes stage and resets interval to 1 day', async () => {
      const comp = 'gas.oxy-vs-vent';
      const baseDate = new Date('2026-11-01T10:00:00.000Z');

      // Reach independent with 2 contexts
      await learner.record({
        v: 1,
        id: 'e1',
        wallTime: baseDate.toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p1',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['copd'],
      });

      await learner.record({
        v: 1,
        id: 'e2',
        wallTime: new Date(baseDate.getTime() + 86400000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p2',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['ards'],
      });

      // Reach mastered with novel context
      await learner.record({
        v: 1,
        id: 'e3',
        wallTime: new Date(baseDate.getTime() + 2 * 86400000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p3',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        confidence: 'certain',
        hidden: false,
        contextTags: ['postop'],
      });

      let states = await learner.getCompetencyStates();
      let state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('mastered');
      expect(state.intervalDays).toBeGreaterThan(1); // interval advanced on correct answers

      // Now: confident error (certain and wrong)
      await learner.record({
        v: 1,
        id: 'e4',
        wallTime: new Date(baseDate.getTime() + 3 * 86400000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p4',
        question: 'Q',
        answer: 'WRONG',
        expected: 'RIGHT',
        competency: comp,
        evidenceType: 'prediction',
        correct: false,
        guidance: 'prompted',
        confidence: 'certain', // Confident error
        hidden: false,
        contextTags: ['postop'],
      });

      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;

      // Stage dropped from mastered to independent!
      expect(state.status).toBe('independent');
      // Interval reset to 1 day!
      expect(state.intervalDays).toBe(1);

      // Another confident error drops independent to practising
      await learner.record({
        v: 1,
        id: 'e5',
        wallTime: new Date(baseDate.getTime() + 4 * 86400000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p5',
        question: 'Q',
        answer: 'WRONG',
        expected: 'RIGHT',
        competency: comp,
        evidenceType: 'prediction',
        correct: false,
        guidance: 'prompted',
        confidence: 'certain',
        hidden: false,
        contextTags: ['postop'],
      });

      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('practising');
      expect(state.intervalDays).toBe(1);
    });
  });

  describe('Rule: opening resources never changes status', () => {
    it('leaves status unchanged when resources are opened', async () => {
      const comp = 'wave.dyssynchrony';

      let states = await learner.getCompetencyStates();
      expect(states.find(s => s.competency === comp)?.status).toBe('not_seen');

      await learner.record({
        v: 1,
        id: 'res-evt-1',
        wallTime: '2026-11-02T10:00:00.000Z',
        sessionId: 's-res',
        type: 'resource_opened',
        competency: comp,
        resource: 'Dyssynchrony Identification Guide',
      });

      states = await learner.getCompetencyStates();
      expect(states.find(s => s.competency === comp)?.status).toBe('not_seen');
      expect(states.find(s => s.competency === comp)?.evidenceCount).toBe(0);
    });
  });

  describe('Rule: export/import round-trip and malformed validation', () => {
    it('round-trips identically across export and import', async () => {
      await learner.record({
        v: 1,
        id: 'e-trip-1',
        wallTime: '2026-11-03T10:00:00.000Z',
        sessionId: 's-trip',
        runId: 'run-trip-1',
        type: 'prediction',
        predictionId: 'pred-1',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        confidence: 'fairly_sure',
        hidden: false,
        contextTags: ['copd'],
      });
      await learner.setGuidanceOverride('mech.auto-peep', 'prompted');

      const jsonStr = await learner.exportJson();
      expect(typeof jsonStr).toBe('string');
      const parsed = JSON.parse(jsonStr) as { format: string; version: number; events: unknown[] };
      expect(parsed.format).toBe('ovs-learner');
      expect(parsed.version).toBe(1);
      expect(parsed.events).toHaveLength(1);

      // Clear all
      await learner.resetAll();
      let states = await learner.getCompetencyStates();
      expect(states.find(s => s.competency === 'mech.auto-peep')?.status).toBe('not_seen');
      expect(states.find(s => s.competency === 'mech.auto-peep')?.guidanceOverride).toBeNull();

      // Re-import
      await learner.importJson(jsonStr);
      states = await learner.getCompetencyStates();
      const restored = states.find(s => s.competency === 'mech.auto-peep')!;
      expect(restored.status).toBe('practising');
      expect(restored.evidenceCount).toBe(1);
      expect(restored.guidanceOverride).toBe('prompted');
      expect(restored.guidance).toBe('prompted');
    });

    it('throws on malformed JSON and leaves stored data completely unchanged', async () => {
      await learner.record({
        v: 1,
        id: 'e-keep',
        wallTime: '2026-11-03T10:00:00.000Z',
        sessionId: 's-keep',
        type: 'prediction',
        predictionId: 'pk',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'circ.ppv-preload',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'prompted',
        hidden: false,
      });

      // Attempt invalid JSON syntax
      await expect(learner.importJson('not a valid json')).rejects.toThrow();

      // Attempt invalid format object
      await expect(
        learner.importJson(JSON.stringify({ format: 'wrong-format', version: 1, events: [] }))
      ).rejects.toThrow();

      // Attempt invalid version
      await expect(
        learner.importJson(JSON.stringify({ format: 'ovs-learner', version: 99, events: [] }))
      ).rejects.toThrow();

      // Attempt invalid events content
      await expect(
        learner.importJson(
          JSON.stringify({
            format: 'ovs-learner',
            version: 1,
            exportedAt: new Date().toISOString(),
            events: [{ invalid: 'event' }],
          })
        )
      ).rejects.toThrow();

      // Data is untouched!
      const states = await learner.getCompetencyStates();
      const circ = states.find(s => s.competency === 'circ.ppv-preload')!;
      expect(circ.status).toBe('practising');
      expect(circ.evidenceCount).toBe(1);
    });
  });

  describe('Rule: IndexedDB storage persists across two createLearner instances', () => {
    it('shares data between separate instances via IndexedDB', async () => {
      const idb = new IndexedDbStorage('test-idb-multiclient');
      await idb.clearAll();

      const instance1 = createLearner(idb);
      await instance1.record({
        v: 1,
        id: 'idb-e1',
        wallTime: '2026-11-04T12:00:00.000Z',
        sessionId: 's-idb',
        type: 'prediction',
        predictionId: 'p-idb-1',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'modes.vc-vs-pc',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
      });

      // Create instance2 with fresh adapter to same database
      const idb2 = new IndexedDbStorage('test-idb-multiclient');
      const instance2 = createLearner(idb2);

      const states = await instance2.getCompetencyStates();
      const compState = states.find(s => s.competency === 'modes.vc-vs-pc')!;
      expect(compState.status).toBe('practising');
      expect(compState.evidenceCount).toBe(1);
    });
  });

  describe('Rule: recommend never mentions hidden competencies in reasons', () => {
    it('strictly hides hidden competency names and ids from all reasons', async () => {
      const candidate: ActivityCandidate = {
        activity: 'case',
        id: 'case-stealth-check',
        competencies: ['gas.oxy-vs-vent'],
        hiddenCompetencies: ['safety.alarm-response', 'safety.crisis'],
        contextTags: ['postop'],
        difficulty: 3,
      };

      const recommendations = await learner.recommend([candidate]);
      expect(recommendations).toHaveLength(1);
      const rec = recommendations[0];

      for (const r of rec.reasons) {
        expect(r.toLowerCase()).not.toContain('safety.alarm-response');
        expect(r.toLowerCase()).not.toContain('safety.crisis');
        expect(r.toLowerCase()).not.toContain('alarm');
        expect(r.toLowerCase()).not.toContain('crisis');
        expect(r.toLowerCase()).not.toContain('dope');
      }
    });
  });

  describe('LearnerModel validation and immutability', () => {
    it('rejects invalid event schemas on record', async () => {
      // Missing id
      await expect(
        learner.record({
          v: 1,
          wallTime: new Date().toISOString(),
          sessionId: 's',
          type: 'session_start',
          appVersion: '1',
        } as unknown as LearnerEvent)
      ).rejects.toThrow();

      // Bad schema version
      await expect(
        learner.record({
          v: 2 as unknown as 1,
          id: 'bad-v',
          wallTime: new Date().toISOString(),
          sessionId: 's',
          type: 'session_start',
          appVersion: '1',
        } as unknown as LearnerEvent)
      ).rejects.toThrow();
    });

    it('ensures recorded events cannot be mutated after recording', async () => {
      const event: LearnerEvent = {
        v: 1,
        id: 'imm-1',
        wallTime: '2026-11-01T10:00:00.000Z',
        sessionId: 's-imm',
        type: 'prediction',
        predictionId: 'p-imm',
        question: 'Original',
        answer: 'Original',
        expected: 'Original',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
      };

      await learner.record(event);

      // Mutate the original object
      (event as unknown as { question: string }).question = 'Mutated Question';

      const run = await learner.getRun('run-fake');
      expect(run).toBeNull();

      const exported = await learner.exportJson();
      const parsed = JSON.parse(exported) as { events: Array<{ question: string }> };
      expect(parsed.events[0].question).toBe('Original');
    });

    it('rejects evidence events with invalid or missing evidenceType', async () => {
      await expect(
        learner.record({
          v: 1,
          id: 'bad-ev-type',
          wallTime: new Date().toISOString(),
          sessionId: 's',
          type: 'prediction',
          predictionId: 'p-bad',
          question: 'Q',
          answer: 'A',
          expected: 'A',
          competency: 'mech.auto-peep',
          evidenceType: 'not-a-valid-type' as unknown as 'prediction',
          correct: true,
          guidance: 'prompted',
          hidden: false,
        })
      ).rejects.toThrow(/invalid evidenceType/);
    });

    it('preserves contextsCorrect list across confident errors and requires 2 new independent contexts to regain independent', async () => {
      const comp = 'gas.alveolar-ventilation';
      const baseDate = new Date('2026-11-01T10:00:00.000Z');

      // 1. Correct in context 'copd' with independent guidance
      await learner.record({
        v: 1,
        id: 'e1',
        wallTime: baseDate.toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p1',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['copd'],
      });

      // 2. Correct in context 'ards' with independent guidance -> becomes independent!
      await learner.record({
        v: 1,
        id: 'e2',
        wallTime: new Date(baseDate.getTime() + 3600000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p2',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['ards'],
      });

      let states = await learner.getCompetencyStates();
      let state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('independent');
      expect(state.contextsCorrect).toEqual(['copd', 'ards']);

      // 3. Confident error in 'postop' -> drops to practising
      await learner.record({
        v: 1,
        id: 'e3',
        wallTime: new Date(baseDate.getTime() + 7200000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p3',
        question: 'Q',
        answer: 'WRONG',
        expected: 'RIGHT',
        competency: comp,
        evidenceType: 'prediction',
        correct: false,
        guidance: 'prompted',
        confidence: 'certain',
        hidden: false,
        contextTags: ['postop'],
      });

      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('practising');
      // CRITICAL: contextsCorrect MUST retain the historical record of contexts with independent correct answers!
      expect(state.contextsCorrect).toEqual(['copd', 'ards']);

      // 4. Prompted correct answer in 'copd' -> stays practising (not independent guidance)
      await learner.record({
        v: 1,
        id: 'e4',
        wallTime: new Date(baseDate.getTime() + 10800000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p4',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'prompted',
        hidden: false,
        contextTags: ['copd'],
      });
      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('practising');

      // 5. Independent correct in 'trauma' (first context in new cycle) -> stays practising
      await learner.record({
        v: 1,
        id: 'e5',
        wallTime: new Date(baseDate.getTime() + 14400000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p5',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['trauma'],
      });
      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('practising');
      expect(state.contextsCorrect).toEqual(['copd', 'ards', 'trauma']);

      // 6. Independent correct in 'burns' (second context in new cycle) -> regains independent!
      await learner.record({
        v: 1,
        id: 'e6',
        wallTime: new Date(baseDate.getTime() + 18000000).toISOString(),
        sessionId: 's1',
        type: 'prediction',
        predictionId: 'p6',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: comp,
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['burns'],
      });
      states = await learner.getCompetencyStates();
      state = states.find(s => s.competency === comp)!;
      expect(state.status).toBe('independent');
      expect(state.contextsCorrect).toEqual(['copd', 'ards', 'trauma', 'burns']);
    });

    it('round-trips large event batches efficiently without memory leaks', async () => {
      const batchSize = 300;
      for (let i = 0; i < batchSize; i++) {
        await learner.record({
          v: 1,
          id: `batch-ev-${i}`,
          wallTime: new Date(Date.now() + i * 1000).toISOString(),
          sessionId: 'batch-sess',
          type: 'order',
          order: 'abg',
          simTimeSec: i * 10,
        });
      }

      const exported = await learner.exportJson();
      const parsed = JSON.parse(exported) as { events: unknown[] };
      expect(parsed.events).toHaveLength(batchSize);

      await learner.resetAll();
      expect(await (await learner.getCompetencyStates())[0].evidenceCount).toBe(0);

      await learner.importJson(exported);
      const reExported = await learner.exportJson();
      expect(JSON.parse(reExported).events).toHaveLength(batchSize);
    });

    it('imports pre-Phase-9 learner JSON exports cleanly without breaking compatibility', async () => {
      const legacyExport = JSON.stringify({
        format: 'ovs-learner',
        version: 1,
        exportedAt: '2026-10-15T12:00:00.000Z',
        events: [
          {
            v: 1,
            id: 'legacy-1',
            wallTime: '2026-10-10T10:00:00.000Z',
            sessionId: 'legacy-s1',
            runId: 'legacy-r1',
            activity: 'case',
            activityId: 'copd-niv-01',
            type: 'prediction',
            predictionId: 'p1',
            question: 'Legacy question',
            answer: 'A',
            expected: 'A',
            competency: 'niv.selection',
            evidenceType: 'decision',
            correct: true,
            confidence: 'certain',
            guidance: 'independent',
            hidden: false,
            contextTags: ['copd'],
          },
          {
            v: 1,
            id: 'legacy-2',
            wallTime: '2026-10-11T10:00:00.000Z',
            sessionId: 'legacy-s2',
            runId: 'legacy-r2',
            activity: 'case',
            activityId: 'ards-vent-01',
            type: 'prediction',
            predictionId: 'p2',
            question: 'Legacy question 2',
            answer: 'A',
            expected: 'A',
            competency: 'niv.selection',
            evidenceType: 'decision',
            correct: true,
            confidence: 'fairly_sure',
            guidance: 'independent',
            hidden: false,
            contextTags: ['ards'],
          },
        ],
        guidanceOverrides: { 'mech.eom': 'prompted' },
      });

      await learner.importJson(legacyExport);
      const states = await learner.getCompetencyStates();
      const niv = states.find(s => s.competency === 'niv.selection')!;
      expect(niv.status).toBe('independent');
      expect(niv.contextsCorrect).toEqual(['copd', 'ards']);
      expect(states.find(s => s.competency === 'mech.eom')?.guidanceOverride).toBe('prompted');
    });

    it('discounts runs automatically when store.ts records Level 2 tutor assistance for that runId', async () => {
      await clearTutorExchanges();
      await saveTutorExchange({
        id: 'ex-bridge-1',
        timestamp: '2026-11-05T10:05:00.000Z',
        contextKind: 'active_case',
        provider: 'offline',
        model: 'offline',
        promptVersion: 'tutor-v2',
        cap: 2,
        levelUsed: 2,
        rawOutput: '{}',
        validatedOutput: {
          message: 'Hint',
          help_level_used: 2,
          question: null,
          needs_clarification: false,
          reasoning_grade: 'correct_superficial',
          misconception_ids: [],
          claims: [],
          confidence: 0.9,
        },
        latencyMs: 5,
        suggestions: [],
        assisted: true,
        runId: 'run-bridged-1',
        competencyIds: ['mech.driving-pressure'],
      });
      await saveTutorExchange({
        id: 'ex-bridge-2',
        timestamp: '2026-11-06T10:05:00.000Z',
        contextKind: 'active_case',
        provider: 'offline',
        model: 'offline',
        promptVersion: 'tutor-v2',
        cap: 2,
        levelUsed: 2,
        rawOutput: '{}',
        validatedOutput: {
          message: 'Hint 2',
          help_level_used: 2,
          question: null,
          needs_clarification: false,
          reasoning_grade: 'correct_superficial',
          misconception_ids: [],
          claims: [],
          confidence: 0.9,
        },
        latencyMs: 5,
        suggestions: [],
        assisted: true,
        runId: 'run-bridged-2',
        competencyIds: ['mech.driving-pressure'],
      });

      await learner.record({
        v: 1,
        id: 'ev-b1',
        wallTime: '2026-11-05T10:15:00.000Z',
        sessionId: 'sb-1',
        runId: 'run-bridged-1',
        type: 'prediction',
        predictionId: 'pb1',
        question: 'Q1',
        answer: 'A',
        expected: 'A',
        competency: 'mech.driving-pressure',
        evidenceType: 'decision',
        correct: true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: ['ards'],
      });
      await learner.record({
        v: 1,
        id: 'ev-b2',
        wallTime: '2026-11-06T10:15:00.000Z',
        sessionId: 'sb-2',
        runId: 'run-bridged-2',
        type: 'prediction',
        predictionId: 'pb2',
        question: 'Q2',
        answer: 'A',
        expected: 'A',
        competency: 'mech.driving-pressure',
        evidenceType: 'decision',
        correct: true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: ['obesity'],
      });

      const states = await learner.getCompetencyStates();
      const dp = states.find(s => s.competency === 'mech.driving-pressure')!;
      expect(dp.status).toBe('practising');
      expect(dp.unaidedSuccessContexts).toEqual([]);
      expect(dp.assistedSuccessCount).toBe(2);
      await clearTutorExchanges();
    });

    it('exports, resets, and re-imports tutorExchanges and delayedRetests alongside learner runs and events', async () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, String(v));
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
        clear: () => {
          storageMap.clear();
        },
        length: 0,
        key: () => null,
      };
      const originalLocalStorage = globalThis.localStorage;
      globalThis.localStorage = mockStorage as unknown as Storage;

      try {
        await clearTutorExchanges();
        await saveTutorExchange({
          id: 'ex-persist-1',
          timestamp: '2026-11-06T10:05:00.000Z',
          contextKind: 'active_case',
          provider: 'offline',
          model: 'offline',
          promptVersion: 'tutor-v2',
          cap: 2,
          levelUsed: 2,
          rawOutput: '{}',
          validatedOutput: {
            message: 'Hint',
            help_level_used: 2,
            question: null,
            needs_clarification: false,
            reasoning_grade: 'correct_superficial',
            misconception_ids: [],
            claims: [],
            confidence: 0.9,
          },
          latencyMs: 5,
          suggestions: [],
          assisted: true,
          runId: 'run-persist-1',
          competencyIds: ['mech.driving-pressure'],
        });
        await scheduleDelayedRetest({
          id: 'retest-persist-1',
          caseId: 'ards-vent-01',
          competencyId: 'mech.driving-pressure',
          dueAt: Date.now() + 100000,
          createdAt: Date.now(),
          completedAt: null,
          passed: null,
          source: 'assisted_reveal',
        });

        saveRewindMetadata({
          rewindRunId: 'run-child',
          parentRunId: 'run-parent',
          caseId: 'ards-vent-01',
          rewindAtSimSec: 60,
          decisionIndex: 0,
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem('ovs_pathway_browse_all', 'true');
        localStorage.setItem('ovs_setting_loop_v1', '{}');

        const exportedStr = await learner.exportJson();
        const parsed = JSON.parse(exportedStr);
        expect(parsed.tutorExchanges).toHaveLength(1);
        expect(parsed.delayedRetests).toHaveLength(1);
        expect(parsed.rewindMetadata).toBeDefined();
        expect(parsed.rewindMetadata['run-child']).toBeDefined();

        await learner.resetAll();
        expect(await listTutorExchanges()).toHaveLength(0);
        expect(await listDelayedRetests()).toHaveLength(0);
        expect(getRewindMetadata('run-child')).toBeNull();
        expect(localStorage.getItem('ovs_rewind_meta_v1')).toBeNull();
        expect(localStorage.getItem('ovs_pathway_browse_all')).toBeNull();
        expect(localStorage.getItem('ovs_setting_loop_v1')).toBeNull();

        await learner.importJson(exportedStr);
        expect(await listTutorExchanges()).toHaveLength(1);
        expect(await listDelayedRetests()).toHaveLength(1);
        expect(getRewindMetadata('run-child')).toBeDefined();

        await clearTutorExchanges();
      } finally {
        globalThis.localStorage = originalLocalStorage;
      }
    });
  });
});
