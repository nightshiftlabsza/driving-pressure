/**
 * Case variant loader.
 *
 * Merges a variant JSON overlay onto its base case and validates the resulting
 * composite case against the frozen CaseSchema.
 */

import { CaseSchema, type CaseFile } from '../../shared/caseSchema';
import type { PatientParams } from '../../shared/engineTypes';

export interface CaseVariantMetadata {
  variantId: string;
  baseCaseId: string;
  title: string;
  summary: string;
  rationale: string;
  retestsMistake: {
    mistakeId: string;
    competencyId: string;
    clinicalFocus: string;
  };
  source: string;
  changes: {
    vignette: string;
    parametersChanged: Record<string, { from: unknown; to: unknown; reason: string }>;
  };
  /** When true the variant is hidden from learners (catalog/scheduler) but still loads headlessly. */
  hidden?: boolean;
  overlay: Record<string, unknown>;
}

/**
 * Deep merge utility for applying overlay properties onto a base object.
 * Arrays in the overlay replace arrays in the base (e.g. predictionPoints, contextTags).
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Merges a variant's overlay onto its base case and validates against CaseSchema.
 */
export function mergeVariant(baseCase: CaseFile, variant: CaseVariantMetadata): CaseFile {
  const rawMerged = deepMerge(baseCase as unknown as Record<string, unknown>, variant.overlay);

  // Ensure mandatory identity fields
  rawMerged.id = variant.variantId;
  if (variant.title) rawMerged.title = variant.title;
  if (variant.summary) rawMerged.summary = variant.summary;

  const parsed = CaseSchema.safeParse(rawMerged);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Variant "${variant.variantId}" failed schema validation: ${errorDetails}`);
  }

  return parsed.data;
}
