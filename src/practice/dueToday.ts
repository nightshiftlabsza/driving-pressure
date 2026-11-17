import type { PracticeItem, CardState } from './types';
import { isCardDue } from './scheduler';
import {
  listDelayedRetests,
  completeDelayedRetest,
  type DelayedRetestRecord,
} from '../tutor/store';

export interface DueToday {
  reviewItems: PracticeItem[];
  retests: DelayedRetestRecord[];
  total: number;
}

/**
 * Single "due today" selector: spaced-review cards that are due, plus stored
 * delayed retests (48h after heavy tutor help, 5 days after a failed transfer case)
 * that are due and not yet completed.
 */
export function selectDueToday(params: {
  items: PracticeItem[];
  cardStates: Record<string, CardState>;
  retests: readonly DelayedRetestRecord[];
  now?: Date;
}): DueToday {
  const now = params.now ?? new Date();
  const reviewItems = params.items.filter(item => {
    const state = params.cardStates[item.id];
    if (!state || state.lastReviewed === null) return false;
    return isCardDue(state, now);
  });
  const retests = params.retests
    .filter(r => r.completedAt === null && r.dueAt <= now.getTime())
    .sort((a, b) => a.dueAt - b.dueAt);
  return { reviewItems, retests, total: reviewItems.length + retests.length };
}

/**
 * Marks due, open retests for a competency as completed. Call when the learner
 * records an unaided attempt on that competency. Returns the ids completed.
 */
export async function completeDueRetestsForCompetency(
  competencyId: string,
  passed: boolean,
  now: Date = new Date(),
): Promise<string[]> {
  const open = (await listDelayedRetests().catch(() => [] as DelayedRetestRecord[])).filter(
    r => r.completedAt === null && r.competencyId === competencyId && r.dueAt <= now.getTime(),
  );
  for (const r of open) {
    await completeDelayedRetest(r.id, passed, now.getTime());
  }
  return open.map(r => r.id);
}
