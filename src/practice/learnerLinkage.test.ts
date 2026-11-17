import { describe, it, expect } from 'vitest';
import { recordPracticeEvidence } from './learnerLinkage';
import { LearnerModel } from '../learner/learner';
import { MemoryStorage } from '../learner/storage';
import type { PredictThenRevealItem, FlashcardItem } from './types';
import type { LearnerEvent } from '../shared/events';

describe('Practice Learner Linkage', () => {
  it('records prediction evidence and creates a major mistake for confident wrong answers', async () => {
    const storage = new MemoryStorage();
    const learner = new LearnerModel(storage);

    const item: PredictThenRevealItem = {
      id: 'test-ptr-1',
      kind: 'predict-then-reveal',
      source: { file: 'test.pdf', chapter: 'Ch 1', pageStart: 1, pageEnd: 2 },
      competencyId: 'mech.driving-pressure',
      difficulty: 2,
      tags: ['test'],
      scenario: 'Patient on VC-AC has Pplat 32 and PEEP 12.',
      question: 'What is the driving pressure?',
      correctAnswer: '20 cmH2O',
      explanation: 'Driving pressure is Pplat - PEEP = 32 - 12 = 20.',
    };

    // Confident wrong answer (Again with 'certain' confidence)
    await recordPracticeEvidence(learner, item, 'again', 'certain', 'Calculated 44 instead of 20');

    const events = await storage.getEvents();
    expect(events).toHaveLength(2);

    // Event 1: prediction event
    const predEvent = events[0] as Extract<LearnerEvent, { type: 'prediction' }>;
    expect(predEvent.type).toBe('prediction');
    expect(predEvent.competency).toBe('mech.driving-pressure');
    expect(predEvent.correct).toBe(false);
    expect(predEvent.confidence).toBe('certain');

    // Event 2: mistake event
    const mistakeEvent = events[1] as Extract<LearnerEvent, { type: 'mistake' }>;
    expect(mistakeEvent.type).toBe('mistake');
    expect(mistakeEvent.competency).toBe('mech.driving-pressure');
    expect(mistakeEvent.severity).toBe('major');
    expect(mistakeEvent.detail).toContain('Calculated 44');
  });

  it('records recall evidence with no mistake on correct good response', async () => {
    const storage = new MemoryStorage();
    const learner = new LearnerModel(storage);

    const item: FlashcardItem = {
      id: 'test-card-1',
      kind: 'flashcard',
      source: { file: 'test.pdf', chapter: 'Ch 1', pageStart: 1, pageEnd: 2 },
      competencyId: 'gas.alveolar-ventilation',
      difficulty: 1,
      tags: ['test'],
      front: 'What determines PaCO2?',
      back: 'Alveolar minute ventilation.',
    };

    await recordPracticeEvidence(learner, item, 'good', 'fairly_sure');

    const events = await storage.getEvents();
    expect(events).toHaveLength(1);

    const drillEvent = events[0] as Extract<LearnerEvent, { type: 'drill_answer' }>;
    expect(drillEvent.type).toBe('drill_answer');
    expect(drillEvent.competency).toBe('gas.alveolar-ventilation');
    expect(drillEvent.correct).toBe(true);
  });
});
