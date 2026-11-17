import { describe, it, expect } from 'vitest';
import { deepMerge, mergeVariant, type CaseVariantMetadata } from './loader';
import rawBase from '../library/ards-vent-01.json';
import { CaseSchema, type CaseFile } from '../../shared/caseSchema';

describe('Case Variant Loader (src/cases/variants/loader.ts)', () => {
  const baseCase = CaseSchema.parse(rawBase) as CaseFile;

  it('deepMerges nested objects and replaces arrays', () => {
    const base = {
      a: 1,
      b: { c: 2, d: 3 },
      arr: [1, 2, 3],
    };
    const overlay = {
      b: { d: 4, e: 5 },
      arr: [4, 5],
    };
    const merged = deepMerge(base, overlay);
    expect(merged).toEqual({
      a: 1,
      b: { c: 2, d: 4, e: 5 },
      arr: [4, 5],
    });
  });

  it('merges a valid variant overlay onto a base case producing a valid CaseFile', () => {
    const variantMeta: CaseVariantMetadata = {
      variantId: 'ards-vent-01--pbw-short-female',
      baseCaseId: 'ards-vent-01',
      title: 'Disguised title',
      summary: 'Disguised summary',
      rationale: 'Testing PBW',
      retestsMistake: {
        mistakeId: 'knowledge_gap',
        competencyId: 'disease.ards',
        clinicalFocus: 'PBW',
      },
      source: 'ARDSNet 2000; teaching-convention',
      changes: {
        vignette: 'Female 152 cm',
        parametersChanged: {},
      },
      overlay: {
        patient: {
          ...baseCase.patient,
          params: {
            ...baseCase.patient.params,
            sex: 'F',
            heightCm: 152,
            actualWeightKg: 94,
          },
        },
      },
    };

    const merged = mergeVariant(baseCase, variantMeta);
    expect(merged.id).toBe('ards-vent-01--pbw-short-female');
    expect(merged.title).toBe('Disguised title');
    expect(merged.patient.params.sex).toBe('F');
    expect(merged.patient.params.heightCm).toBe(152);
    expect(merged.patient.params.actualWeightKg).toBe(94);
  });

  it('throws an error if the merged case fails CaseSchema validation', () => {
    const invalidVariantMeta: CaseVariantMetadata = {
      variantId: 'ards-vent-01--invalid',
      baseCaseId: 'ards-vent-01',
      title: 'Invalid',
      summary: 'Invalid',
      rationale: 'Invalid',
      retestsMistake: {
        mistakeId: 'knowledge_gap',
        competencyId: 'disease.ards',
        clinicalFocus: 'Invalid',
      },
      source: 'Invalid',
      changes: {
        vignette: 'Invalid',
        parametersChanged: {},
      },
      overlay: {
        difficulty: 99 as unknown as 1, // Invalid difficulty > 3
      },
    };

    expect(() => mergeVariant(baseCase, invalidVariantMeta)).toThrow(/failed schema validation/);
  });
});

describe('variant visibility', () => {
  it('the autopeep variant was unhidden after the engine fix: it is in the learner catalog', async () => {
    const { loadAllCasesWithVariants } = await import('../../screens/caseCatalog');
    const cat = loadAllCasesWithVariants();
    const id = 'copd-psv-trigger-01--ineffective-efforts-autopeep';
    expect(cat.variants.some(v => v.id === id)).toBe(true);
    expect(cat.variantsMeta[id]).toBeDefined();
    expect(cat.variants.length).toBeGreaterThan(0);
  });
});
