import type { PracticeItem, ReviewGrade } from './types';
import type { LearnerApi } from '../shared/learnerApi';
import type { Confidence, EventSink, LearnerEvent } from '../shared/events';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'practice-' + Math.random().toString(36).substring(2, 15);
}

export async function recordPracticeEvidence(
  sink: EventSink,
  item: PracticeItem,
  grade: ReviewGrade,
  confidence: Confidence = 'fairly_sure',
  feedback?: string,
  now: Date = new Date(),
): Promise<void> {
  const isCorrect = grade !== 'again';
  const nowIso = now.toISOString();

  // 1. Record evidence event matching item kind
  if (item.kind === 'predict-then-reveal') {
    const event: LearnerEvent = {
      v: 1,
      id: generateUuid(),
      wallTime: nowIso,
      sessionId: 'practice-session',
      runId: `practice-${item.id}`,
      activity: 'drill',
      activityId: item.id,
      type: 'prediction',
      predictionId: item.id,
      question: item.question,
      answer: isCorrect ? item.correctAnswer : 'incorrect_choice',
      expected: item.correctAnswer,
      competency: item.competencyId,
      evidenceType: 'prediction',
      correct: isCorrect,
      confidence,
      guidance: 'independent',
      hidden: false,
    };
    await sink.record(event);
  } else if (item.kind === 'case-drill') {
    const event: LearnerEvent = {
      v: 1,
      id: generateUuid(),
      wallTime: nowIso,
      sessionId: 'practice-session',
      runId: `practice-${item.id}`,
      activity: 'drill',
      activityId: item.id,
      type: 'drill_answer',
      drillId: item.id,
      itemId: item.id,
      answer: isCorrect ? 'correct_decision' : 'incorrect_decision',
      expected: 'correct_decision',
      hintsUsed: 0,
      competency: item.competencyId,
      evidenceType: 'decision',
      correct: isCorrect,
      confidence,
      guidance: 'independent',
      hidden: false,
    };
    await sink.record(event);
  } else {
    // flashcard
    const event: LearnerEvent = {
      v: 1,
      id: generateUuid(),
      wallTime: nowIso,
      sessionId: 'practice-session',
      runId: `practice-${item.id}`,
      activity: 'drill',
      activityId: item.id,
      type: 'drill_answer',
      drillId: item.id,
      itemId: item.id,
      answer: grade,
      expected: 'good',
      hintsUsed: 0,
      competency: item.competencyId,
      evidenceType: 'recall',
      correct: isCorrect,
      confidence,
      guidance: 'independent',
      hidden: false,
    };
    await sink.record(event);
  }

  // 2. If incorrect, record mistake into the learner mistake taxonomy
  // Confidence-weighted: certain & wrong is 'major' severity, guess is 'minor'
  if (!isCorrect) {
    const severity = confidence === 'certain' ? 'major' : 'minor';
    const mistakeEvent: LearnerEvent = {
      v: 1,
      id: generateUuid(),
      wallTime: nowIso,
      sessionId: 'practice-session',
      runId: `practice-${item.id}`,
      activity: 'drill',
      activityId: item.id,
      type: 'mistake',
      mistake: `practice_lapse:${item.id}`,
      competency: item.competencyId,
      severity,
      detail: feedback ?? `Lapse on practice item from ${item.source.chapter} (page ${item.source.pageStart})`,
    };
    await sink.record(mistakeEvent);
  }
}
