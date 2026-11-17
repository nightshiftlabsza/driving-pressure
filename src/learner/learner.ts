/**
 * LearnerApi implementation: wires storage, event validation, and derivation functions.
 */
import type { LearnerEvent, GuidanceLevel } from '../shared/events';
import type {
  LearnerApi,
  CompetencyStateV2,
  RunSummary,
  ActivityCandidate,
  Recommendation,
} from '../shared/learnerApi';
import { isEvidenceEvent } from '../shared/events';
import { completeDueRetestsForCompetency } from '../practice/dueToday';
import { isSelfMarkedEvidence } from './derivation';
import type { StorageAdapter } from './storage';
import { IndexedDbStorage } from './storage';
import { validateLearnerEvent, validateExportPayload } from './validation';
import { deriveCompetencyStates, deriveRun, recommend } from './derivation';
import {
  listTutorExchanges,
  listDelayedRetests,
  clearTutorExchanges,
  saveTutorExchange,
  scheduleDelayedRetest,
  type TutorExchangeRecord,
  type DelayedRetestRecord,
} from '../tutor/store';
import {
  clearRewindMetadata,
  listAllRewindMetadata,
  replaceAllRewindMetadata,
  type RewindMetadata,
} from '../review/rewind';

export class LearnerModel implements LearnerApi {
  constructor(private storage: StorageAdapter) {}

  async record(e: LearnerEvent): Promise<void> {
    validateLearnerEvent(e);
    // Deep clone to prevent any external mutation
    const cloned = JSON.parse(JSON.stringify(e)) as LearnerEvent;
    await this.storage.appendEvent(cloned);
    // Finishing an unaided attempt on a competency completes its due delayed retest(s).
    if (isEvidenceEvent(cloned) && cloned.competency && cloned.assistance?.assistedInWindow !== true && !isSelfMarkedEvidence(cloned)) {
      await completeDueRetestsForCompetency(cloned.competency, cloned.correct, new Date(cloned.wallTime)).catch(
        () => [],
      );
    }
  }

  async getCompetencyStates(now?: Date): Promise<CompetencyStateV2[]> {
    const events = await this.storage.getEvents();
    const overrides = (await this.storage.getMeta<Record<string, GuidanceLevel>>('guidanceOverrides')) ?? {};
    const [tutorExchanges, delayedRetests] = await Promise.all([
      listTutorExchanges().catch(() => []),
      listDelayedRetests().catch(() => []),
    ]);
    return deriveCompetencyStates(events, now, overrides, {
      tutorExchanges,
      delayedRetests,
    });
  }

  async setGuidanceOverride(competency: string, level: GuidanceLevel | null): Promise<void> {
    const overrides = (await this.storage.getMeta<Record<string, GuidanceLevel>>('guidanceOverrides')) ?? {};
    if (level === null) {
      delete overrides[competency];
    } else {
      overrides[competency] = level;
    }
    await this.storage.setMeta('guidanceOverrides', overrides);
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const events = await this.storage.getEvents();
    return deriveRun(events, runId);
  }

  async listRuns(limit?: number): Promise<RunSummary[]> {
    const events = await this.storage.getEvents();
    const runIds: string[] = [];
    const seen = new Set<string>();

    for (const ev of events) {
      if (ev.runId && !seen.has(ev.runId)) {
        seen.add(ev.runId);
        runIds.push(ev.runId);
      }
    }

    const runs = runIds
      .map(id => deriveRun(events, id))
      .filter((r): r is RunSummary => r !== null)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return limit !== undefined && limit > 0 ? runs.slice(0, limit) : runs;
  }

  async recommend(candidates: ActivityCandidate[], now?: Date): Promise<Recommendation[]> {
    const events = await this.storage.getEvents();
    const overrides = (await this.storage.getMeta<Record<string, GuidanceLevel>>('guidanceOverrides')) ?? {};
    const [tutorExchanges, delayedRetests] = await Promise.all([
      listTutorExchanges().catch(() => []),
      listDelayedRetests().catch(() => []),
    ]);
    const states = deriveCompetencyStates(events, now, overrides, {
      tutorExchanges,
      delayedRetests,
    });
    const recentRuns = await this.listRuns(5);
    return recommend(states, candidates, recentRuns, now ?? new Date(), events);
  }

  async exportJson(): Promise<string> {
    const events = await this.storage.getEvents();
    const overrides = (await this.storage.getMeta<Record<string, GuidanceLevel>>('guidanceOverrides')) ?? {};
    const practiceCards = (await this.storage.getMeta<Record<string, unknown>>('practiceCardStates')) ?? {};
    const exchanges = await listTutorExchanges().catch(() => []);
    const retests = await listDelayedRetests().catch(() => []);
    const rewindMeta = listAllRewindMetadata();
    const payload: {
      format: 'ovs-learner';
      version: number;
      exportedAt: string;
      events: LearnerEvent[];
      guidanceOverrides?: Record<string, GuidanceLevel>;
      practiceCardStates?: Record<string, unknown>;
      tutorExchanges?: unknown[];
      delayedRetests?: unknown[];
      rewindMetadata?: Record<string, RewindMetadata>;
    } = {
      format: 'ovs-learner',
      version: 1,
      exportedAt: new Date().toISOString(),
      events,
    };
    if (Object.keys(overrides).length > 0) {
      payload.guidanceOverrides = overrides;
    }
    if (Object.keys(practiceCards).length > 0) {
      payload.practiceCardStates = practiceCards;
    }
    if (exchanges.length > 0) {
      payload.tutorExchanges = exchanges;
    }
    if (retests.length > 0) {
      payload.delayedRetests = retests;
    }
    if (Object.keys(rewindMeta).length > 0) {
      payload.rewindMetadata = rewindMeta;
    }
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Imports a JSON export payload created by exportJson.
   * Validates the schema and every event shape. On successful validation,
   * completely replaces all existing events and metadata in storage.
   * If validation fails, throws an error and leaves stored data untouched.
   */
  async importJson(json: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Malformed JSON: cannot parse JSON string');
    }

    const validated = validateExportPayload(parsed);
    // Replace all events in storage
    await this.storage.replaceEvents(validated.events);
    if (validated.guidanceOverrides) {
      await this.storage.setMeta('guidanceOverrides', validated.guidanceOverrides);
    } else {
      await this.storage.deleteMeta('guidanceOverrides');
    }
    if (validated.practiceCardStates) {
      await this.storage.setMeta('practiceCardStates', validated.practiceCardStates);
    } else {
      await this.storage.deleteMeta('practiceCardStates');
    }

    await clearTutorExchanges().catch(() => {});
    if (validated.tutorExchanges && Array.isArray(validated.tutorExchanges)) {
      for (const ex of validated.tutorExchanges) {
        await saveTutorExchange(ex as TutorExchangeRecord).catch(() => {});
      }
    }
    if (validated.delayedRetests && Array.isArray(validated.delayedRetests)) {
      for (const ret of validated.delayedRetests) {
        await scheduleDelayedRetest(ret as DelayedRetestRecord).catch(() => {});
      }
    }
    if (validated.rewindMetadata && typeof validated.rewindMetadata === 'object') {
      replaceAllRewindMetadata(validated.rewindMetadata as Record<string, RewindMetadata>);
    } else {
      clearRewindMetadata();
    }
  }

  async getPracticeCardStates(): Promise<Record<string, unknown>> {
    return (await this.storage.getMeta<Record<string, unknown>>('practiceCardStates')) ?? {};
  }

  async savePracticeCardStates(states: Record<string, unknown>): Promise<void> {
    await this.storage.setMeta('practiceCardStates', states);
  }

  async resetAll(): Promise<void> {
    await this.storage.clearAll();
    await clearTutorExchanges().catch(() => {});
    clearRewindMetadata();
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('ovs_pathway_browse_all');
        localStorage.removeItem('ovs_setting_loop_v1');
      } catch {
        // ignore
      }
    }
  }
}

export function createLearner(storage: StorageAdapter = new IndexedDbStorage()): LearnerApi {
  return new LearnerModel(storage);
}
