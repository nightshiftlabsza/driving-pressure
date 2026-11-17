import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildActiveCaseContext,
  buildDebriefContext,
  buildTutorContext,
  type SnapshotData,
} from '../../src/tutor/context';
import { createRealAsthmaRun } from './helpers';
import type { RunSummary } from '../../src/shared/learnerApi';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { startRun, answerPrediction } from '../../src/runtime/caseRuntime';
import { engine } from '../../src/engine/index';
import { MemoryEventSink } from '../../src/shared/eventSink';
import asthmaRaw from '../../src/cases/library/asthma-vent-01.json';
import ventHighRaw from '../../src/cases/library/vent-high-pressure-01.json';
import { ALL_LAB_EXPERIMENTS } from '../../src/lab';

describe('Tutor Context Builder (Real Data Shapes)', () => {
  it('verifies real autoPeepFixture.json and builds complete active case context', async () => {
    const run = await createRealAsthmaRun();

    const fixturePath = path.resolve(__dirname, 'fixtures/autoPeepFixture.json');
    const savedFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    expect(savedFixture.caseFile.id).toBe('asthma-vent-01');

    const built = buildActiveCaseContext(run);

    // 1. Patient information
    expect(built.contextText).toContain('Elena Rostova (synthetic)');
    expect(built.contextText).toContain('26yo F');
    expect(built.contextText).toContain('[hidden during active case: probe active]');

    // 2. Device settings as given
    expect(built.contextText).toContain('Invasive Mechanical Ventilator');
    expect(built.contextText).toContain('VC-AC');
    expect(built.contextText).toContain('PEEP: 4 cmH2O');
    expect(built.contextText).toContain('Set RR: 22 bpm');
    expect(built.contextText).toContain('Set Vt: 500 mL');

    // 3. Monitored values with units
    expect(built.contextText).toContain('cmH2O');
    expect(built.contextText).toContain('mL');
    expect(built.contextText).toContain('/min');
    expect(built.contextText).toContain('bpm');
    expect(built.contextText).toContain('mmHg');

    // 4. Last breath summary & hold manoeuvre
    expect(built.contextText).toContain('Last Completed Breath Summary');
    expect(built.contextText).toContain('Expiratory Hold: Total PEEP');
    expect(built.contextText).toContain('Auto-PEEP');

    // 5. Latest ABG with time
    expect(built.contextText).toContain('Arterial Blood Gas (ABG)');
    expect(built.contextText).toContain('Sampled at Sim Time:');
    expect(built.contextText).toContain('pH:');
    expect(built.contextText).toContain('PaCO2:');

    // 6. Ordered findings only
    expect(built.contextText).toContain('Physical Examination:');
    expect(built.contextText).not.toContain('Chest X-ray (CXR):'); // not ordered

    // 7. Forbidden phrases for hidden competency
    expect(built.forbiddenPhrases.length).toBeGreaterThan(0);
    expect(built.forbiddenPhrases).toContain('auto-PEEP');
    expect(built.forbiddenPhrases).toContain('dynamic hyperinflation');
  });

  it('fails if any monitored number in context is "--" or "undefined" while engine has a value', async () => {
    const run = await createRealAsthmaRun();
    const built = buildActiveCaseContext(run);
    const m = run.engine.monitored;

    // Check each monitored numeric field is in contextText and not "--" or "undefined"
    const numericKeys: Array<keyof typeof m> = [
      'ppeakCmH2O',
      'pmeanCmH2O',
      'peepSetCmH2O',
      'vteMl',
      'minuteVentLpm',
      'rrTotalBpm',
      'rrSpontBpm',
      'hrBpm',
      'sbpMmHg',
      'dbpMmHg',
      'mapMmHg',
      'spo2Pct',
      'temperatureC',
    ];

    for (const key of numericKeys) {
      const val = m[key];
      if (typeof val === 'number') {
        // The numeric string must be present in context
        const valStr = String(val);
        expect(
          built.contextText.includes(valStr),
          `Expected context to contain value "${valStr}" for monitored field "${key}"`
        ).toBe(true);
      }
    }

    // Explicit check: no monitored line contains "--" or "undefined"
    const monitoredSection = built.contextText
      .split('### Bedside Monitored Data')[1]
      ?.split('###')[0];
    expect(monitoredSection).toBeDefined();
    expect(monitoredSection).not.toContain('--');
    expect(monitoredSection).not.toContain('undefined');
  });

  it('builds rich debrief context from RunSummary and CaseFile', async () => {
    const run = await createRealAsthmaRun();
    const runSummary: RunSummary = {
      runId: 'run-asthma-01',
      activity: 'case',
      activityId: run.caseFile.id,
      startedAt: '2026-11-08T10:00:00Z',
      endedAt: '2026-11-08T10:20:00Z',
      outcome: 'improved',
      score: 8,
      maxScore: 10,
      predictions: [
        {
          predictionId: 'p-asthma-mechanics',
          question: 'What happens to auto-PEEP if RR is lowered?',
          answer: 'decreases',
          expected: 'decreases',
          correct: true,
          confidence: 'certain',
          competency: 'circ.auto-peep-hypotension',
        },
      ],
      rubric: [
        {
          rubricId: 'r-disconnect',
          met: true,
          critical: true,
          competency: 'circ.auto-peep-hypotension',
        },
      ],
      mistakes: [],
      ordersTimeline: [
        { simTimeSec: 20, order: 'examine' },
        { simTimeSec: 30, order: 'abg' },
      ],
    };

    const built = buildDebriefContext(runSummary, run.caseFile);

    expect(built.contextText).toContain('Case Debrief: Severe bronchospasm');
    expect(built.contextText).toContain('Key Clinical Learning Points');
    expect(built.contextText).toContain('Outcome: improved');
    expect(built.contextText).toContain('Score: 8 / 10');
    expect(built.contextText).toContain('What happens to auto-PEEP if RR is lowered?');
    expect(built.forbiddenPhrases.length).toBe(0); // Debrief has no forbidden phrases
  });

  it('confirms active-case context does not leak debrief keyPoints, summary, rubric, triggers, or prediction metadata for asthma-vent-01 and vent-high-pressure-01', async () => {
    // 1. asthma-vent-01
    const asthmaCase = CaseSchema.parse(asthmaRaw) as CaseFile;
    const asthmaRun = await createRealAsthmaRun();
    const asthmaContext = buildActiveCaseContext(asthmaRun);

    // Debrief keyPoints must not appear in active context
    expect(asthmaCase.debrief?.keyPoints).toBeDefined();
    for (const kp of asthmaCase.debrief!.keyPoints) {
      expect(asthmaContext.contextText).not.toContain(kp);
    }

    // Summary must not appear beyond what is in presenting story
    expect(asthmaContext.contextText).not.toContain(asthmaCase.summary);

    // Rubric descriptions must not appear in active context
    if (asthmaCase.rubric) {
      for (const r of asthmaCase.rubric) {
        expect(asthmaContext.contextText).not.toContain(r.description);
      }
    }

    // Triggers must not appear in active context
    if (asthmaCase.triggers) {
      for (const t of asthmaCase.triggers) {
        expect(asthmaContext.contextText).not.toContain(t.id);
      }
    }

    // Prediction metadata (explanations, answers) must not appear
    if (asthmaCase.predictionPoints) {
      for (const p of asthmaCase.predictionPoints) {
        if (p.explanation) {
          expect(asthmaContext.contextText).not.toContain(p.explanation);
        }
      }
    }

    // 2. vent-high-pressure-01
    const ventHighCase = CaseSchema.parse(ventHighRaw) as CaseFile;
    const sink = new MemoryEventSink();
    const rt = { engine, sink };
    const ventHighRun = await startRun(rt, ventHighCase, { sessionId: 'test-session-high-pressure' });

    // Populate a prediction result to ensure formatPredictions runs with answered predictions
    ventHighRun.predictionResults = [
      {
        predictionId: 'p-pneumo-response',
        answer: { ppeak: 'down', sbp: 'up', spo2: 'up' },
        expected: { ppeak: 'down', sbp: 'up', spo2: 'up' },
        correct: true,
        confidence: 'certain',
      },
    ];

    const ventHighContext = buildActiveCaseContext(ventHighRun);

    // Debrief keyPoints must not appear in active context
    expect(ventHighCase.debrief?.keyPoints).toBeDefined();
    for (const kp of ventHighCase.debrief!.keyPoints) {
      expect(ventHighContext.contextText).not.toContain(kp);
    }

    // Summary must not appear in active context
    expect(ventHighContext.contextText).not.toContain(ventHighCase.summary);

    // Rubric descriptions must not appear in active context
    if (ventHighCase.rubric) {
      for (const r of ventHighCase.rubric) {
        expect(ventHighContext.contextText).not.toContain(r.description);
      }
    }

    // Triggers must not appear in active context
    if (ventHighCase.triggers) {
      for (const t of ventHighCase.triggers) {
        expect(ventHighContext.contextText).not.toContain(t.id);
      }
    }

    // Prediction metadata (explanations, options) must not appear
    if (ventHighCase.predictionPoints) {
      for (const p of ventHighCase.predictionPoints) {
        if (p.explanation) {
          expect(ventHighContext.contextText).not.toContain(p.explanation);
        }
        if (p.options) {
          for (const opt of p.options) {
            // Options as a list should not be in the context
            expect(ventHighContext.contextText).not.toContain(opt);
          }
        }
      }
    }
  });

  describe('Lab, Practice, and Pathway Contexts (Phase 9)', () => {
    const mockExperiment = ALL_LAB_EXPERIMENTS[0];
    const correctOptText = mockExperiment.reflection.options.find(
      o => o.id === mockExperiment.reflection.correctOptionId
    )!.text;

    it('buildLabContext locks Why trace and reflection explanation when uncommitted', () => {
      const locked = buildTutorContext(
        {
          experiment: mockExperiment,
          stage: 'observe',
          committed: false,
          baselineMonitored: { ppeakCmH2O: 35 },
        },
        'lab'
      );

      // Must have experiment title and patient
      expect(locked.contextText).toContain(mockExperiment.title);
      expect(locked.contextText).toContain('UNCOMMITTED - DO NOT REVEAL');
      // Must NOT contain causal why trace or reflection explanation in text
      expect(locked.contextText).not.toContain(mockExperiment.reflection.explanation);
      expect(locked.contextText).not.toContain(correctOptText);
      // Forbidden phrases must contain the reflection explanation and correct answer
      expect(locked.forbiddenPhrases).toContain(mockExperiment.reflection.explanation);
      expect(locked.forbiddenPhrases).toContain(correctOptText);
    });

    it('buildLabContext provides causal Why trace and explanation when committed', () => {
      const unlocked = buildTutorContext(
        {
          experiment: mockExperiment,
          stage: 'reflect',
          committed: true,
          baselineMonitored: { ppeakCmH2O: 35 },
          afterMonitored: { ppeakCmH2O: 24 },
          learnerPrediction: { endExpFlow: 'down', ppeak: 'down' },
        },
        'lab'
      );

      expect(unlocked.contextText).toContain('Causal Physiological Trace');
      expect(unlocked.contextText).toContain(mockExperiment.reflection.explanation);
      expect(unlocked.forbiddenPhrases.length).toBe(0);
    });

    it('buildPracticeContext locks correct answer and explanation for predict-then-reveal item when unrevealed', () => {
      const ptrItem = {
        id: 'ptr-01',
        kind: 'predict-then-reveal' as const,
        source: { file: 'textbook.pdf', chapter: 'Asthma', pageStart: 1, pageEnd: 5 },
        competencyId: 'mech.auto-peep',
        difficulty: 2 as const,
        tags: ['asthma', 'auto-peep'],
        scenario: 'A 28yo asthmatic is ventilated at RR 24.',
        question: 'What is the immediate maneuver to measure auto-PEEP?',
        options: ['Inspiratory hold', 'Expiratory hold', 'Increase PEEP'],
        correctAnswer: 'Expiratory hold',
        explanation: 'An expiratory hold closes both valves at end-expiration allowing alveolar pressure to equilibrate.',
      };

      const locked = buildTutorContext({ item: ptrItem, revealed: false }, 'practice');
      expect(locked.contextText).toContain('UNCOMMITTED / HIDDEN');
      expect(locked.contextText).not.toContain('An expiratory hold closes both valves');
      expect(locked.forbiddenPhrases).toContain(ptrItem.correctAnswer);
      expect(locked.forbiddenPhrases).toContain(ptrItem.explanation);

      const revealed = buildTutorContext({ item: ptrItem, revealed: true, learnerAnswer: 'Expiratory hold' }, 'practice');
      expect(revealed.contextText).toContain('REVEALED / ANSWERED');
      expect(revealed.contextText).toContain(ptrItem.correctAnswer);
      expect(revealed.contextText).toContain(ptrItem.explanation);
      expect(revealed.forbiddenPhrases.length).toBe(0);
    });

    it('buildPracticeContext locks back of flashcard when unrevealed', () => {
      const flashcard = {
        id: 'fc-01',
        kind: 'flashcard' as const,
        source: { file: 'textbook.pdf', chapter: 'Driving Pressure', pageStart: 10, pageEnd: 12 },
        competencyId: 'mech.driving-pressure',
        difficulty: 1 as const,
        tags: ['ards'],
        front: 'What is the formula for driving pressure in volume control?',
        back: 'Driving Pressure = Pplat - PEEP',
      };

      const locked = buildTutorContext({ item: flashcard, revealed: false }, 'practice');
      expect(locked.contextText).not.toContain('Driving Pressure = Pplat - PEEP');
      expect(locked.forbiddenPhrases).toContain('Driving Pressure = Pplat - PEEP');

      const revealed = buildTutorContext({ item: flashcard, revealed: true }, 'practice');
      expect(revealed.contextText).toContain('Driving Pressure = Pplat - PEEP');
      expect(revealed.forbiddenPhrases.length).toBe(0);
    });

    it('buildPathwayContext provides stage, unlocked list, and recommendations', () => {
      const pathwayCtx = buildTutorContext(
        {
          currentStageId: 'stage-2-mechanics',
          unlockedStages: ['stage-1-foundations', 'stage-2-mechanics'],
          recommendedActivity: { type: 'case', id: 'ards-vent-01', title: 'Severe ARDS Management' },
          competencySummary: [{ competency: 'mech.auto-peep', status: 'practising', guidance: 'prompted' }],
        },
        'pathway'
      );

      expect(pathwayCtx.contextText).toContain('Current Stage: stage-2-mechanics');
      expect(pathwayCtx.contextText).toContain('Severe ARDS Management (ards-vent-01)');
      expect(pathwayCtx.contextText).toContain('mech.auto-peep: practising (Guidance: prompted)');
    });

    it('buildLabContext keeps reflection MCQ answer locked after prediction commit until reflectionSubmitted', () => {
      const midStage = buildTutorContext(
        {
          experiment: mockExperiment,
          stage: 'observe',
          committed: true,
          reflectionSubmitted: false,
          baselineMonitored: { ppeakCmH2O: 35 },
          afterMonitored: { ppeakCmH2O: 24 },
          whyNodesText: '- Peak Pressure: 35 -> 24 (down)',
        },
        'lab'
      );

      expect(midStage.contextText).toContain('Causal Why Trace');
      expect(midStage.contextText).toContain('Peak Pressure: 35 -> 24');
      expect(midStage.contextText).toContain('Reflection Question (UNCOMMITTED - DO NOT REVEAL)');
      expect(midStage.contextText).not.toContain(mockExperiment.reflection.explanation);
      expect(midStage.forbiddenPhrases).toContain(mockExperiment.reflection.explanation);
      expect(midStage.forbiddenPhrases).toContain(correctOptText);
    });

    it('buildPracticeContext handles multi-step case-drill locking per step', () => {
      const drillItem = {
        id: 'drill-01',
        kind: 'case-drill' as const,
        source: { file: 'textbook.pdf', chapter: 'ARDS', pageStart: 1, pageEnd: 3 },
        competencyId: 'disease.ards',
        difficulty: 2 as const,
        tags: ['ards'],
        vignette: 'Intubated ARDS patient.',
        steps: [
          {
            stepNumber: 1,
            prompt: 'Step 1 prompt',
            options: [
              { text: 'Set 6 mL/kg PBW', isCorrect: true, feedback: 'Correct PBW dosing.' },
              { text: 'Set 10 mL/kg actual', isCorrect: false, feedback: 'Excessive volume.' },
            ],
          },
          {
            stepNumber: 2,
            prompt: 'Step 2 prompt',
            options: [
              { text: 'Check plateau pressure', isCorrect: true, feedback: 'Confirm Pplat <= 30.' },
              { text: 'Ignore pressures', isCorrect: false, feedback: 'Unsafe.' },
            ],
          },
        ],
      };

      const step0Locked = buildTutorContext(
        { item: drillItem, revealed: false, currentStepIndex: 0, stepRevealed: false },
        'practice'
      );
      expect(step0Locked.contextText).toContain('Step 1 prompt');
      expect(step0Locked.forbiddenPhrases).toContain('Set 6 mL/kg PBW');
      expect(step0Locked.forbiddenPhrases).toContain('Check plateau pressure');

      const step1Locked = buildTutorContext(
        { item: drillItem, revealed: false, currentStepIndex: 1, stepRevealed: false },
        'practice'
      );
      expect(step1Locked.contextText).toContain('Completed Prior Steps');
      expect(step1Locked.contextText).toContain('Step 2 prompt');
      expect(step1Locked.forbiddenPhrases).toContain('Check plateau pressure');
      expect(step1Locked.forbiddenPhrases).toContain('Confirm Pplat <= 30.');
    });

    it('ensures every competency in competencies.json has >= 3 forbidden terms', async () => {
      const compJson = (await import('../../src/shared/competencies.json')).default;
      const { FORBIDDEN_TERMS_BY_COMPETENCY } = await import('../../src/tutor/forbiddenTerms');
      for (const domain of compJson.domains) {
        for (const comp of domain.competencies) {
          const terms = FORBIDDEN_TERMS_BY_COMPETENCY[comp.id];
          expect(terms, `Missing forbidden terms for ${comp.id}`).toBeDefined();
          expect(terms.length).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('pre-computes derived physiological indices and unaccountedAbnormalities from engine outputs', async () => {
      const run = await createRealAsthmaRun();
      const built = buildActiveCaseContext(run, {
        observation: 'Peak pressure is 38 cmH2O and SpO2 is 90%.',
        mechanismHypothesis: 'Maybe stiff lungs are raising pressure.',
        confidence: 'fairly_sure',
        maneuversPerformed: ['expiratory_hold'],
        attemptNumberInProblem: 1,
        latencyMs: 10000,
      });

      expect(built.derivedIndices).toBeDefined();
      expect(built.derivedIndices!.pbwKg).toBeGreaterThan(40);
      expect(built.derivedIndices!.pfRatio).toBeGreaterThan(0);
      expect(built.derivedIndices!.aaGradientMmHg).not.toBeNull();
      expect(built.verifiedEngineNumbers).toBeDefined();
      expect(built.activeAbnormalities).toContain('auto_peep');
      expect(built.unaccountedAbnormalities).toContain('auto_peep');
      expect(built.contextText).toContain('Pre-Computed Physiological Indices');
      expect(built.contextText).toContain('Unaccounted Abnormalities');
    });
  });
});
