/**
 * Rewind logic and storage: prepares snapshot state for resuming a case from any decision.
 * Links the new attempt to the parent run via our own internal metadata store (rewindOf),
 * strictly preserving shared contracts and frozen event types.
 */
import type { CaseFile } from '../shared/caseSchema';
import { newId } from '../shared/eventSink';
import type { RunState } from '../runtime/caseRuntime';
import type { ReplayDecisionPoint } from './types';

export interface RewindMetadata {
  rewindRunId: string;
  parentRunId: string;
  caseId: string;
  rewindAtSimSec: number;
  decisionIndex: number;
  createdAt: string;
}

const REWIND_STORAGE_KEY = 'ovs_rewind_meta_v1';
const PENDING_REWIND_KEY = 'ovs_pending_rewind_v1';

// In-memory fallback for environments without localStorage (e.g. Node tests)
const memoryRewindStore = new Map<string, RewindMetadata>();
let memoryPendingRewind: { state: RunState; meta: RewindMetadata } | null = null;

/**
 * Prepare a RunState snapshot for rewinding from a chosen decision.
 * Resets finished/ended flags, assigns a new runId, and records rewindOf linkage.
 */
export function prepareRewindRun(
  decisionPoint: ReplayDecisionPoint,
  parentRunId: string,
  caseFile: CaseFile
): { state: RunState; meta: RewindMetadata } {
  const state = structuredClone(decisionPoint.stateBefore);
  const rewindRunId = `rewind-${newId()}`;

  state.runId = rewindRunId;
  state.caseFile = caseFile;
  state.finished = false;
  state.ended = null;
  state.pendingPrediction = null;

  const meta: RewindMetadata = {
    rewindRunId,
    parentRunId,
    caseId: caseFile.id,
    rewindAtSimSec: decisionPoint.simTimeSec,
    decisionIndex: decisionPoint.index,
    createdAt: new Date().toISOString(),
  };

  saveRewindMetadata(meta);

  return { state, meta };
}

/** Store metadata linking a rewind run to its parent run. */
export function saveRewindMetadata(meta: RewindMetadata): void {
  memoryRewindStore.set(meta.rewindRunId, meta);
  if (typeof localStorage !== 'undefined') {
    try {
      const existingRaw = localStorage.getItem(REWIND_STORAGE_KEY);
      const existing: Record<string, RewindMetadata> = existingRaw ? JSON.parse(existingRaw) : {};
      existing[meta.rewindRunId] = meta;
      localStorage.setItem(REWIND_STORAGE_KEY, JSON.stringify(existing));
    } catch {
      // localStorage may fail in private browsing; memory store still holds it
    }
  }
}

/** Clear all rewind metadata from both memory and browser storage. */
export function clearRewindMetadata(): void {
  memoryRewindStore.clear();
  memoryPendingRewind = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(REWIND_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(PENDING_REWIND_KEY);
    } catch {
      // ignore
    }
  }
}

/** List all stored rewind metadata records from storage and memory. */
export function listAllRewindMetadata(): Record<string, RewindMetadata> {
  const result: Record<string, RewindMetadata> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(REWIND_STORAGE_KEY);
      if (raw) {
        Object.assign(result, JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }
  for (const [k, v] of memoryRewindStore.entries()) {
    result[k] = v;
  }
  return result;
}

/** Replace all stored rewind metadata with the provided map. */
export function replaceAllRewindMetadata(map: Record<string, RewindMetadata>): void {
  memoryRewindStore.clear();
  for (const [k, v] of Object.entries(map)) {
    memoryRewindStore.set(k, v);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(REWIND_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }
}

/** Retrieve rewind metadata for a specific runId if it was created via rewind. */
export function getRewindMetadata(runId: string): RewindMetadata | null {
  if (memoryRewindStore.has(runId)) {
    return memoryRewindStore.get(runId)!;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const existingRaw = localStorage.getItem(REWIND_STORAGE_KEY);
      if (existingRaw) {
        const existing: Record<string, RewindMetadata> = JSON.parse(existingRaw);
        return existing[runId] ?? null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Store a pending rewind in handoff storage for page navigation or CaseRunner mount. */
export function setPendingRewind(state: RunState, meta: RewindMetadata): void {
  memoryPendingRewind = { state, meta };
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(PENDING_REWIND_KEY, JSON.stringify({ state, meta }));
    } catch {
      // ignore quota errors
    }
  }
}

/** Retrieve and consume any pending rewind state. */
export function consumePendingRewind(): { state: RunState; meta: RewindMetadata } | null {
  let val = memoryPendingRewind;
  memoryPendingRewind = null;

  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(PENDING_REWIND_KEY);
      sessionStorage.removeItem(PENDING_REWIND_KEY);
      if (!val && raw) {
        val = JSON.parse(raw);
      }
    } catch {
      // ignore parse errors
    }
  }
  return val;
}
