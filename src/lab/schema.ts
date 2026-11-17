import { z } from 'zod';
import {
  COMPETENCY_IDS,
  PatientParamsSchema,
  DeviceSettingsSchema,
  EvidenceSchema,
  METRICS,
  type BaseMetric,
} from '../shared/caseSchema';
import { NOISE_BAND as CASE_NOISE_BAND, type Direction } from '../runtime/caseRuntime';

export const LAB_SCHEMA_VERSION = '1.0';

/**
 * Extended metrics available in the Lab (base metrics plus breath-level quantities
 * needed by experiments such as end-expiratory flow and ineffective efforts).
 */
export const LAB_METRICS = [
  ...METRICS,
  'endExpFlow',
  'ineffectiveEfforts',
] as const;

export type LabMetric = (typeof LAB_METRICS)[number];

/**
 * Noise bands for marking direction predictions in the lab.
 * Uses the runtime's NOISE_BAND and adds bands for breath-level metrics.
 */
export const LAB_NOISE_BAND: Partial<Record<LabMetric, number>> = {
  ...(CASE_NOISE_BAND as Partial<Record<BaseMetric, number>>),
  peep: 0.5,
  pmean: 0.5,
  fio2: 0.02,
  vteMlKgPbw: 0.4,
  hfncPressure: 0.2,
  hfncPaw: 0.2,
  endExpFlow: 0.05,
  ineffectiveEfforts: 0.5,
};

export type { Direction };

const competencyIdSchema = z
  .string()
  .refine((id) => COMPETENCY_IDS.includes(id), {
    message: 'Unknown competency id (see src/shared/competencies.json)',
  });

export const VariableOptionSchema = z
  .object({
    label: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    /** Optional override when changing two coupled variables simultaneously (e.g. VT vs RR at constant VE). */
    deviceOverride: DeviceSettingsSchema.optional(),
    /** Optional patient patch override when a single step changes multiple patient fields. */
    patientOverride: PatientParamsSchema.partial().optional(),
  })
  .strict();

export type VariableOption = z.infer<typeof VariableOptionSchema>;

export const LabVariableSchema = z
  .object({
    target: z.enum(['device', 'patient']),
    /** Field name on DeviceSettings or PatientParams (e.g. 'peep', 'complianceMlPerCmH2O', 'rrSetBpm'). */
    field: z.string().min(1),
    label: z.string().min(1),
    unit: z.string(),
    baselineValue: z.union([z.number(), z.string()]),
    /** Values the learner can apply; index 0 is the primary intervention value tested by default. */
    options: z.array(VariableOptionSchema).min(1),
  })
  .strict();

export type LabVariable = z.infer<typeof LabVariableSchema>;

export const LabPredictionSchema = z
  .object({
    question: z.string().min(1),
    /** Two or three metrics whose direction ('up' | 'down' | 'same') the learner predicts. */
    metrics: z.array(z.enum(LAB_METRICS)).min(2).max(3),
  })
  .strict();

export type LabPrediction = z.infer<typeof LabPredictionSchema>;

export const ReflectionOptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const LabReflectionSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(ReflectionOptionSchema).min(2),
    correctOptionId: z.string().min(1),
    explanation: z.string().min(1),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!r.options.some((o) => o.id === r.correctOptionId)) {
      ctx.addIssue({
        code: 'custom',
        message: `correctOptionId "${r.correctOptionId}" not found in reflection options`,
      });
    }
  });

export type LabReflection = z.infer<typeof LabReflectionSchema>;

/**
 * Trace and physiological node keys that can appear in the causal "Why" chain.
 * All text in the "Why" view is generated strictly from templates keyed to these fields.
 */
export const WHY_TRACE_FIELDS = [
  // Primary intervention / mechanics inputs
  'compliance',
  'expResistance',
  'timeConstant',
  'setPeep',
  'setRr',
  'setVt',
  'setInspFlow',
  'setTi',
  'setPs',
  'setTriggerFlow',
  'setFio2',
  'setHfncFlow',
  // Breath mechanics & timing outputs
  'tiSec',
  'teSec',
  'endExpFlow',
  'trappedVolume',
  'autoPeep',
  'ineffectiveEfforts',
  'vte',
  'ppeak',
  'pplat',
  'drivingPressure',
  'pmean',
  'minuteVent',
  // EngineTrace fields (from src/engine/trace.ts)
  'deadSpaceFraction',
  'alveolarVentilation',
  'steadyPaco2Target',
  'paco2Change',
  'paco2',
  'ph',
  'recruitedFraction',
  'shuntUsed',
  'fio2Effective',
  'pao2Alveolar',
  'pao2',
  'spo2',
  'drive',
  'unloading',
  'ptp',
  'fatigueChange',
  'circulationMultiplier',
  'map',
  'sbp',
  'hr',
  'hfncPressure',
] as const;

export type WhyTraceField = (typeof WHY_TRACE_FIELDS)[number];

export const LabExperimentSchema = z
  .object({
    schemaVersion: z.literal(LAB_SCHEMA_VERSION),
    id: z.string().regex(/^[0-9]{2}-[a-z0-9-]+$/),
    number: z.number().int().min(1).max(20),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    difficulty: z.number().int().min(1).max(3).default(1),
    competencies: z.array(competencyIdSchema).min(1),
    contextTags: z.array(z.string()).min(1),
    /** True if the primary mechanism demonstrated includes rule-based links (e.g. circulation, HFNC PEEP, recruitment, unloading). */
    ruleBased: z.boolean().default(false),
    ruleBasedNote: z.string().optional(),
    patient: z
      .object({
        displayName: z.string().min(1),
        summary: z.string().min(1),
        params: PatientParamsSchema,
      })
      .strict(),
    initialDevice: DeviceSettingsSchema,
    initialPhys: z
      .object({
        paco2MmHg: z.number(),
        pao2MmHg: z.number().optional(),
        hco3MmolL: z.number().optional(),
        fatigue: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    /** Seconds to run at baseline before capturing baseline snapshot (default 30). */
    baselineSimSec: z.number().int().min(5).max(300).default(30),
    variable: LabVariableSchema,
    prediction: LabPredictionSchema,
    /** Seconds to run after applying the variable change so the learner and engine observe the effect. */
    observeSimSec: z.number().int().min(10).max(600),
    /** Short "what to look at" hint shown before commitment — must NEVER give away the direction or answer. */
    whatToLookAtHint: z.string().min(1),
    reflection: LabReflectionSchema,
    /** Ordered list of causal trace fields to render in the "Why" view after commitment. */
    causalChainFields: z.array(z.enum(WHY_TRACE_FIELDS)).min(3),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .strict();

export type LabExperiment = z.infer<typeof LabExperimentSchema>;

/** Test IDs for Lab UI and E2E tests. */
export const LAB_TEST_IDS = {
  TAB_LAB: 'tab-lab',
  LAB_LIST: 'lab-experiment-list',
  LAB_CARD_PREFIX: 'lab-card-',
  LAB_RUNNER: 'lab-runner',
  LAB_BACK_BTN: 'lab-back-btn',
  LAB_STAGE_BADGE: 'lab-stage-badge',
  LAB_HINT: 'lab-what-to-look-at',
  LAB_VARIABLE_SELECT: 'lab-variable-select',
  LAB_PREDICTION_PANEL: 'lab-prediction-panel',
  LAB_CONFIDENCE_PREFIX: 'lab-confidence-',
  LAB_COMMIT_BTN: 'lab-commit-btn',
  LAB_BEFORE_AFTER_TABLE: 'lab-before-after-table',
  LAB_REFLECTION_PANEL: 'lab-reflection-panel',
  LAB_REFLECTION_OPT_PREFIX: 'lab-reflection-opt-',
  LAB_REFLECTION_SUBMIT: 'lab-reflection-submit',
  LAB_WHY_TAB_BTN: 'lab-why-open-btn',
  LAB_WHY_LOCKED: 'lab-why-locked',
  LAB_WHY_VIEW: 'lab-why-view',
  LAB_WHY_NODE_PREFIX: 'lab-why-node-',
  LAB_RULE_BASED_BADGE: 'lab-rule-based-badge',
} as const;
