import { describe, it, expect } from 'vitest';
import {
  deriveCompetencyStates,
  deriveRun,
  recommend,
  ALL_COMPETENCIES,
  COMPETENCY_FRIENDLY_NAMES,
  computeAssistanceMultiplier,
  computeQualityMultiplier,
  computeLlmReasoningModifier,
  computeEvidenceEntrustmentContribution,
  computeBrierScore,
} from './derivation';
import type { LearnerEvent } from '../shared/events';
import type { ActivityCandidate, RunSummary } from '../shared/learnerApi';

describe('derivation functions', () => {
  describe('deriveCompetencyStates', () => {
    it('returns all 38 competencies in competencies.json order for empty events', () => {
      const states = deriveCompetencyStates([]);
      expect(states).toHaveLength(38);
      expect(states.map(s => s.competency)).toEqual(ALL_COMPETENCIES.map(c => c.id));

      for (const st of states) {
        expect(st.status).toBe('not_seen');
        expect(st.guidance).toBe('guided');
        expect(st.guidanceOverride).toBeNull();
        expect(st.dueAt).toBeNull();
        expect(st.intervalDays).toBeNull();
        expect(st.evidenceCount).toBe(0);
        expect(st.correctCount).toBe(0);
        expect(st.contextsCorrect).toEqual([]);
        expect(st.lastEvidenceAt).toBeNull();
        expect(st.topMistakes).toEqual([]);
        expect(st.calibration).toEqual({
          byConfidence: {
            guess: { answered: 0, correct: 0 },
            fairly_sure: { answered: 0, correct: 0 },
            certain: { answered: 0, correct: 0 },
          },
        });
      }
    });

    it('has an explicit friendly title for every one of the 38 competencies', () => {
      expect(ALL_COMPETENCIES).toHaveLength(38);
      for (const c of ALL_COMPETENCIES) {
        expect(COMPETENCY_FRIENDLY_NAMES[c.id]).toBeDefined();
        expect(COMPETENCY_FRIENDLY_NAMES[c.id]).not.toBe(c.id);
      }
    });

    it('respects guidanceOverride over computed guidance even when not seen', () => {
      const states = deriveCompetencyStates([], new Date(), {
        'mech.auto-peep': 'prompted',
        'mech.eom': 'independent',
      });
      const autoPeep = states.find(s => s.competency === 'mech.auto-peep')!;
      const eom = states.find(s => s.competency === 'mech.eom')!;
      const res = states.find(s => s.competency === 'mech.res-vs-comp')!;

      expect(autoPeep.guidance).toBe('prompted');
      expect(autoPeep.guidanceOverride).toBe('prompted');
      expect(eom.guidance).toBe('independent');
      expect(eom.guidanceOverride).toBe('independent');
      expect(res.guidance).toBe('guided');
      expect(res.guidanceOverride).toBeNull();
    });

    it('computes calibration and top mistakes', () => {
      const events: LearnerEvent[] = [
        {
          v: 1,
          id: 'p1',
          wallTime: '2026-11-01T10:00:00.000Z',
          sessionId: 's1',
          type: 'prediction',
          predictionId: 'pr1',
          question: 'Q1',
          answer: 'A',
          expected: 'A',
          competency: 'mech.auto-peep',
          evidenceType: 'prediction',
          correct: true,
          confidence: 'certain',
          guidance: 'prompted',
          hidden: false,
        },
        {
          v: 1,
          id: 'p2',
          wallTime: '2026-11-01T10:05:00.000Z',
          sessionId: 's1',
          type: 'prediction',
          predictionId: 'pr2',
          question: 'Q2',
          answer: 'B',
          expected: 'C',
          competency: 'mech.auto-peep',
          evidenceType: 'prediction',
          correct: false,
          confidence: 'guess',
          guidance: 'prompted',
          hidden: false,
        },
        {
          v: 1,
          id: 'm1',
          wallTime: '2026-11-01T10:06:00.000Z',
          sessionId: 's1',
          type: 'mistake',
          mistake: 'missed_clue',
          competency: 'mech.auto-peep',
          severity: 'minor',
          detail: 'Did not check flow curve',
        },
        {
          v: 1,
          id: 'm2',
          wallTime: '2026-11-01T10:07:00.000Z',
          sessionId: 's1',
          type: 'mistake',
          mistake: 'missed_clue',
          competency: 'mech.auto-peep',
          severity: 'major',
          detail: 'Ignored expiratory hold',
        },
        {
          v: 1,
          id: 'm3',
          wallTime: '2026-11-01T10:08:00.000Z',
          sessionId: 's1',
          type: 'mistake',
          mistake: 'knowledge_gap',
          competency: 'mech.auto-peep',
          severity: 'minor',
          detail: 'Auto PEEP definition',
        },
      ];

      const states = deriveCompetencyStates(events);
      const autoPeep = states.find(s => s.competency === 'mech.auto-peep')!;

      expect(autoPeep.calibration.byConfidence.certain).toEqual({ answered: 1, correct: 1 });
      expect(autoPeep.calibration.byConfidence.guess).toEqual({ answered: 1, correct: 0 });
      expect(autoPeep.calibration.byConfidence.fairly_sure).toEqual({ answered: 0, correct: 0 });

      expect(autoPeep.topMistakes).toEqual([
        { mistake: 'missed_clue', count: 2 },
        { mistake: 'knowledge_gap', count: 1 },
      ]);
    });

    it('guidance rule: guided if 2 or more of last 3 wrong', () => {
      const baseEvent = (id: string, time: string, correct: boolean): LearnerEvent => ({
        v: 1,
        id,
        wallTime: time,
        sessionId: 's1',
        type: 'prediction',
        predictionId: id,
        question: 'Q',
        answer: '',
        expected: '',
        competency: 'mech.res-vs-comp',
        evidenceType: 'prediction',
        correct,
        guidance: 'prompted',
        hidden: false,
      });

      // 1 wrong -> not >= 2 wrong, not independent -> prompted
      let states = deriveCompetencyStates([baseEvent('e1', '2026-11-01T10:00:00.000Z', false)]);
      expect(states.find(s => s.competency === 'mech.res-vs-comp')?.guidance).toBe('prompted');

      // 2 wrong -> >= 2 of last 3 wrong -> guided
      states = deriveCompetencyStates([
        baseEvent('e1', '2026-11-01T10:00:00.000Z', false),
        baseEvent('e2', '2026-11-01T10:05:00.000Z', false),
      ]);
      expect(states.find(s => s.competency === 'mech.res-vs-comp')?.guidance).toBe('guided');

      // 3 events: [wrong, correct, wrong] -> 2 wrong of 3 -> guided
      states = deriveCompetencyStates([
        baseEvent('e1', '2026-11-01T10:00:00.000Z', false),
        baseEvent('e2', '2026-11-01T10:05:00.000Z', true),
        baseEvent('e3', '2026-11-01T10:10:00.000Z', false),
      ]);
      expect(states.find(s => s.competency === 'mech.res-vs-comp')?.guidance).toBe('guided');

      // 3 events: [wrong, correct, correct] -> 1 wrong of 3 -> prompted (not independent status yet)
      states = deriveCompetencyStates([
        baseEvent('e1', '2026-11-01T10:00:00.000Z', false),
        baseEvent('e2', '2026-11-01T10:05:00.000Z', true),
        baseEvent('e3', '2026-11-01T10:10:00.000Z', true),
      ]);
      expect(states.find(s => s.competency === 'mech.res-vs-comp')?.guidance).toBe('prompted');
    });

    it('resource_opened and debrief_viewed never change status', () => {
      const events: LearnerEvent[] = [
        {
          v: 1,
          id: 'res-1',
          wallTime: '2026-11-01T10:00:00.000Z',
          sessionId: 's1',
          type: 'resource_opened',
          competency: 'mech.auto-peep',
          resource: 'ICUedu auto-PEEP guide',
        },
        {
          v: 1,
          id: 'deb-1',
          wallTime: '2026-11-01T10:05:00.000Z',
          sessionId: 's1',
          type: 'debrief_viewed',
        },
      ];

      const states = deriveCompetencyStates(events);
      const autoPeep = states.find(s => s.competency === 'mech.auto-peep')!;
      expect(autoPeep.status).toBe('not_seen');
      expect(autoPeep.evidenceCount).toBe(0);
    });

    it('intervals ladder: steps up on correct, steps down on wrong, min 1, resets to 1 on confident error', () => {
      const makeEv = (id: string, time: string, correct: boolean, confidence?: 'guess' | 'fairly_sure' | 'certain'): LearnerEvent => ({
        v: 1,
        id,
        wallTime: time,
        sessionId: 's1',
        type: 'prediction',
        predictionId: id,
        question: 'Q',
        answer: '',
        expected: '',
        competency: 'gas.acid-base',
        evidenceType: 'prediction',
        correct,
        confidence,
        guidance: 'prompted',
        hidden: false,
      });

      // 1 correct: moves step up from base (index 0 -> index 1: 3 days)
      let states = deriveCompetencyStates([makeEv('e1', '2026-11-01T10:00:00.000Z', true)]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(3);

      // 2 correct: index 1 -> index 2: 7 days
      states = deriveCompetencyStates([
        makeEv('e1', '2026-11-01T10:00:00.000Z', true),
        makeEv('e2', '2026-11-04T10:00:00.000Z', true),
      ]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(7);

      // 3 correct: index 2 -> index 3: 21 days
      states = deriveCompetencyStates([
        makeEv('e1', '2026-11-01T10:00:00.000Z', true),
        makeEv('e2', '2026-11-04T10:00:00.000Z', true),
        makeEv('e3', '2026-11-11T10:00:00.000Z', true),
      ]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(21);

      // 4 correct: index 3 -> index 4: 60 days
      states = deriveCompetencyStates([
        makeEv('e1', '2026-11-01T10:00:00.000Z', true),
        makeEv('e2', '2026-11-04T10:00:00.000Z', true),
        makeEv('e3', '2026-11-11T10:00:00.000Z', true),
        makeEv('e4', '2026-12-02T10:00:00.000Z', true),
      ]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(60);

      // 5: normal wrong step down (60 -> 21 days)
      states = deriveCompetencyStates([
        makeEv('e1', '2026-11-01T10:00:00.000Z', true),
        makeEv('e2', '2026-11-04T10:00:00.000Z', true),
        makeEv('e3', '2026-11-11T10:00:00.000Z', true),
        makeEv('e4', '2026-12-02T10:00:00.000Z', true),
        makeEv('e5', '2026-12-10T10:00:00.000Z', false, 'guess'),
      ]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(21);

      // 6: confident wrong resets interval to 1 day
      states = deriveCompetencyStates([
        makeEv('e1', '2026-11-01T10:00:00.000Z', true),
        makeEv('e2', '2026-11-04T10:00:00.000Z', true),
        makeEv('e3', '2026-11-11T10:00:00.000Z', true),
        makeEv('e4', '2026-12-02T10:00:00.000Z', true),
        makeEv('e6', '2026-12-10T10:00:00.000Z', false, 'certain'),
      ]);
      expect(states.find(s => s.competency === 'gas.acid-base')?.intervalDays).toBe(1);
    });
  });

  describe('deriveRun', () => {
    it('returns null for non-existent runId', () => {
      expect(deriveRun([], 'run-xyz')).toBeNull();
    });

    it('derives complete RunSummary from events in the run', () => {
      const events: LearnerEvent[] = [
        {
          v: 1,
          id: 'rs-1',
          wallTime: '2026-11-05T09:00:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          activity: 'case',
          activityId: 'copd-niv-01',
          activityVersion: '1.0.0',
          type: 'run_start',
          guidanceByCompetency: { 'mech.auto-peep': 'guided' },
          contextTags: ['copd', 'niv'],
        },
        {
          v: 1,
          id: 'ord-1',
          wallTime: '2026-11-05T09:02:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          type: 'order',
          order: 'abg',
          simTimeSec: 120,
        },
        {
          v: 1,
          id: 'pred-1',
          wallTime: '2026-11-05T09:05:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          type: 'prediction',
          predictionId: 'pred-copd-1',
          question: 'What will happen to PaCO2?',
          answer: 'decrease',
          expected: 'decrease',
          competency: 'gas.alveolar-ventilation',
          evidenceType: 'prediction',
          correct: true,
          confidence: 'fairly_sure',
          guidance: 'independent',
          hidden: false,
        },
        {
          v: 1,
          id: 'rub-1',
          wallTime: '2026-11-05T09:10:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          type: 'rubric_result',
          rubricId: 'rub-abg-within-30',
          met: true,
          critical: true,
          competency: 'safety.reassess',
          evidenceType: 'safety',
          correct: true,
          guidance: 'prompted',
          hidden: false,
        },
        {
          v: 1,
          id: 'mis-1',
          wallTime: '2026-11-05T09:12:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          type: 'mistake',
          mistake: 'premature_closure',
          competency: 'gas.acid-base',
          severity: 'minor',
          detail: 'Assumed pure respiratory acidosis',
        },
        {
          v: 1,
          id: 're-1',
          wallTime: '2026-11-05T09:15:00.000Z',
          sessionId: 's-1',
          runId: 'run-alpha',
          type: 'run_end',
          outcome: 'improved',
          score: 1,
          maxScore: 1,
        },
      ];

      const run = deriveRun(events, 'run-alpha');
      expect(run).not.toBeNull();
      expect(run?.runId).toBe('run-alpha');
      expect(run?.activity).toBe('case');
      expect(run?.activityId).toBe('copd-niv-01');
      expect(run?.activityVersion).toBe('1.0.0');
      expect(run?.startedAt).toBe('2026-11-05T09:00:00.000Z');
      expect(run?.endedAt).toBe('2026-11-05T09:15:00.000Z');
      expect(run?.outcome).toBe('improved');
      expect(run?.score).toBe(1);
      expect(run?.maxScore).toBe(1);
      expect(run?.predictions).toHaveLength(1);
      expect(run?.predictions[0].predictionId).toBe('pred-copd-1');
      expect(run?.rubric).toHaveLength(1);
      expect(run?.rubric[0].rubricId).toBe('rub-abg-within-30');
      expect(run?.rubric[0].critical).toBe(true);
      expect(run?.mistakes).toHaveLength(1);
      expect(run?.mistakes[0].mistake).toBe('premature_closure');
      expect(run?.ordersTimeline).toEqual([
        { simTimeSec: 120, order: 'abg' },
      ]);
    });
  });

  describe('recommend', () => {
    it('scores candidates based on 0.35 due + 0.30 weak + 0.20 curriculum + 0.15 novelty', () => {
      const now = new Date('2026-11-10T12:00:00.000Z');
      const states = deriveCompetencyStates([]); // all not_seen, curriculum domain is mech

      // Candidate 1 in mech domain, different context tag
      const candidates: ActivityCandidate[] = [
        {
          activity: 'case',
          id: 'case-mech',
          competencies: ['mech.auto-peep'],
          hiddenCompetencies: [],
          contextTags: ['asthma'],
          difficulty: 1,
        },
        {
          activity: 'case',
          id: 'case-gas',
          competencies: ['gas.acid-base'],
          hiddenCompetencies: [],
          contextTags: ['copd'],
          difficulty: 1,
        },
      ];

      const recentRuns: RunSummary[] = [
        {
          runId: 'r0',
          activity: 'case',
          activityId: 'case-gas',
          startedAt: '2026-11-09T10:00:00.000Z',
          endedAt: '2026-11-09T10:30:00.000Z',
          outcome: 'improved',
          score: 1,
          maxScore: 1,
          predictions: [],
          rubric: [],
          mistakes: [],
          ordersTimeline: [],
          contextTags: ['copd'],
        } as RunSummary & { contextTags?: string[] },
      ];

      const recs = recommend(states, candidates, recentRuns, now);
      expect(recs).toHaveLength(2);

      // case-mech:
      // due: 0 (not scheduled)
      // weak: 0 (not_seen, not practising)
      // curriculum: 1.0 (mech is earliest incomplete domain) -> 0.20 * 1.0 = 0.20
      // novelty: 1.0 (asthma != copd) -> 0.15 * 1.0 = 0.15
      // Total: 0.35
      const recMech = recs.find(r => r.id === 'case-mech')!;
      expect(recMech.score).toBe(0.35);

      // case-gas:
      // due: 0
      // weak: 0
      // curriculum: 0 (gas is not mech)
      // novelty: 0 (copd == copd)
      // Total: 0.00
      const recGas = recs.find(r => r.id === 'case-gas')!;
      expect(recGas.score).toBe(0);

      expect(recs[0].id).toBe('case-mech');
    });

    it('NEVER mentions a hidden competency in reasons', () => {
      const now = new Date('2026-11-10T12:00:00.000Z');
      const states = deriveCompetencyStates([]);

      // Mark safety.alarm-response as due by creating an event
      const events: LearnerEvent[] = [
        {
          v: 1,
          id: 'ev-due',
          wallTime: '2026-11-01T10:00:00.000Z',
          sessionId: 's1',
          type: 'prediction',
          predictionId: 'p1',
          question: 'Q',
          answer: 'A',
          expected: 'B',
          competency: 'safety.alarm-response',
          evidenceType: 'safety',
          correct: false,
          guidance: 'prompted',
          hidden: false,
        },
      ];
      const activeStates = deriveCompetencyStates(events, now);

      const candidate: ActivityCandidate = {
        activity: 'case',
        id: 'stealth-case',
        competencies: ['gas.oxy-vs-vent'],
        hiddenCompetencies: ['safety.alarm-response'],
        contextTags: ['pneumonia'],
        difficulty: 2,
      };

      const recs = recommend(activeStates, [candidate], [], now, events);
      expect(recs).toHaveLength(1);
      const rec = recs[0];

      for (const reason of rec.reasons) {
        expect(reason.toLowerCase()).not.toContain('safety.alarm-response');
        expect(reason.toLowerCase()).not.toContain('alarm');
        expect(reason.toLowerCase()).not.toContain('ventilator alarm response');
      }
    });

    it('identifies confident errors across all recent runs (not just recentRuns[0])', () => {
      const now = new Date('2026-11-10T12:00:00.000Z');
      const states = deriveCompetencyStates([]);

      const candidates: ActivityCandidate[] = [
        {
          activity: 'case',
          id: 'case-peep',
          competencies: ['mech.auto-peep'],
          hiddenCompetencies: [],
          contextTags: ['copd'],
          difficulty: 1,
        },
      ];

      // recentRuns has 2 runs: run 0 is a clean drill, run 1 had a confident error on mech.auto-peep
      const recentRuns: RunSummary[] = [
        {
          runId: 'r-latest',
          activity: 'drill',
          activityId: 'd1',
          startedAt: '2026-11-10T10:00:00.000Z',
          endedAt: '2026-11-10T10:10:00.000Z',
          outcome: 'completed',
          score: 5,
          maxScore: 5,
          predictions: [],
          rubric: [],
          mistakes: [],
          ordersTimeline: [],
        },
        {
          runId: 'r-earlier',
          activity: 'case',
          activityId: 'c1',
          startedAt: '2026-11-10T09:00:00.000Z',
          endedAt: '2026-11-10T09:30:00.000Z',
          outcome: 'deteriorated',
          score: 0,
          maxScore: 1,
          predictions: [
            {
              predictionId: 'p-err',
              question: 'Q',
              answer: 'wrong',
              expected: 'right',
              correct: false,
              confidence: 'certain', // confident error in run 1!
              competency: 'mech.auto-peep',
            },
          ],
          rubric: [],
          mistakes: [],
          ordersTimeline: [],
        },
      ];

      // Call recommend without events (pure 4 arguments)
      const recs = recommend(states, candidates, recentRuns, now);
      expect(recs).toHaveLength(1);
      // mech.auto-peep is counted as weak because of the confident error in recentRuns[1]
      expect(recs[0].reasons.some(r => r.includes('Auto-PEEP'))).toBe(true);
      expect(recs[0].reasons.some(r => r.includes('needs practice'))).toBe(true);
    });

    it('handles candidates with zero competencies or only hidden competencies gracefully', () => {
      const states = deriveCompetencyStates([]);
      const candidates: ActivityCandidate[] = [
        {
          activity: 'drill',
          id: 'empty-candidate',
          competencies: [],
          hiddenCompetencies: [],
          contextTags: [],
          difficulty: 1,
        },
        {
          activity: 'case',
          id: 'stealth-only-candidate',
          competencies: [],
          hiddenCompetencies: ['mech.auto-peep'],
          contextTags: ['asthma'],
          difficulty: 2,
        },
      ];

      const recs = recommend(states, candidates, [], new Date());
      expect(recs).toHaveLength(2);
      // stealth-only-candidate is ranked first (curriculum 0.20 + novelty 0.15 = 0.35 vs 0.15)
      expect(recs[0].id).toBe('stealth-only-candidate');
      expect(recs[0].score).toBe(0.35);
      expect(recs[0].reasons).toEqual(['New clinical context (asthma)']);
      // Never mentions auto-peep
      for (const r of recs[0].reasons) {
        expect(r.toLowerCase()).not.toContain('auto-peep');
      }

      // empty-candidate is ranked second with no reasons
      expect(recs[1].id).toBe('empty-candidate');
      expect(recs[1].reasons).toEqual([]);
    });

    it('stably sorts events with identical timestamps using arrival index', () => {
      const sameTime = '2026-11-01T10:00:00.000Z';
      const events: LearnerEvent[] = [
        {
          v: 1,
          id: 'ev-1',
          wallTime: sameTime,
          sessionId: 's1',
          type: 'prediction',
          predictionId: 'p1',
          question: 'Q1',
          answer: 'A',
          expected: 'A',
          competency: 'gas.acid-base',
          evidenceType: 'prediction',
          correct: true,
          guidance: 'independent',
          hidden: false,
          contextTags: ['copd'],
        },
        {
          v: 1,
          id: 'ev-2',
          wallTime: sameTime,
          sessionId: 's1',
          type: 'prediction',
          predictionId: 'p2',
          question: 'Q2',
          answer: 'A',
          expected: 'A',
          competency: 'gas.acid-base',
          evidenceType: 'prediction',
          correct: true,
          guidance: 'independent',
          hidden: false,
          contextTags: ['ards'],
        },
      ];

      const states = deriveCompetencyStates(events);
      const ab = states.find(s => s.competency === 'gas.acid-base')!;
      expect(ab.status).toBe('independent');
      expect(ab.contextsCorrect).toEqual(['copd', 'ards']);
    });

    it('Item 5: never grants independent/mastered for Level 2 assisted runs even at independent guidance', () => {
      const makeAssistedEvent = (id: string, dayOffset: number, ctx: string, maxHelpLevelUsed: 0 | 1 | 2 | 3 = 2): LearnerEvent => ({
        v: 1,
        id,
        wallTime: new Date(Date.UTC(2026, 10, 1 + dayOffset)).toISOString(),
        sessionId: 's-assist',
        runId: `run-${id}`,
        activity: 'case',
        activityId: ctx,
        type: 'prediction',
        predictionId: `p-${id}`,
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'mech.auto-peep',
        evidenceType: 'decision',
        correct: true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: [ctx],
        assistance: {
          assistedInWindow: true,
          maxHelpLevelUsed,
          hintCountInProblem: 1,
          tutorTurnsBeforeCommit: 1,
          reconstructionPassed: true,
          timeToFirstHypothesisMs: 9000,
        },
      });

      const states = deriveCompetencyStates([
        makeAssistedEvent('a1', 0, 'copd', 2),
        makeAssistedEvent('a2', 1, 'asthma', 2),
      ]);
      const st = states.find(s => s.competency === 'mech.auto-peep')!;
      expect(st.status).toBe('practising');
      expect(st.unaidedSuccessContexts).toEqual([]);
      expect(st.unaidedEntrustmentScore).toBe(0);
      expect(st.assistedSuccessCount).toBe(2);
      expect(st.pendingDelayedRetestDueAt).not.toBeNull();
    });

    it('Item 5: enforces alpha_help, beta_qual, bounded +/-15% gamma_LLM, and never turns failure into pass', () => {
      expect(computeAssistanceMultiplier({ assistedInWindow: false, maxHelpLevelUsed: 0, hintCountInProblem: 0, tutorTurnsBeforeCommit: 0, reconstructionPassed: null, timeToFirstHypothesisMs: 0 })).toBe(1.0);
      expect(computeAssistanceMultiplier({ assistedInWindow: true, maxHelpLevelUsed: 0, hintCountInProblem: 1, tutorTurnsBeforeCommit: 1, reconstructionPassed: null, timeToFirstHypothesisMs: 0 })).toBe(0.5);
      expect(computeAssistanceMultiplier({ assistedInWindow: true, maxHelpLevelUsed: 1, hintCountInProblem: 1, tutorTurnsBeforeCommit: 1, reconstructionPassed: null, timeToFirstHypothesisMs: 0 })).toBe(0.15);
      expect(computeAssistanceMultiplier({ assistedInWindow: true, maxHelpLevelUsed: 2, hintCountInProblem: 1, tutorTurnsBeforeCommit: 1, reconstructionPassed: true, timeToFirstHypothesisMs: 0 })).toBe(0.0);
      expect(computeAssistanceMultiplier({ assistedInWindow: true, maxHelpLevelUsed: 3, hintCountInProblem: 1, tutorTurnsBeforeCommit: 1, reconstructionPassed: true, timeToFirstHypothesisMs: 0 })).toBe(0.0);

      expect(computeQualityMultiplier('certain', 'correct_justified')).toBe(1.0);
      expect(computeQualityMultiplier('guess', 'correct_justified')).toBe(0.25);
      expect(computeQualityMultiplier('certain', 'correct_conclusion_wrong_reasoning')).toBe(0.0);
      expect(computeQualityMultiplier('fairly_sure', 'right_action_wrong_reason')).toBe(0.0);

      expect(computeLlmReasoningModifier('correct_justified', true)).toBe(0.1);
      expect(computeLlmReasoningModifier('correct_superficial', true)).toBe(-0.15);

      // Failure is never turned into positive entrustment evidence by LLM grading
      expect(
        computeEvidenceEntrustmentContribution({
          correct: false,
          confidence: 'certain',
          assistance: { assistedInWindow: false, maxHelpLevelUsed: 0, hintCountInProblem: 0, tutorTurnsBeforeCommit: 0, reconstructionPassed: null, timeToFirstHypothesisMs: 0 },
          reasoningGrade: 'correct_justified',
          causalNodesVerified: true,
        })
      ).toBe(0);

      expect(
        computeEvidenceEntrustmentContribution({
          correct: true,
          confidence: 'certain',
          assistance: { assistedInWindow: false, maxHelpLevelUsed: 0, hintCountInProblem: 0, tutorTurnsBeforeCommit: 0, reconstructionPassed: null, timeToFirstHypothesisMs: 0 },
          reasoningGrade: 'correct_justified',
          causalNodesVerified: true,
        })
      ).toBe(1.1);
    });

    it('Item 5: requires blind/transfer probe for mastered when v2 telemetry is present and demotes on failed retest/transfer', () => {
      const unaided = {
        assistedInWindow: false,
        maxHelpLevelUsed: 0 as const,
        hintCountInProblem: 0,
        tutorTurnsBeforeCommit: 0,
        reconstructionPassed: null,
        timeToFirstHypothesisMs: 8000,
      };
      const mkEv = (
        id: string,
        day: number,
        ctx: string,
        opts: { hidden?: boolean; correct?: boolean; isTransferVariant?: boolean; isDelayedRetest?: boolean; transferVariantId?: string } = {}
      ): LearnerEvent => ({
        v: 1,
        id,
        wallTime: new Date(Date.UTC(2026, 10, 1 + day)).toISOString(),
        sessionId: 's-v2',
        runId: `r-${id}`,
        activity: 'case',
        activityId: ctx,
        type: 'prediction',
        predictionId: `p-${id}`,
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'disease.ards',
        evidenceType: 'decision',
        correct: opts.correct ?? true,
        confidence: 'fairly_sure',
        guidance: 'independent',
        hidden: opts.hidden ?? false,
        contextTags: [ctx],
        assistance: unaided,
        isTransferVariant: opts.isTransferVariant,
        isDelayedRetest: opts.isDelayedRetest,
        transferVariantId: opts.transferVariantId,
      });

      // 3 novel unaided non-hidden visible events stay independent (missing blind/transfer probe)
      const beforeBlind = deriveCompetencyStates([
        mkEv('e1', 0, 'ards-low-vt'),
        mkEv('e2', 1, 'ards-high-peep'),
        mkEv('e3', 2, 'ards-prone'),
      ]);
      expect(beforeBlind.find(s => s.competency === 'disease.ards')!.status).toBe('independent');

      // Adding an unaided transfer variant in novel context promotes to mastered
      const withTransfer = deriveCompetencyStates([
        mkEv('e1', 0, 'ards-low-vt'),
        mkEv('e2', 1, 'ards-high-peep'),
        mkEv('e3', 2, 'ards-prone'),
        mkEv('e4', 3, 'ards-sepsis-transfer', { isTransferVariant: true, transferVariantId: 'ards--transfer' }),
      ]);
      expect(withTransfer.find(s => s.competency === 'disease.ards')!.status).toBe('mastered');

      // Failed unaided delayed retest drops mastered -> independent and resets interval
      const afterFailedRetest = deriveCompetencyStates([
        mkEv('e1', 0, 'ards-low-vt'),
        mkEv('e2', 1, 'ards-high-peep'),
        mkEv('e3', 2, 'ards-prone'),
        mkEv('e4', 3, 'ards-sepsis-transfer', { isTransferVariant: true }),
        mkEv('e5', 6, 'ards-retest', { isDelayedRetest: true, correct: false }),
      ]);
      const demoted = afterFailedRetest.find(s => s.competency === 'disease.ards')!;
      expect(demoted.status).toBe('independent');
      expect(demoted.intervalDays).toBe(1);
    });

    it('Item 5: computes Brier calibration score using 0.33 / 0.67 / 0.95 and activates comfort-trap recommendation reweighting', () => {
      const brier = computeBrierScore([
        { correct: true, confidence: 'certain' }, // (0.95 - 1)^2 = 0.0025
        { correct: false, confidence: 'guess' }, // (0.33 - 0)^2 = 0.1089
      ]);
      expect(brier).toBeCloseTo(0.0557, 4);

      const states = deriveCompetencyStates([]);
      const idxStrong = states.findIndex(s => s.competency === 'mech.eom');
      states[idxStrong] = {
        ...states[idxStrong],
        status: 'mastered',
        dueAt: '2026-12-20T00:00:00.000Z',
      };
      const idxWeak = states.findIndex(s => s.competency === 'mech.auto-peep');
      states[idxWeak] = {
        ...states[idxWeak],
        status: 'practising',
        dueAt: '2026-11-01T00:00:00.000Z',
      };

      const comfortRuns: RunSummary[] = [1, 2, 3].map(i => ({
        runId: `comfort-${i}`,
        activity: 'case',
        activityId: `c-${i}`,
        startedAt: `2026-11-0${i}T10:00:00.000Z`,
        endedAt: `2026-11-0${i}T10:15:00.000Z`,
        outcome: 'improved',
        score: 1,
        maxScore: 1,
        predictions: [
          {
            predictionId: `p-${i}`,
            question: 'Q',
            answer: 'A',
            expected: 'A',
            correct: true,
            confidence: 'certain',
            competency: 'mech.eom',
          },
        ],
        rubric: [],
        mistakes: [],
        ordersTimeline: [],
      }));

      const candidates: ActivityCandidate[] = [
        {
          activity: 'case',
          id: 'easy-mastered',
          competencies: ['mech.eom'],
          hiddenCompetencies: [],
          contextTags: ['normal'],
          difficulty: 1,
        },
        {
          activity: 'case',
          id: 'due-practising',
          competencies: ['mech.auto-peep'],
          hiddenCompetencies: [],
          contextTags: ['normal'],
          difficulty: 2,
        },
      ];

      const recs = recommend(states, candidates, comfortRuns, new Date('2026-11-10T12:00:00.000Z'));
      expect(recs[0].id).toBe('due-practising');
      // With 40% due + 40% weak boosted above normal 35% + 30%
      expect(recs[0].score).toBeGreaterThan(recs[1].score);
    });
  });
});

describe('mastery: tutor help and self-marked evidence', () => {
  const COMP = 'gas.dead-space';
  const mk = (
    id: string,
    day: number,
    ctx: string,
    opts: { sessionId?: string; confidence?: 'guess' | 'fairly_sure' | 'certain'; guidance?: 'guided' | 'independent' } = {}
  ): LearnerEvent => ({
    v: 1,
    id,
    wallTime: new Date(Date.UTC(2026, 10, 1 + day)).toISOString(),
    sessionId: opts.sessionId ?? 's-main',
    runId: `r-${id}`,
    activity: 'case',
    activityId: ctx,
    type: 'prediction',
    predictionId: `p-${id}`,
    question: 'Q',
    answer: 'A',
    expected: 'A',
    competency: COMP,
    evidenceType: 'decision',
    correct: true,
    confidence: opts.confidence ?? 'fairly_sure',
    guidance: opts.guidance ?? 'independent',
    hidden: false,
    contextTags: [ctx],
  });
  const statusOf = (events: LearnerEvent[], options?: Parameters<typeof deriveCompetencyStates>[3]) =>
    deriveCompetencyStates(events, undefined, {}, options).find(s => s.competency === COMP)!.status;

  it('tutor used once does not block later unaided evidence from reaching mastered', () => {
    const tutorExchanges = [
      { id: 'x1', runId: 'r-a1', competencyIds: [COMP], assisted: true, levelUsed: 2 },
    ] as unknown as NonNullable<Parameters<typeof deriveCompetencyStates>[3]>['tutorExchanges'];
    const events = [
      mk('a1', 0, 'ctx-help', { guidance: 'guided' }),
      mk('u1', 1, 'ctx-b'),
      mk('u2', 2, 'ctx-c'),
      mk('u3', 3, 'ctx-d'),
    ];
    // the assisted attempt itself is not unaided evidence
    const st = deriveCompetencyStates(events, undefined, {}, { tutorExchanges }).find(s => s.competency === COMP)!;
    expect(st.unaidedSuccessContexts).toEqual(['ctx-b', 'ctx-c', 'ctx-d']);
    expect(st.status).toBe('mastered');
  });

  it('self-marked practice cards alone cannot reach independent, even with many successes', () => {
    const events = [0, 1, 2, 3, 4, 5].map(i =>
      mk(`p${i}`, i, `card-${i}`, { sessionId: 'practice-session', confidence: 'certain' })
    );
    expect(statusOf(events)).toBe('practising');
  });

  it('one engine-graded unaided success lets self-marked evidence reach independent but not mastered', () => {
    const events = [
      mk('e1', 0, 'case-1'),
      ...[1, 2, 3, 4, 5].map(i => mk(`p${i}`, i, `card-${i}`, { sessionId: 'practice-session' })),
    ];
    expect(statusOf(events)).toBe('independent');
  });

  it('existing behaviour unchanged: engine-graded unaided successes still reach independent then mastered', () => {
    const three = [mk('e1', 0, 'c1'), mk('e2', 1, 'c2'), mk('e3', 2, 'c3')];
    expect(statusOf(three.slice(0, 2))).toBe('independent');
    expect(statusOf(three)).toBe('mastered');
  });
});
