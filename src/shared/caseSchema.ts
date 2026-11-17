/**
 * FROZEN CONTRACT: case file format (schemaVersion "1.0").
 *
 * Cases are JSON files in src/cases/library/*.json. They contain no code.
 * Everything a case can do is expressed with the conditions and actions defined here,
 * and the engine decides all physiology. Validate with `npm run case:check`.
 *
 * Agents may import from this file but must not edit it.
 */
import { z } from 'zod';
import competencies from './competencies.json';
import mistakes from './mistakes.json';

export const CASE_SCHEMA_VERSION = '1.0';

export const COMPETENCY_IDS: string[] = competencies.domains.flatMap(d => d.competencies.map(c => c.id));
export const MISTAKE_IDS: string[] = mistakes.mistakes.map(m => m.id);

const competencyId = z.string().refine(id => COMPETENCY_IDS.includes(id), { message: 'Unknown competency id (see src/shared/competencies.json)' });
const mistakeId = z.string().refine(id => MISTAKE_IDS.includes(id), { message: 'Unknown mistake id (see src/shared/mistakes.json)' });
const frac = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Patient and device (mirror engineTypes.ts)
// ---------------------------------------------------------------------------

/** Device family an order moved the patient onto (change-device / intubate). Added 1.1 (QA3-002). */
export type DeviceKind = 'invasive' | 'niv' | 'hfnc' | 'none';

export const PatientParamsSchema = z.object({
  sex: z.enum(['M', 'F']),
  ageYears: z.number().int().min(16).max(105),
  heightCm: z.number().min(130).max(220),
  actualWeightKg: z.number().min(30).max(250),
  complianceMlPerCmH2O: z.number().min(5).max(150),
  inspResistanceCmH2OPerLps: z.number().min(2).max(60),
  expResistanceCmH2OPerLps: z.number().min(2).max(80),
  expFlowLimitationCmH2O: z.number().min(0).max(20).optional(),
  spontRateBpm: z.number().min(0).max(60),
  pmusAmplitudeCmH2O: z.number().min(0).max(40),
  pmusInspTimeSec: z.number().min(0.3).max(2),
  vco2MlPerMin: z.number().min(100).max(600),
  vo2MlPerMin: z.number().min(120).max(700),
  anatomicDeadSpaceMl: z.number().min(50).max(300),
  alveolarDeadSpaceFraction: frac,
  shuntFraction: z.number().min(0).max(0.7),
  recruitability: frac,
  hbGPerDl: z.number().min(4).max(20),
  temperatureC: z.number().min(32).max(42),
  baselineHco3MmolL: z.number().min(5).max(50),
  chronicPaco2MmHg: z.number().min(20).max(90).optional(),
  hrBaselineBpm: z.number().min(30).max(180),
  sbpBaselineMmHg: z.number().min(50).max(250),
  dbpBaselineMmHg: z.number().min(25).max(150),
  ppvResponse: z.enum(['helpful', 'unhelpful', 'complicated', 'clean-kill']),
  ppvSeverity: frac,
  respiratoryReserve: frac,
  // Phase 6 additions
  lowVqFraction: frac.optional(),
  lowVqRatio: z.number().min(0.01).max(1).optional(),
  lungModel: z.enum(['single', 'two-compartment']).optional(),
  twoCompartmentParams: z.object({
    openingPressureCmH2O: z.number().min(0).max(30).optional(),
    closingPressureCmH2O: z.number().min(0).max(25).optional(),
    recruitComplianceMlPerCmH2O: z.number().min(0).max(50).optional(),
    overdistensionVolumeMl: z.number().min(200).max(2000).optional(),
    overdistensionFalloff: z.number().min(0).max(1).optional(),
  }).strict().optional(),
  chestWallComplianceMlPerCmH2O: z.number().min(5).max(300).optional(),
  reverseTriggerProbability: frac.optional(),
}).strict();

export const DeviceSettingsSchema = z.discriminatedUnion('device', [
  z.object({
    device: z.literal('invasive'),
    mode: z.enum(['VC-AC', 'PC-AC', 'PSV', 'CPAP', 'SIMV-VC', 'APRV']),
    fio2: z.number().min(0.21).max(1), peep: z.number().min(0).max(25), rrSetBpm: z.number().min(0).max(40),
    vtSetMl: z.number().min(150).max(1000).optional(), inspFlowLpm: z.number().min(10).max(120).optional(),
    flowPattern: z.enum(['square', 'decelerating']).optional(),
    pinspAbovePeep: z.number().min(0).max(40).optional(), tiSec: z.number().min(0.3).max(3).optional(),
    psAbovePeep: z.number().min(0).max(30).optional(), cyclePctPeakFlow: z.number().min(5).max(80).optional(),
    triggerFlowLpm: z.number().min(0.5).max(10).optional(), riseTimeSec: z.number().min(0).max(0.6).optional(),
    phighCmH2O: z.number().min(10).max(40).optional(), plowCmH2O: z.number().min(0).max(15).optional(),
    thighSec: z.number().min(2).max(12).optional(), tlowSec: z.number().min(0.2).max(1.5).optional(),
    apnoeaBackup: z.boolean().optional(),
  }).strict(),
  z.object({
    device: z.literal('niv'), mode: z.enum(['CPAP', 'ST']),
    fio2: z.number().min(0.21).max(1), epap: z.number().min(3).max(20), ipap: z.number().min(5).max(30).optional(),
    backupRrBpm: z.number().min(0).max(30).optional(), tiSec: z.number().min(0.5).max(2).optional(), apnoeaBackup: z.boolean().optional(),
    interface: z.enum(['oronasal', 'full-face', 'nasal', 'helmet']), maskFit: z.enum(['good', 'fair', 'poor']),
  }).strict(),
  z.object({ device: z.literal('hfnc'), flowLpm: z.number().min(10).max(60), fio2: z.number().min(0.21).max(1), temperatureC: z.number().min(31).max(37) }).strict(),
  z.object({ device: z.literal('none'), o2: z.enum(['room-air', 'nasal-cannula', 'simple-mask', 'venturi', 'non-rebreather']), o2FlowLpm: z.number().min(0).max(15) }).strict(),
]);

// ---------------------------------------------------------------------------
// Conditions (evaluated by the case runtime against engine output)
// ---------------------------------------------------------------------------

/** Metrics a condition can read. All come from MonitoredValues, PhysState, the last ABG or the run. */
export const METRICS = [
  'simMin', 'ph', 'paco2', 'pao2', 'spo2', 'etco2', 'rrTotal', 'rrSpont', 'vte', 'vteMlKgPbw', 'minuteVent',
  'ppeak', 'pplat', 'drivingPressure', 'autoPeep', 'pmean', 'peep', 'fio2', 'leak', 'map', 'hr', 'sbp',
  'fatigue', 'pfRatio', 'hfncPressure', 'hfncPaw',
  // Phase 6 additions
  'p01', 'deltaPocc', 'plEndInsp', 'plEndExp', 'pes',
  'doubleTriggerCount', 'prematureCycleCount', 'delayedCycleCount', 'flowStarvationCount', 'autoTriggerCount', 'reverseTriggerCount',
  // Phase 7 additions
  'rsbi',
] as const;
export type BaseMetric = typeof METRICS[number];
export type Metric = BaseMetric | `alarmActive:${string}` | `alarmSilenced:${string}`;

export const MetricSchema = z.union([
  z.enum(METRICS),
  z.string().regex(/^alarmActive:.+$/),
  z.string().regex(/^alarmSilenced:.+$/),
]);

export const ThresholdSchema = z.object({
  metric: MetricSchema as z.ZodType<Metric>,
  op: z.enum(['<', '<=', '>', '>=']),
  value: z.number(),
  /** Condition must hold continuously for this many simulated seconds (default 0). */
  forSimSec: z.number().min(0).optional(),
}).strict();

export const ORDER_TYPES = [
  'abg', 'cxr', 'examine', 'change-settings', 'change-device', 'intubate', 'extubate', 'suction',
  'bronchodilator', 'steroid', 'diuretic', 'fluid-bolus', 'vasopressor', 'sedation', 'paralysis',
  'prone', 'recruitment', 'disconnect-ventilator', 'needle-decompression', 'call-senior',
] as const;
export type OrderType = typeof ORDER_TYPES[number];

export interface Condition {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  threshold?: z.infer<typeof ThresholdSchema>;
  /** True once the learner has placed this order at least minCount times (default 1), within withinSimMin of case start if given. */
  ordered?: { order: OrderType; withinSimMin?: number; minCount?: number; deviceKind?: DeviceKind[] };
  /** True once a named trigger has fired. */
  fired?: string;
}

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.object({
  all: z.array(ConditionSchema).min(1).optional(),
  any: z.array(ConditionSchema).min(1).optional(),
  not: ConditionSchema.optional(),
  threshold: ThresholdSchema.optional(),
  ordered: z.object({ order: z.enum(ORDER_TYPES), withinSimMin: z.number().positive().optional(), minCount: z.number().int().min(1).optional(), deviceKind: z.array(z.enum(['invasive', 'niv', 'hfnc', 'none'])).min(1).optional() }).strict().optional(),
  fired: z.string().optional(),
}).strict().refine(c => Object.keys(c).length === 1, { message: 'A condition has exactly one key: all, any, not, threshold, ordered or fired' }));

// ---------------------------------------------------------------------------
// Actions (what a trigger or order effect does)
// ---------------------------------------------------------------------------

export const ActionSchema = z.discriminatedUnion('type', [
  /** Change patient parameters, optionally ramped over time (disease progression, treatment effect). */
  z.object({ type: z.literal('patientChange'), change: PatientParamsSchema.partial(), rampSimMin: z.number().min(0).optional() }).strict(),
  /** Bedside message, e.g. a nurse comment. Must be in-world, never a hint. */
  z.object({ type: z.literal('message'), from: z.enum(['nurse', 'patient', 'family', 'senior', 'system']), text: z.string().min(1) }).strict(),
  /** Reveal finding text for an order (exam, CXR report). */
  z.object({ type: z.literal('finding'), order: z.enum(['examine', 'cxr']), text: z.string().min(1) }).strict(),
  /** Pause and ask a prediction question. */
  z.object({ type: z.literal('prediction'), predictionId: z.string() }).strict(),
  /** Record a mistake against the learner (detected by rule, never by AI). */
  z.object({ type: z.literal('mistake'), mistake: mistakeId, competency: competencyId, severity: z.enum(['minor', 'major', 'critical']), detail: z.string() }).strict(),
  z.object({ type: z.literal('endCase'), outcome: z.enum(['improved', 'stable', 'deteriorated', 'died', 'escalated']), reason: z.string() }).strict(),
]);
export type CaseAction = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export const EvidenceSchema = z.object({
  claim: z.string(),                 // what in the case depends on this source
  source: z.string(),                // citation; no copied text
  year: z.number().int(),
  kind: z.enum(['guideline', 'trial', 'observational', 'review', 'textbook', 'teaching-resource', 'expert-opinion']),
  url: z.string().url().optional(),
}).strict();

export const PredictionPointSchema = z.object({
  id: z.string(),
  competency: competencyId,
  evidenceType: z.enum(['prediction', 'interpretation', 'decision']),
  question: z.string(),
  /** direction: up/down/no change for each listed variable. choice: single answer. numeric: value within tolerance. */
  format: z.enum(['direction', 'choice', 'numeric']),
  variables: z.array(z.enum(METRICS)).optional(),          // direction
  options: z.array(z.string()).optional(),                 // choice
  unit: z.string().optional(),                             // numeric
  /**
   * How the answer is marked. 'engine' = compare against what the engine actually produces
   * after the next change (preferred: the physiology answers). 'fixed' = authored key.
   */
  marking: z.enum(['engine', 'fixed']),
  answerKey: z.union([z.string(), z.number(), z.record(z.enum(['up', 'down', 'same']))]).optional(),
  tolerance: z.number().optional(),
  explanation: z.string(),           // shown after the answer is committed
  hidden: z.boolean().default(false),// true = competency tested without being announced
}).strict();

export const RubricItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  competency: competencyId,
  evidenceType: z.enum(['decision', 'prioritisation', 'reassessment', 'safety']),
  met: ConditionSchema,              // condition that counts as met
  bySimMin: z.number().positive().optional(),
  weight: z.number().min(0).max(5).default(1),
  critical: z.boolean().default(false),
}).strict();

export const OrderEffectSchema = z.object({
  order: z.enum(ORDER_TYPES),
  delaySimMin: z.number().min(0).default(0),
  actions: z.array(ActionSchema).min(1),
  note: z.string().optional(),
}).strict();

export const TriggerSchema = z.object({
  id: z.string(),
  when: ConditionSchema,
  then: z.array(ActionSchema).min(1),
  once: z.boolean().default(true),
}).strict();

export const CaseSchema = z.object({
  schemaVersion: z.literal(CASE_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string(),
  summary: z.string(),               // one line for the case library; must not give away the diagnosis
  difficulty: z.number().int().min(1).max(3),
  setting: z.enum(['ed', 'ward', 'hdu', 'icu']),
  competencies: z.array(competencyId).min(1),
  hiddenCompetencies: z.array(competencyId).default([]),
  contextTags: z.array(z.string()).default([]), // e.g. "copd", "ards", "pneumonia", "night-shift"
  evidence: z.array(EvidenceSchema).min(1),
  patient: z.object({
    displayName: z.string(),         // synthetic name only
    presentingStory: z.string(),
    history: z.string(),
    params: PatientParamsSchema,
  }).strict(),
  initialDevice: DeviceSettingsSchema,
  initialPhys: z.object({ paco2MmHg: z.number(), pao2MmHg: z.number().optional(), hco3MmolL: z.number().optional(), fatigue: frac.optional() }).strict(),
  availableOrders: z.array(z.enum(ORDER_TYPES)).min(1),
  orderEffects: z.array(OrderEffectSchema).default([]),
  findings: z.object({ examine: z.string(), cxr: z.string() }).strict(),
  course: z.array(z.object({ atSimMin: z.number().min(0), actions: z.array(ActionSchema).min(1) }).strict()).default([]),
  triggers: z.array(TriggerSchema).default([]),
  predictionPoints: z.array(PredictionPointSchema).default([]),
  rubric: z.array(RubricItemSchema).min(1),
  maxSimMin: z.number().positive().max(24 * 60),
  debrief: z.object({
    keyPoints: z.array(z.string()).min(1),
    resources: z.array(z.object({ title: z.string(), ref: z.string(), url: z.string().url().optional() }).strict()).default([]),
  }).strict(),
}).strict().superRefine((c, ctx) => {
  const predIds = new Set(c.predictionPoints.map(p => p.id));
  const trigIds = new Set(c.triggers.map(t => t.id));
  const allActions = [...c.course.flatMap(x => x.actions), ...c.triggers.flatMap(t => t.then), ...c.orderEffects.flatMap(o => o.actions)];
  for (const a of allActions) {
    if (a.type === 'prediction' && !predIds.has(a.predictionId)) ctx.addIssue({ code: 'custom', message: `prediction action points to unknown id "${a.predictionId}"` });
  }
  const checkFired = (cond: Condition) => {
    if (cond.fired && !trigIds.has(cond.fired)) ctx.addIssue({ code: 'custom', message: `condition refers to unknown trigger "${cond.fired}"` });
    cond.all?.forEach(checkFired); cond.any?.forEach(checkFired); if (cond.not) checkFired(cond.not);
  };
  c.triggers.forEach(t => checkFired(t.when)); c.rubric.forEach(r => checkFired(r.met));
  for (const h of c.hiddenCompetencies) if (!c.competencies.includes(h)) ctx.addIssue({ code: 'custom', message: `hidden competency "${h}" must also be listed in competencies` });
  if (!c.triggers.some(t => t.then.some(a => a.type === 'endCase'))) ctx.addIssue({ code: 'custom', message: 'case needs at least one trigger that ends it (besides maxSimMin)' });
  for (const p of c.predictionPoints) {
    if (p.format === 'direction' && !p.variables?.length) ctx.addIssue({ code: 'custom', message: `prediction "${p.id}": direction format needs variables` });
    if (p.format === 'choice' && (p.options?.length ?? 0) < 2) ctx.addIssue({ code: 'custom', message: `prediction "${p.id}": choice format needs 2+ options` });
    if (p.marking === 'fixed' && p.answerKey === undefined) ctx.addIssue({ code: 'custom', message: `prediction "${p.id}": fixed marking needs answerKey` });
  }
});

export type CaseFile = z.infer<typeof CaseSchema>;
