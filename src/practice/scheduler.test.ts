import { describe, it, expect } from 'vitest';
import {
  scheduleNextReview,
  createInitialCardState,
  isCardDue,
  buildPracticeSession,
  formatDateIso,
  parseDateIso,
  DEFAULT_EASE_FACTOR,
} from './scheduler';
import type { CardState, PracticeItem } from './types';

describe('Spaced Repetition Scheduler', () => {
  const baseDate = new Date('2026-11-10T12:00:00Z');

  it('creates initial card state with due date today', () => {
    const card = createInitialCardState('test-item-1', '2026-11-10');
    expect(card.itemId).toBe('test-item-1');
    expect(card.repetitions).toBe(0);
    expect(card.intervalDays).toBe(0);
    expect(card.easeFactor).toBe(DEFAULT_EASE_FACTOR);
    expect(card.dueDate).toBe('2026-11-10');
    expect(card.lastReviewed).toBeNull();
    expect(card.lapseCount).toBe(0);
  });

  it('handles "good" progression deterministically without Date.now()', () => {
    let card = createInitialCardState('item-1');

    // Review 1: Good -> interval 1 day
    card = scheduleNextReview(card, 'good', baseDate);
    expect(card.repetitions).toBe(1);
    expect(card.intervalDays).toBe(1);
    expect(card.dueDate).toBe('2026-11-11');
    expect(card.lastReviewed).toBe(baseDate.toISOString());

    // Review 2: Good -> interval 3 days
    const nextDate = new Date('2026-11-11T12:00:00Z');
    card = scheduleNextReview(card, 'good', nextDate);
    expect(card.repetitions).toBe(2);
    expect(card.intervalDays).toBe(3);
    expect(card.dueDate).toBe('2026-11-14');

    // Review 3: Good -> interval = round(3 * 2.5) = 8 days
    const thirdDate = new Date('2026-11-14T12:00:00Z');
    card = scheduleNextReview(card, 'good', thirdDate);
    expect(card.repetitions).toBe(3);
    expect(card.intervalDays).toBe(8);
    expect(card.dueDate).toBe('2026-11-22');
  });

  it('handles "easy" progression with accelerated intervals and higher ease factor', () => {
    let card = createInitialCardState('item-easy');

    // Review 1: Easy -> interval 3 days
    card = scheduleNextReview(card, 'easy', baseDate);
    expect(card.repetitions).toBe(1);
    expect(card.intervalDays).toBe(3);
    expect(card.easeFactor).toBeGreaterThan(DEFAULT_EASE_FACTOR);

    // Review 2: Easy -> interval 7 days
    const date2 = new Date('2026-11-13T12:00:00Z');
    card = scheduleNextReview(card, 'easy', date2);
    expect(card.repetitions).toBe(2);
    expect(card.intervalDays).toBe(7);
  });

  it('handles "again" lapse by resetting repetitions and incrementing lapse count', () => {
    let card = createInitialCardState('item-lapse');
    card = scheduleNextReview(card, 'good', baseDate);
    card = scheduleNextReview(card, 'good', new Date('2026-11-11T12:00:00Z'));
    expect(card.repetitions).toBe(2);

    // Fail item
    const failDate = new Date('2026-11-14T12:00:00Z');
    card = scheduleNextReview(card, 'again', failDate);
    expect(card.repetitions).toBe(0);
    expect(card.intervalDays).toBe(1);
    expect(card.lapseCount).toBe(1);
    expect(card.dueDate).toBe('2026-11-15');
    expect(card.easeFactor).toBeLessThan(DEFAULT_EASE_FACTOR);
  });

  it('correctly determines whether a card is due', () => {
    const cardPast: CardState = {
      itemId: 'card-1',
      intervalDays: 1,
      repetitions: 1,
      easeFactor: 2.5,
      dueDate: '2026-11-09',
      lastReviewed: '2026-11-08T12:00:00Z',
      lapseCount: 0,
    };
    const cardToday: CardState = {
      ...cardPast,
      itemId: 'card-2',
      dueDate: '2026-11-10',
    };
    const cardFuture: CardState = {
      ...cardPast,
      itemId: 'card-3',
      dueDate: '2026-11-11',
    };

    expect(isCardDue(cardPast, baseDate)).toBe(true);
    expect(isCardDue(cardToday, baseDate)).toBe(true);
    expect(isCardDue(cardFuture, baseDate)).toBe(false);
  });

  it('builds practice session prioritising due items then new items', () => {
    const mockItems: PracticeItem[] = [
      {
        id: 'item-due-old',
        kind: 'flashcard',
        source: { file: 'test.pdf', chapter: 'Ch 1', pageStart: 1, pageEnd: 2 },
        competencyId: 'mech.eom',
        difficulty: 1,
        tags: ['test'],
        front: 'Front 1',
        back: 'Back 1',
      },
      {
        id: 'item-due-today',
        kind: 'flashcard',
        source: { file: 'test.pdf', chapter: 'Ch 1', pageStart: 1, pageEnd: 2 },
        competencyId: 'mech.eom',
        difficulty: 1,
        tags: ['test'],
        front: 'Front 2',
        back: 'Back 2',
      },
      {
        id: 'item-new',
        kind: 'flashcard',
        source: { file: 'test.pdf', chapter: 'Ch 1', pageStart: 1, pageEnd: 2 },
        competencyId: 'mech.eom',
        difficulty: 1,
        tags: ['test'],
        front: 'Front 3',
        back: 'Back 3',
      },
    ];

    const cardStates: Record<string, CardState> = {
      'item-due-old': {
        itemId: 'item-due-old',
        intervalDays: 1,
        repetitions: 1,
        easeFactor: 2.5,
        dueDate: '2026-11-08',
        lastReviewed: '2026-11-07T12:00:00Z',
        lapseCount: 0,
      },
      'item-due-today': {
        itemId: 'item-due-today',
        intervalDays: 3,
        repetitions: 2,
        easeFactor: 2.5,
        dueDate: '2026-11-10',
        lastReviewed: '2026-11-07T12:00:00Z',
        lapseCount: 0,
      },
    };

    const session = buildPracticeSession(mockItems, cardStates, baseDate, { maxDue: 10, maxNew: 5 });
    expect(session.items).toHaveLength(3);
    // Oldest due comes first
    expect(session.items[0].item.id).toBe('item-due-old');
    expect(session.items[0].isNew).toBe(false);
    expect(session.items[1].item.id).toBe('item-due-today');
    expect(session.items[1].isNew).toBe(false);
    // New item comes after due
    expect(session.items[2].item.id).toBe('item-new');
    expect(session.items[2].isNew).toBe(true);
  });

  it('enforces SM-2 mathematical invariants: EF floor at 1.30 and monotonic intervals under good reviews', () => {
    let card = createInitialCardState('item-boundary');

    // Repeated failures must never drop ease factor below 1.30
    let currDate = new Date(baseDate);
    for (let i = 0; i < 15; i++) {
      card = scheduleNextReview(card, 'again', currDate);
      expect(card.easeFactor).toBeGreaterThanOrEqual(1.30);
      currDate = new Date(currDate.getTime() + 86400000);
    }
    expect(card.easeFactor).toBe(1.30);

    // Repeated good reviews must produce strictly non-decreasing intervals
    let lastInterval = card.intervalDays;
    for (let i = 0; i < 6; i++) {
      card = scheduleNextReview(card, 'good', currDate);
      expect(card.intervalDays).toBeGreaterThanOrEqual(lastInterval);
      lastInterval = card.intervalDays;
      currDate = new Date(currDate.getTime() + lastInterval * 86400000);
    }
  });
});
