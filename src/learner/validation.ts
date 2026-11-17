/**
 * Validation utilities for learner events and export/import payloads.
 */
import type { LearnerEvent, GuidanceLevel } from '../shared/events';
import { EVENT_SCHEMA_VERSION } from '../shared/events';

const VALID_EVENT_TYPES = new Set([
  'session_start',
  'session_end',
  'run_start',
  'run_end',
  'order',
  'settings_change',
  'observe',
  'abg_result',
  'data_viewed',
  'prediction',
  'drill_answer',
  'rubric_result',
  'mistake',
  'alarm',
  'hint_shown',
  'resource_opened',
  'debrief_viewed',
  'assessment_commit',
  'rationale',
]);

const VALID_GUIDANCE_LEVELS = new Set(['guided', 'prompted', 'independent']);
const VALID_CONFIDENCE_LEVELS = new Set(['guess', 'fairly_sure', 'certain']);
const VALID_EVIDENCE_TYPES = new Set([
  'recall',
  'interpretation',
  'prediction',
  'decision',
  'prioritisation',
  'reassessment',
  'safety',
  'calibration',
]);
const VALID_SEVERITIES = new Set(['minor', 'major', 'critical']);
const VALID_RUN_OUTCOMES = new Set([
  'improved',
  'stable',
  'deteriorated',
  'died',
  'escalated',
  'abandoned',
  'completed',
]);

export function validateLearnerEvent(e: unknown): LearnerEvent {
  if (!e || typeof e !== 'object') {
    throw new Error('Event must be a non-null object');
  }

  const ev = e as Record<string, unknown>;

  if (ev.v !== EVENT_SCHEMA_VERSION) {
    throw new Error(`Invalid schema version: expected ${EVENT_SCHEMA_VERSION}, received ${String(ev.v)}`);
  }

  if (typeof ev.id !== 'string' || !ev.id.trim()) {
    throw new Error('Event must have a non-empty string id');
  }

  if (typeof ev.wallTime !== 'string' || isNaN(Date.parse(ev.wallTime))) {
    throw new Error('Event must have a valid ISO wallTime');
  }

  if (typeof ev.sessionId !== 'string' || !ev.sessionId.trim()) {
    throw new Error('Event must have a non-empty string sessionId');
  }

  if (typeof ev.type !== 'string' || !VALID_EVENT_TYPES.has(ev.type)) {
    throw new Error(`Event has unknown type: ${String(ev.type)}`);
  }

  // Evidence fields validation
  if (ev.type === 'prediction' || ev.type === 'drill_answer' || ev.type === 'rubric_result') {
    if (typeof ev.competency !== 'string' || !ev.competency.trim()) {
      throw new Error(`Evidence event (${ev.type}) must have a non-empty competency`);
    }
    if (typeof ev.evidenceType !== 'string' || !VALID_EVIDENCE_TYPES.has(ev.evidenceType)) {
      throw new Error(`Evidence event (${ev.type}) has invalid evidenceType: ${String(ev.evidenceType)}`);
    }
    if (typeof ev.correct !== 'boolean') {
      throw new Error(`Evidence event (${ev.type}) must have a boolean 'correct' field`);
    }
    if (typeof ev.guidance !== 'string' || !VALID_GUIDANCE_LEVELS.has(ev.guidance)) {
      throw new Error(`Evidence event (${ev.type}) has invalid guidance: ${String(ev.guidance)}`);
    }
    if (typeof ev.hidden !== 'boolean') {
      throw new Error(`Evidence event (${ev.type}) must have a boolean 'hidden' field`);
    }
    if (ev.confidence !== undefined && (typeof ev.confidence !== 'string' || !VALID_CONFIDENCE_LEVELS.has(ev.confidence))) {
      throw new Error(`Evidence event (${ev.type}) has invalid confidence: ${String(ev.confidence)}`);
    }
    if (ev.assistance !== undefined) {
      if (!ev.assistance || typeof ev.assistance !== 'object' || Array.isArray(ev.assistance)) {
        throw new Error(`Evidence event (${ev.type}) has invalid assistance telemetry`);
      }
      const a = ev.assistance as Record<string, unknown>;
      if (typeof a.assistedInWindow !== 'boolean') {
        throw new Error(`Evidence event (${ev.type}) assistance.assistedInWindow must be boolean`);
      }
      if (a.maxHelpLevelUsed !== 0 && a.maxHelpLevelUsed !== 1 && a.maxHelpLevelUsed !== 2 && a.maxHelpLevelUsed !== 3) {
        throw new Error(`Evidence event (${ev.type}) assistance.maxHelpLevelUsed must be 0|1|2|3`);
      }
    }
  }

  if (ev.type === 'mistake') {
    if (typeof ev.mistake !== 'string' || !ev.mistake.trim()) {
      throw new Error('Mistake event must have a non-empty mistake field');
    }
    if (typeof ev.competency !== 'string' || !ev.competency.trim()) {
      throw new Error('Mistake event must have a non-empty competency field');
    }
    if (ev.severity !== undefined && (typeof ev.severity !== 'string' || !VALID_SEVERITIES.has(ev.severity))) {
      throw new Error(`Mistake event has invalid severity: ${String(ev.severity)}`);
    }
  }

  if (ev.type === 'assessment_commit') {
    if (!Array.isArray(ev.assessments) || ev.assessments.length === 0) {
      throw new Error('assessment_commit event must have a non-empty assessments array');
    }
    if (typeof ev.confidence !== 'string' || !VALID_CONFIDENCE_LEVELS.has(ev.confidence)) {
      throw new Error(`assessment_commit event has invalid confidence: ${String(ev.confidence)}`);
    }
  }

  if (ev.type === 'rationale') {
    if (typeof ev.reasonId !== 'string' || !ev.reasonId.trim()) {
      throw new Error('rationale event must have a non-empty reasonId');
    }
    if (!ev.targetAction || typeof ev.targetAction !== 'object') {
      throw new Error('rationale event must have a targetAction object');
    }
  }

  if (ev.type === 'run_end') {
    if (typeof ev.outcome !== 'string' || !VALID_RUN_OUTCOMES.has(ev.outcome)) {
      throw new Error(`run_end event has invalid outcome: ${String(ev.outcome)}`);
    }
  }

  return ev as unknown as LearnerEvent;
}

export interface ExportPayload {
  format: 'ovs-learner';
  version: number;
  exportedAt: string;
  events: LearnerEvent[];
  guidanceOverrides?: Record<string, GuidanceLevel>;
  practiceCardStates?: Record<string, unknown>;
  tutorExchanges?: unknown[];
  delayedRetests?: unknown[];
  rewindMetadata?: Record<string, unknown>;
}

export function validateExportPayload(data: unknown): ExportPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Malformed JSON: root must be an object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.format !== 'ovs-learner') {
    throw new Error(`Invalid format in export payload: expected 'ovs-learner', received ${String(obj.format)}`);
  }

  if (obj.version !== 1) {
    throw new Error(`Unsupported export payload version: ${String(obj.version)}`);
  }

  if (typeof obj.exportedAt !== 'string' || isNaN(Date.parse(obj.exportedAt))) {
    throw new Error('Invalid exportedAt in export payload');
  }

  if (!Array.isArray(obj.events)) {
    throw new Error('Invalid events in export payload: expected an array');
  }

  for (let i = 0; i < obj.events.length; i++) {
    try {
      validateLearnerEvent(obj.events[i]);
    } catch (err) {
      throw new Error(`Invalid event at index ${i}: ${(err as Error).message}`);
    }
  }

  if (obj.guidanceOverrides !== undefined) {
    if (typeof obj.guidanceOverrides !== 'object' || obj.guidanceOverrides === null || Array.isArray(obj.guidanceOverrides)) {
      throw new Error('guidanceOverrides must be an object map');
    }
    const overrides = obj.guidanceOverrides as Record<string, unknown>;
    for (const [key, val] of Object.entries(overrides)) {
      if (typeof val !== 'string' || !VALID_GUIDANCE_LEVELS.has(val)) {
        throw new Error(`Invalid guidance level for override '${key}': ${String(val)}`);
      }
    }
  }

  if (obj.tutorExchanges !== undefined && !Array.isArray(obj.tutorExchanges)) {
    throw new Error('tutorExchanges must be an array');
  }

  if (obj.delayedRetests !== undefined && !Array.isArray(obj.delayedRetests)) {
    throw new Error('delayedRetests must be an array');
  }

  if (obj.rewindMetadata !== undefined) {
    if (typeof obj.rewindMetadata !== 'object' || obj.rewindMetadata === null || Array.isArray(obj.rewindMetadata)) {
      throw new Error('rewindMetadata must be an object map');
    }
  }

  return obj as unknown as ExportPayload;
}
