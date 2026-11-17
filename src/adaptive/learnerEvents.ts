import type { LearnerEvent } from '../shared/events';
import type { LearnerApi } from '../shared/learnerApi';

interface LearnerWithEvents {
  getRecordedEvents?: () => LearnerEvent[];
  storage?: {
    getEvents?: () => Promise<LearnerEvent[]>;
  };
}

/**
 * Reads recorded LearnerEvent history from either LearnerModel storage or FakeLearner
 * without invoking exportJson() (preserving export spy semantics in tests).
 */
export async function readLearnerEvents(learner: LearnerApi | null | undefined): Promise<LearnerEvent[]> {
  if (!learner) return [];
  const candidate = learner as unknown as LearnerWithEvents;
  if (typeof candidate.getRecordedEvents === 'function') {
    const evs = candidate.getRecordedEvents();
    return Array.isArray(evs) ? evs : [];
  }
  if (candidate.storage && typeof candidate.storage.getEvents === 'function') {
    try {
      const evs = await candidate.storage.getEvents();
      return Array.isArray(evs) ? evs : [];
    } catch {
      return [];
    }
  }
  return [];
}
