import { z } from 'zod';
import type { PracticeItem, PracticeSourceRef } from './types';
import competenciesData from '../shared/competencies.json';

const VALID_COMPETENCY_IDS = new Set<string>();
for (const domain of competenciesData.domains) {
  for (const comp of domain.competencies) {
    VALID_COMPETENCY_IDS.add(comp.id);
  }
}

export const sourceRefSchema = z.object({
  file: z.string().min(1),
  chapter: z.string().min(1),
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
}).refine(data => data.pageEnd >= data.pageStart, {
  message: 'pageEnd must be greater than or equal to pageStart',
});

export const simulatorLinkSchema = z.object({
  type: z.enum(['case', 'lab']),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const predictThenRevealSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('predict-then-reveal'),
  source: sourceRefSchema,
  competencyId: z.string().refine(id => VALID_COMPETENCY_IDS.has(id), {
    message: 'competencyId must exist in competencies.json',
  }),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tags: z.array(z.string()),
  scenario: z.string().min(5),
  question: z.string().min(5),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().min(1),
  explanation: z.string().min(10),
  simulatorCheckLink: simulatorLinkSchema.optional(),
});

export const caseDrillOptionSchema = z.object({
  text: z.string().min(1),
  isCorrect: z.boolean(),
  feedback: z.string().min(5),
});

export const caseDrillStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  prompt: z.string().min(5),
  options: z.array(caseDrillOptionSchema).min(2),
}).refine(step => step.options.some(opt => opt.isCorrect), {
  message: 'Each case drill step must have at least one correct option',
});

export const caseDrillSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('case-drill'),
  source: sourceRefSchema,
  competencyId: z.string().refine(id => VALID_COMPETENCY_IDS.has(id), {
    message: 'competencyId must exist in competencies.json',
  }),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tags: z.array(z.string()),
  vignette: z.string().min(10),
  steps: z.array(caseDrillStepSchema).min(1),
  simulatorCheckLink: simulatorLinkSchema.optional(),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('flashcard'),
  source: sourceRefSchema,
  competencyId: z.string().refine(id => VALID_COMPETENCY_IDS.has(id), {
    message: 'competencyId must exist in competencies.json',
  }),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tags: z.array(z.string()),
  front: z.string().min(5),
  back: z.string().min(3),
  subheading: z.string().optional(),
  cloze: z.boolean().optional(),
  simulatorCheckLink: simulatorLinkSchema.optional(),
});

export const practiceItemSchema = z.discriminatedUnion('kind', [
  predictThenRevealSchema,
  caseDrillSchema,
  flashcardSchema,
]);

export const practicePackSchema = z.array(practiceItemSchema);

export function validatePracticeItem(item: unknown): { success: true; data: PracticeItem } | { success: false; error: z.ZodError } {
  const result = practiceItemSchema.safeParse(item);
  if (result.success) {
    return { success: true, data: result.data as PracticeItem };
  }
  return { success: false, error: result.error };
}

export function validatePracticePack(items: unknown[]): { validCount: number; errors: Array<{ index: number; id?: string; error: string }> } {
  let validCount = 0;
  const errors: Array<{ index: number; id?: string; error: string }> = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const parseResult = practiceItemSchema.safeParse(raw);
    if (!parseResult.success) {
      errors.push({
        index: i,
        id: (raw as any)?.id,
        error: parseResult.error.message,
      });
    } else {
      const item = parseResult.data;
      if (seenIds.has(item.id)) {
        errors.push({
          index: i,
          id: item.id,
          error: `Duplicate item id: ${item.id}`,
        });
      } else {
        seenIds.add(item.id);
        validCount++;
      }
    }
  }

  return { validCount, errors };
}
