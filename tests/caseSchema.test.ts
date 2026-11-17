import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, COMPETENCY_IDS } from '../src/shared/caseSchema';
import competencies from '../src/shared/competencies.json';

const dir = join(__dirname, '../src/cases/library');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('case schema', () => {
  it('every library case validates', () => {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const r = CaseSchema.safeParse(load(f));
      expect(r.success, `${f}: ${!r.success ? JSON.stringify(r.error.issues.slice(0, 3)) : ''}`).toBe(true);
    }
  });
  it('rejects an unknown competency id', () => {
    const c = load('copd-niv-01.json'); c.competencies.push('not.a.competency');
    expect(CaseSchema.safeParse(c).success).toBe(false);
  });
  it('rejects a prediction action pointing to a missing prediction', () => {
    const c = load('copd-niv-01.json'); c.triggers[0].then[0].predictionId = 'missing';
    expect(CaseSchema.safeParse(c).success).toBe(false);
  });
  it('rejects a case with no ending trigger', () => {
    const c = load('copd-niv-01.json');
    c.triggers = c.triggers.filter((t: any) => !t.then.some((a: any) => a.type === 'endCase'));
    expect(CaseSchema.safeParse(c).success).toBe(false);
  });
  it('rejects a condition with two keys', () => {
    const c = load('copd-niv-01.json');
    c.rubric[0].met = { ordered: { order: 'abg' }, fired: 'improved' };
    expect(CaseSchema.safeParse(c).success).toBe(false);
  });
  it('rejects out-of-range physiology', () => {
    const c = load('copd-niv-01.json'); c.patient.params.complianceMlPerCmH2O = 500;
    expect(CaseSchema.safeParse(c).success).toBe(false);
  });
});

describe('competencies', () => {
  it('ids are unique and well formed', () => {
    expect(new Set(COMPETENCY_IDS).size).toBe(COMPETENCY_IDS.length);
    for (const id of COMPETENCY_IDS) expect(id).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
    expect(competencies.domains.length).toBe(8);
  });
});
