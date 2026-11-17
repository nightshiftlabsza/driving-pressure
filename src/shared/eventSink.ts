import type { EventSink, LearnerEvent } from './events';

/** In-memory sink for tests and for running before the learner store exists. */
export class MemoryEventSink implements EventSink {
  readonly events: LearnerEvent[] = [];
  async record(e: LearnerEvent): Promise<void> { this.events.push(e); }
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
