import type { CardState, ReviewGrade, PracticeItem, PracticeSession, PracticeSessionItem } from './types';

export const DEFAULT_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;
export const MAX_EASE_FACTOR = 3.0;

export function formatDateIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateIso(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

export function createInitialCardState(itemId: string, initialDueDate?: string): CardState {
  return {
    itemId,
    intervalDays: 0,
    repetitions: 0,
    easeFactor: DEFAULT_EASE_FACTOR,
    dueDate: initialDueDate ?? formatDateIso(new Date()),
    lastReviewed: null,
    lapseCount: 0,
    history: [],
  };
}

export function scheduleNextReview(card: CardState, grade: ReviewGrade, now: Date): CardState {
  let intervalDays: number;
  let repetitions: number;
  let easeFactor = card.easeFactor;
  let lapseCount = card.lapseCount;

  if (grade === 'again') {
    repetitions = 0;
    intervalDays = 1;
    lapseCount += 1;
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
  } else if (grade === 'hard') {
    repetitions = card.repetitions + 1;
    if (card.repetitions === 0) {
      intervalDays = 1;
    } else if (card.repetitions === 1) {
      intervalDays = 2;
    } else {
      intervalDays = Math.max(card.intervalDays + 1, Math.round(card.intervalDays * 1.2));
    }
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.15);
  } else if (grade === 'good') {
    repetitions = card.repetitions + 1;
    if (card.repetitions === 0) {
      intervalDays = 1;
    } else if (card.repetitions === 1) {
      intervalDays = 3;
    } else {
      intervalDays = Math.max(card.intervalDays + 2, Math.round(card.intervalDays * easeFactor));
    }
  } else {
    // 'easy'
    repetitions = card.repetitions + 1;
    if (card.repetitions === 0) {
      intervalDays = 3;
    } else if (card.repetitions === 1) {
      intervalDays = 7;
    } else {
      intervalDays = Math.max(card.intervalDays + 4, Math.round(card.intervalDays * easeFactor * 1.3));
    }
    easeFactor = Math.min(MAX_EASE_FACTOR, easeFactor + 0.15);
  }

  const nextDue = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  const updatedHistory = [
    ...(card.history ?? []),
    {
      reviewedAt: now.toISOString(),
      grade,
    },
  ];

  return {
    itemId: card.itemId,
    intervalDays,
    repetitions,
    easeFactor: Math.round(easeFactor * 100) / 100,
    dueDate: formatDateIso(nextDue),
    lastReviewed: now.toISOString(),
    lapseCount,
    history: updatedHistory,
  };
}

export function isCardDue(card: CardState, now: Date): boolean {
  const todayStr = formatDateIso(now);
  return card.dueDate <= todayStr;
}

export interface BuildSessionOptions {
  maxDue?: number;
  maxNew?: number;
  sourceFile?: string;
  chapter?: string;
  competencyId?: string;
}

export function buildPracticeSession(
  items: PracticeItem[],
  cardStates: Record<string, CardState>,
  now: Date,
  options?: BuildSessionOptions,
): PracticeSession {
  const maxDue = options?.maxDue ?? 20;
  const maxNew = options?.maxNew ?? 10;

  // Filter items
  let filtered = items;
  if (options?.sourceFile) {
    filtered = filtered.filter(i => i.source.file === options.sourceFile);
  }
  if (options?.chapter) {
    filtered = filtered.filter(i => i.source.chapter === options.chapter);
  }
  if (options?.competencyId) {
    filtered = filtered.filter(i => i.competencyId === options.competencyId);
  }

  const dueItems: PracticeSessionItem[] = [];
  const newItems: PracticeSessionItem[] = [];

  for (const item of filtered) {
    const existingState = cardStates[item.id];
    if (!existingState || existingState.lastReviewed === null) {
      newItems.push({
        item,
        cardState: existingState ?? createInitialCardState(item.id, formatDateIso(now)),
        isNew: true,
      });
    } else if (isCardDue(existingState, now)) {
      dueItems.push({
        item,
        cardState: existingState,
        isNew: false,
      });
    }
  }

  // Sort due items by dueDate ascending (oldest due first)
  dueItems.sort((a, b) => a.cardState.dueDate.localeCompare(b.cardState.dueDate));

  // Take up to maxDue and maxNew
  const selectedDue = dueItems.slice(0, maxDue);
  const selectedNew = newItems.slice(0, maxNew);

  const sessionItems = [...selectedDue, ...selectedNew];

  return {
    id: `session-${now.getTime()}`,
    startedAt: now.toISOString(),
    items: sessionItems,
    currentIndex: 0,
    completedItemIds: [],
  };
}
