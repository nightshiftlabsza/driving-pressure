import type { TutorResponse, TutorContextKind, HelpLevel, TutorMode } from './types';
import type { AssistanceTelemetry } from '../shared/learnerApi';

export interface TutorSuggestion {
  misconceptionId?: string;
  reasoningGrade?: string | null;
  confidence: number;
  status: 'suggested';
}

export interface TutorExchangeRecord {
  id: string;
  timestamp: string;
  contextHash?: string;
  contextKind: TutorContextKind;
  provider: string;
  model: string;
  promptVersion: string;
  cap?: HelpLevel;
  levelUsed?: HelpLevel;
  rawOutput: string;
  validatedOutput: TutorResponse;
  latencyMs: number;
  tokens?: { inputTokens: number; outputTokens: number };
  suggestions: TutorSuggestion[];
  assisted?: boolean;
  runId?: string;
  simTimeSec?: number;
  competencyIds?: string[];
  mode?: TutorMode;
  attemptSubmittedAt?: string;
  reconstructionPassed?: boolean | null;
  timeToFirstHypothesisMs?: number;
}

export interface DelayedRetestRecord {
  id: string;
  competencyId: string;
  caseId: string;
  variantId?: string;
  dueAt: number;
  createdAt: number;
  completedAt: number | null;
  passed: boolean | null;
  source?: 'assisted_reveal' | 'transfer_fail' | 'delayed_retest';
}

export interface TutorContractAcceptance {
  accepted: boolean;
  acceptedAt: string;
  version: string;
}

const DB_NAME = 'ovs-tutor';
const STORE_NAME = 'exchanges';
const RETEST_STORE_NAME = 'retests';
const META_STORE_NAME = 'meta';
const DB_VERSION = 2;

let memoryStore: TutorExchangeRecord[] = [];
let memoryRetests: DelayedRetestRecord[] = [];
let memoryMeta: Record<string, unknown> = {};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(RETEST_STORE_NAME)) {
        db.createObjectStore(RETEST_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTutorExchange(record: TutorExchangeRecord): Promise<void> {
  memoryStore.push(record);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // In-memory fallback
  }
}

export async function listTutorExchanges(): Promise<TutorExchangeRecord[]> {
  try {
    const db = await openDb();
    const fromDb = await new Promise<TutorExchangeRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as TutorExchangeRecord[]);
      req.onerror = () => reject(req.error);
    });
    if (fromDb.length > 0) return fromDb;
  } catch {
    // ignore
  }
  return [...memoryStore];
}

export async function clearTutorExchanges(): Promise<void> {
  memoryStore = [];
  memoryRetests = [];
  memoryMeta = {};
  try {
    const db = await openDb();
    const storeNames = [STORE_NAME, RETEST_STORE_NAME, META_STORE_NAME].filter(s =>
      db.objectStoreNames.contains(s)
    );
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const s of storeNames) {
        tx.objectStore(s).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function scheduleDelayedRetest(record: DelayedRetestRecord): Promise<void> {
  const existingIdx = memoryRetests.findIndex(r => r.id === record.id);
  if (existingIdx >= 0) {
    memoryRetests[existingIdx] = record;
  } else {
    memoryRetests.push(record);
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RETEST_STORE_NAME, 'readwrite');
      tx.objectStore(RETEST_STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // In-memory fallback
  }
}

export async function listDelayedRetests(): Promise<DelayedRetestRecord[]> {
  try {
    const db = await openDb();
    const fromDb = await new Promise<DelayedRetestRecord[]>((resolve, reject) => {
      const tx = db.transaction(RETEST_STORE_NAME, 'readonly');
      const req = tx.objectStore(RETEST_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as DelayedRetestRecord[]);
      req.onerror = () => reject(req.error);
    });
    if (fromDb.length > 0) return fromDb;
  } catch {
    // ignore
  }
  return [...memoryRetests];
}

export async function completeDelayedRetest(id: string, passed: boolean, completedAt = Date.now()): Promise<void> {
  const existing = (await listDelayedRetests()).find(r => r.id === id);
  if (!existing) return;
  await scheduleDelayedRetest({
    ...existing,
    completedAt,
    passed,
  });
}

export async function getContractAccepted(): Promise<TutorContractAcceptance | null> {
  if (memoryMeta['contractAccepted']) {
    return memoryMeta['contractAccepted'] as TutorContractAcceptance;
  }
  try {
    const db = await openDb();
    const record = await new Promise<{ key: string; value: TutorContractAcceptance } | undefined>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readonly');
      const req = tx.objectStore(META_STORE_NAME).get('contractAccepted');
      req.onsuccess = () => resolve(req.result as { key: string; value: TutorContractAcceptance } | undefined);
      req.onerror = () => reject(req.error);
    });
    if (record?.value) {
      memoryMeta['contractAccepted'] = record.value;
      return record.value;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function setContractAccepted(acceptance: TutorContractAcceptance): Promise<void> {
  memoryMeta['contractAccepted'] = acceptance;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readwrite');
      tx.objectStore(META_STORE_NAME).put({ key: 'contractAccepted', value: acceptance });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // In-memory fallback
  }
}

/**
 * Summarises stored tutor exchanges per runId into AssistanceTelemetry so
 * derivation and entrustment rules deterministically discount assisted runs.
 */
export function deriveAssistanceByRun(
  exchanges: readonly TutorExchangeRecord[]
): Map<string, AssistanceTelemetry> {
  const grouped = new Map<string, TutorExchangeRecord[]>();
  for (const ex of exchanges) {
    if (!ex.runId) continue;
    const list = grouped.get(ex.runId) ?? [];
    list.push(ex);
    grouped.set(ex.runId, list);
  }

  const out = new Map<string, AssistanceTelemetry>();
  for (const [runId, list] of grouped.entries()) {
    const assistedExchanges = list.filter(ex => ex.assisted !== false);
    const assistedInWindow = assistedExchanges.length > 0;
    let maxHelpLevelUsed: 0 | 1 | 2 | 3 = 0;
    let reconstructionPassed: boolean | null = null;
    let timeToFirstHypothesisMs = 0;

    for (const ex of assistedExchanges) {
      const lvl = ex.levelUsed ?? ex.cap ?? 1;
      if (lvl > maxHelpLevelUsed) {
        maxHelpLevelUsed = lvl as 0 | 1 | 2 | 3;
      }
      if (typeof ex.reconstructionPassed === 'boolean') {
        reconstructionPassed = ex.reconstructionPassed;
      }
      if (typeof ex.timeToFirstHypothesisMs === 'number' && timeToFirstHypothesisMs === 0) {
        timeToFirstHypothesisMs = ex.timeToFirstHypothesisMs;
      }
    }

    out.set(runId, {
      assistedInWindow,
      maxHelpLevelUsed,
      hintCountInProblem: assistedExchanges.length,
      tutorTurnsBeforeCommit: assistedExchanges.length,
      reconstructionPassed,
      timeToFirstHypothesisMs,
    });
  }
  return out;
}
