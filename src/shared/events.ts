/**
 * FROZEN CONTRACT: learner event log (version 1).
 *
 * Every learning-relevant thing the app observes is appended as one event.
 * The learner model (src/learner) derives competency status from these events only,
 * so rules can change later without losing history. Events are never edited or deleted
 * except by an explicit user "reset progress" or import.
 *
 * Agents may import from this file but must not edit it.
 */
import type { DeviceSettings, AbgResult } from './engineTypes';
import type { OrderType } from './caseSchema';
import type { AssistanceTelemetry, CompetencyReasoningGrade, TutorMode } from './learnerApi';

export const EVENT_SCHEMA_VERSION = 1;

export type Confidence = 'guess' | 'fairly_sure' | 'certain';
export type ActivityKind = 'case' | 'drill' | 'lab';
export type GuidanceLevel = 'guided' | 'prompted' | 'independent';
export type EvidenceType =
  | 'recall' | 'interpretation' | 'prediction' | 'decision'
  | 'prioritisation' | 'reassessment' | 'safety' | 'calibration';

interface EventBase {
  v: typeof EVENT_SCHEMA_VERSION;
  id: string;                 // uuid
  wallTime: string;           // ISO 8601
  sessionId: string;          // one app session (open to close)
  runId?: string;             // one attempt at a case/drill/lab
  activity?: ActivityKind;
  activityId?: string;        // case id, drill id or lab id
  activityVersion?: string;
  simTimeSec?: number;
  contextTags?: string[];     // from the case, e.g. ["copd", "niv"]
}

/** One piece of evidence about one competency. The core input of the learner model. */
export interface EvidenceFields {
  competency: string;         // id from competencies.json
  evidenceType: EvidenceType;
  correct: boolean;
  confidence?: Confidence;
  guidance: GuidanceLevel;
  hidden: boolean;            // true = competency was tested without being announced
  latencyMs?: number;
  assistance?: AssistanceTelemetry;
  reasoningGrade?: CompetencyReasoningGrade;
  causalNodesVerified?: boolean;
  isDelayedRetest?: boolean;
  isTransferVariant?: boolean;
  transferVariantId?: string;
  tutorMode?: TutorMode;
}

export type LearnerEvent = EventBase & (
  | { type: 'session_start'; appVersion: string }
  | { type: 'session_end' }
  | { type: 'run_start'; guidanceByCompetency: Record<string, GuidanceLevel>; tutorMode?: TutorMode; isDelayedRetest?: boolean; isTransferVariant?: boolean; transferVariantId?: string }
  | { type: 'run_end'; outcome: 'improved' | 'stable' | 'deteriorated' | 'died' | 'escalated' | 'abandoned' | 'completed'; score?: number; maxScore?: number }
  | { type: 'order'; order: OrderType; detail?: Record<string, unknown> }
  | { type: 'settings_change'; before: DeviceSettings; after: DeviceSettings }
  /** The learner chose to watch without changing anything; time ran until stoppedBy. */
  | { type: 'observe'; fromSimSec: number; toSimSec: number; stoppedBy: 'ended' | 'prediction' | 'result' | 'message' | 'change' | 'limit' }
  | { type: 'abg_result'; abg: AbgResult }
  | { type: 'data_viewed'; what: 'abg' | 'cxr' | 'exam' | 'waveform' | 'trend' | 'loop' }
  | ({ type: 'prediction'; predictionId: string; question: string; answer: unknown; expected: unknown } & EvidenceFields)
  | ({ type: 'drill_answer'; drillId: string; itemId: string; answer: unknown; expected: unknown; hintsUsed: number } & EvidenceFields)
  | ({ type: 'rubric_result'; rubricId: string; met: boolean; critical: boolean } & EvidenceFields)
  | { type: 'mistake'; mistake: string; competency: string; severity: 'minor' | 'major' | 'critical'; detail: string }
  | { type: 'alarm'; alarm: string; raisedAtSimSec: number; acknowledgedAtSimSec?: number; priority?: 'high' | 'med' | 'low'; timeToAcknowledgeSec?: number }
  | { type: 'hint_shown'; level: 0 | 1 | 2 | 3; competency?: string; source: 'rule' | 'ai' }
  | { type: 'resource_opened'; competency?: string; resource: string }   // exposure only, never changes status
  | { type: 'debrief_viewed' }
  | { type: 'assessment_commit'; assessments: string[]; confidence: Confidence; revised?: boolean; competency?: string; evidenceType?: EvidenceType; correct?: boolean; guidance?: GuidanceLevel; hidden?: boolean }
  | { type: 'rationale'; targetAction: { kind: 'settings_change' | 'order'; id?: string; detail?: unknown }; reasonId: string }
);

export type LearnerEventType = LearnerEvent['type'];

/** Events that count as evidence for the learner model. */
export function isEvidenceEvent(e: LearnerEvent): e is Extract<LearnerEvent, EvidenceFields> {
  return (
    e.type === 'prediction' ||
    e.type === 'drill_answer' ||
    e.type === 'rubric_result' ||
    (e.type === 'assessment_commit' &&
      !e.revised &&
      typeof e.competency === 'string' &&
      typeof e.evidenceType === 'string' &&
      typeof e.correct === 'boolean' &&
      typeof e.guidance === 'string' &&
      typeof e.hidden === 'boolean')
  );
}

/**
 * The one way UI and runtime code records events. Implemented by src/learner (agent B).
 * Until then, src/shared/eventSink.ts provides an in-memory sink.
 */
export interface EventSink {
  record(e: LearnerEvent): Promise<void>;
}
