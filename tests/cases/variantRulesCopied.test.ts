import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { mergeVariant, type CaseVariantMetadata } from '../../src/cases/variants/loader';

const libraryDir = join(__dirname, '../../src/cases/library');
const variantsDir = join(__dirname, '../../src/cases/variants');

function loadBase(name: string): CaseFile {
  return CaseSchema.parse(JSON.parse(readFileSync(join(libraryDir, `${name}.json`), 'utf8')));
}

function loadVariantFile(name: string): { meta: CaseVariantMetadata; merged: CaseFile } {
  const meta: CaseVariantMetadata = JSON.parse(readFileSync(join(variantsDir, `${name}.json`), 'utf8'));
  const base = loadBase(meta.baseCaseId);
  const merged = mergeVariant(base, meta);
  return { meta, merged };
}

describe('variantRulesCopied', () => {
  const baseSbt = loadBase('sbt-pass-01');
  const baseArds = loadBase('ards-vent-01');

  describe('SBT variants inherit required triggers from sbt-pass-01', () => {
    it('sbt-pass-01--pass-older-patient has t-extubate-early and t-extubate-success matching base', () => {
      const { merged } = loadVariantFile('sbt-pass-01--pass-older-patient');

      const baseEarly = baseSbt.triggers.find(t => t.id === 't-extubate-early')!;
      expect(baseEarly).toBeDefined();

      const baseSuccess = baseSbt.triggers.find(t => t.id === 't-extubate-success')!;
      expect(baseSuccess).toBeDefined();

      const mergedEarly = merged.triggers.find(t => t.id === 't-extubate-early');
      expect(mergedEarly).toBeDefined();
      expect(mergedEarly?.when).toEqual(baseEarly.when);
      expect(mergedEarly?.then[0]).toEqual(baseEarly.then[0]);
      const endAction = mergedEarly?.then[1];
      expect(endAction?.type).toBe('endCase');
      if (endAction && endAction.type === 'endCase') {
        expect(endAction.outcome).toBe('stable');
        expect(endAction.reason).toBe(
          'Extubated before the trial was complete. He did well, but the decision was made too early.'
        );
      }

      const mergedSuccess = merged.triggers.find(t => t.id === 't-extubate-success');
      expect(mergedSuccess).toBeDefined();
      expect(mergedSuccess?.when).toEqual(baseSuccess.when);
      expect(mergedSuccess?.then).toEqual(baseSuccess.then);

      // Rubric condition r-extubate-timely
      const baseRubric = baseSbt.rubric.find(r => r.id === 'r-extubate-timely')!;
      const mergedRubric = merged.rubric.find(r => r.id === 'r-extubate-timely')!;
      expect(mergedRubric.met).toEqual(baseRubric.met);
    });

    it('sbt-pass-01--borderline-reassess has t-extubate-early matching base', () => {
      const { merged } = loadVariantFile('sbt-pass-01--borderline-reassess');

      const baseEarly = baseSbt.triggers.find(t => t.id === 't-extubate-early')!;
      expect(baseEarly).toBeDefined();

      const mergedEarly = merged.triggers.find(t => t.id === 't-extubate-early');
      expect(mergedEarly).toBeDefined();
      expect(mergedEarly?.when).toEqual(baseEarly.when);
      expect(mergedEarly?.then).toEqual(baseEarly.then);
    });
  });

  describe('ARDS variants inherit senior-oxygenation and hypoxaemia-persisted triggers from ards-vent-01', () => {
    const ardsVariants = [
      'ards-vent-01--high-dead-space',
      'ards-vent-01--moderate-low-recruit',
      'ards-vent-01--obese-stiff-chest-wall',
      'ards-vent-01--pbw-short-female',
      'ards-vent-01--severe-high-recruit',
      'ards-vent-01--severe-low-recruit',
      'ards-vent-01--severe-prone-elderly',
    ];

    const baseSenior = baseArds.triggers.find(t => t.id === 'senior-oxygenation')!;
    const basePersisted = baseArds.triggers.find(t => t.id === 'hypoxaemia-persisted')!;

    for (const vId of ardsVariants) {
      it(`${vId} contains senior-oxygenation and hypoxaemia-persisted with matching when/then`, () => {
        const { merged } = loadVariantFile(vId);

        const vSenior = merged.triggers.find(t => t.id === 'senior-oxygenation');
        expect(vSenior, `${vId} missing senior-oxygenation`).toBeDefined();
        expect(vSenior?.when).toEqual(baseSenior.when);

        const isFemale = merged.patient?.params?.sex === 'F';
        const expectedSeniorText = isFemale
          ? "She's still desaturated. What is your plan for her oxygenation?"
          : "He's still desaturated. What is your plan for his oxygenation?";

        expect(vSenior?.then).toEqual([
          {
            type: 'message',
            from: 'senior',
            text: expectedSeniorText,
          },
        ]);

        const vPersisted = merged.triggers.find(t => t.id === 'hypoxaemia-persisted');
        expect(vPersisted, `${vId} missing hypoxaemia-persisted`).toBeDefined();
        expect(vPersisted?.when).toEqual(basePersisted.when);
        expect(vPersisted?.then).toEqual(basePersisted.then);
      });
    }
  });
});
