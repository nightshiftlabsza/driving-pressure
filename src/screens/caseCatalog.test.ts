import { describe, it, expect } from 'vitest';
import { validateCase, validateCaseCatalog, loadCaseLibrary } from './caseCatalog';
import realCopdCase from '../cases/library/copd-niv-01.json';

describe('caseCatalog', () => {
  it('accepts a valid case file', () => {
    const result = validateCase(realCopdCase, 'src/cases/library/copd-niv-01.json');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.caseFile.id).toBe('copd-niv-01');
      expect(result.caseFile.title).toBe('Breathless at 3 a.m. on the respiratory ward');
    }
  });

  it('reports broken case with descriptive reasons and does not throw', () => {
    const brokenCases: unknown[] = [
      null,
      undefined,
      {},
      { id: 'broken-1' }, // missing most required fields
      {
        ...realCopdCase,
        setting: 'space_station', // invalid enum
      },
      {
        ...realCopdCase,
        difficulty: 5, // out of range (1..3)
      },
      {
        ...realCopdCase,
        competencies: ['unknown.competency.id'], // invalid competency ID
      },
      {
        ...realCopdCase,
        triggers: realCopdCase.triggers.filter(t => !t.then.some(a => a.type === 'endCase')), // no endCase trigger
      },
    ];

    for (const badCase of brokenCases) {
      expect(() => {
        const result = validateCase(badCase, 'fake/path.json');
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.failure.reasons.length).toBeGreaterThan(0);
          expect(typeof result.failure.reasons[0]).toBe('string');
        }
      }).not.toThrow();
    }
  });

  it('validateCaseCatalog separates valid cases from broken ones and catches duplicates', () => {
    const brokenCase = { ...realCopdCase, title: undefined };
    const duplicateCase = { ...realCopdCase };

    const catalog = validateCaseCatalog([
      { path: 'cases/valid-1.json', raw: realCopdCase },
      { path: 'cases/broken.json', raw: brokenCase },
      { path: 'cases/duplicate.json', raw: duplicateCase },
    ]);

    expect(catalog.cases).toHaveLength(1);
    expect(catalog.cases[0]?.id).toBe('copd-niv-01');
    expect(catalog.failures.length).toBe(2);
    expect(catalog.invalid.length).toBe(2);

    const duplicateFailure = catalog.failures.find(f => f.path === 'cases/duplicate.json');
    expect(duplicateFailure).toBeDefined();
    expect(duplicateFailure?.reasons[0]).toMatch(/Duplicate case id/i);
  });

  it('loadCaseLibrary loads existing cases without throwing', () => {
    const result = loadCaseLibrary();
    expect(Array.isArray(result.cases)).toBe(true);
    expect(Array.isArray(result.failures)).toBe(true);
    // every file in the library folder must load
    const files = Object.keys(import.meta.glob('/src/cases/library/*.json'));
    expect(result.cases.length).toBe(files.length);
    expect(result.failures).toHaveLength(0);

    const copd = result.cases.find(c => c.id === 'copd-niv-01');
    expect(copd).toBeDefined();
    expect(copd?.title).toBe('Breathless at 3 a.m. on the respiratory ward');
  });

  it('handles raw JSON syntax errors gracefully', () => {
    const result = validateCase({ __syntaxError: 'Unexpected token } in JSON at position 42' }, 'cases/malformed.json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failure.reasons[0]).toMatch(/Invalid JSON: Unexpected token/i);
    }
  });
});
