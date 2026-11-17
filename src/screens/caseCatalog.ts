import { CaseSchema, type CaseFile } from '../shared/caseSchema';
import { mergeVariant, type CaseVariantMetadata } from '../cases/variants/loader';

export interface CaseLoadFailure {
  path?: string;
  id?: string;
  reasons: string[];
}

export interface CaseCatalogResult {
  cases: CaseFile[];
  failures: CaseLoadFailure[];
  invalid: CaseLoadFailure[];
}

/**
 * Validates a single potential case object against CaseSchema.
 * Never throws on malformed input.
 */
export function validateCase(
  raw: unknown,
  path?: string
): { success: true; caseFile: CaseFile } | { success: false; failure: CaseLoadFailure } {
  try {
    if (raw && typeof raw === 'object' && '__syntaxError' in raw) {
      return {
        success: false,
        failure: {
          path,
          reasons: [`Invalid JSON: ${String((raw as { __syntaxError: string }).__syntaxError)}`],
        },
      };
    }

    const result = CaseSchema.safeParse(raw);
    if (!result.success) {
      const reasons = result.error.issues.map(
        issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`
      );
      const rawObj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      const id = typeof rawObj['id'] === 'string' ? rawObj['id'] : undefined;
      return {
        success: false,
        failure: {
          path,
          id,
          reasons,
        },
      };
    }

    return {
      success: true,
      caseFile: result.data,
    };
  } catch (err) {
    return {
      success: false,
      failure: {
        path,
        reasons: [err instanceof Error ? err.message : String(err)],
      },
    };
  }
}

/**
 * Validates an array or record of candidate case objects.
 * Useful for pure validation tests in Node/Vitest without needing Vite bundler hooks.
 */
export function validateCaseCatalog(
  entries: Array<{ path?: string; raw: unknown }> | Record<string, unknown>
): CaseCatalogResult {
  const normalizedEntries: Array<{ path?: string; raw: unknown }> = Array.isArray(entries)
    ? entries
    : Object.entries(entries).map(([path, raw]) => ({ path, raw }));

  const cases: CaseFile[] = [];
  const failures: CaseLoadFailure[] = [];
  const seenIds = new Map<string, string | undefined>();

  for (const entry of normalizedEntries) {
    // Vite eager JSON imports may export the JSON object as default or directly
    const actualData =
      entry.raw && typeof entry.raw === 'object' && 'default' in entry.raw
        ? (entry.raw as { default: unknown }).default
        : entry.raw;

    const validated = validateCase(actualData, entry.path);
    if (validated.success) {
      const existingPath = seenIds.get(validated.caseFile.id);
      if (existingPath !== undefined || seenIds.has(validated.caseFile.id)) {
        failures.push({
          path: entry.path,
          id: validated.caseFile.id,
          reasons: [
            `Duplicate case id "${validated.caseFile.id}" (already defined in ${existingPath ?? 'earlier case'})`,
          ],
        });
      } else {
        seenIds.set(validated.caseFile.id, entry.path);
        cases.push(validated.caseFile);
      }
    } else {
      failures.push(validated.failure);
    }
  }

  return {
    cases,
    failures,
    invalid: failures,
  };
}

/**
 * Loads and validates all case JSON files from `src/cases/library/*.json`
 * using Vite's eager import.meta.glob.
 * Returns valid cases and detailed failure records for any invalid files.
 * Never throws on invalid JSON or broken case schemas.
 */
export function loadCaseLibrary(): CaseCatalogResult {
  try {
    const rawModules = import.meta.glob<string>('/src/cases/library/*.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    });

    const entries: Array<{ path: string; raw: unknown }> = [];
    for (const [path, content] of Object.entries(rawModules)) {
      if (typeof content === 'string') {
        try {
          const parsed: unknown = JSON.parse(content);
          entries.push({ path, raw: parsed });
        } catch (err) {
          entries.push({
            path,
            raw: {
              __syntaxError: err instanceof Error ? err.message : String(err),
            },
          });
        }
      } else {
        entries.push({ path, raw: content });
      }
    }

    return validateCaseCatalog(entries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      cases: [],
      failures: [{ reasons: [msg] }],
      invalid: [{ reasons: [msg] }],
    };
  }
}

export interface FullCaseCatalogResult extends CaseCatalogResult {
  baseCases: CaseFile[];
  variants: CaseFile[];
  variantsMeta: Record<string, CaseVariantMetadata>;
}

/**
 * Loads all library cases and merges all case variants from `src/cases/variants/*.json`.
 * Keeps `cases` equal to all validated base cases so library callers work unchanged while
 * providing merged variants and metadata for disguised spaced re-tests.
 */
export function loadAllCasesWithVariants(): FullCaseCatalogResult {
  const libraryResult = loadCaseLibrary();
  const baseMap = new Map(libraryResult.cases.map(c => [c.id, c]));
  const variants: CaseFile[] = [];
  const variantsMeta: Record<string, CaseVariantMetadata> = {};

  try {
    const variantModules = import.meta.glob<string>('/src/cases/variants/*.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    });

    for (const content of Object.values(variantModules)) {
      if (typeof content !== 'string') continue;
      try {
        const meta = JSON.parse(content) as CaseVariantMetadata;
        const base = baseMap.get(meta.baseCaseId);
        if (!base || meta.hidden === true) continue;
        const merged = mergeVariant(base, meta);
        variants.push(merged);
        variantsMeta[meta.variantId] = meta;
      } catch {
        // Invalid variant skipped cleanly; scripts/variant-check.ts validates all files
      }
    }
  } catch {
    // Variant glob optional in node test environments without Vite glob
  }

  return {
    cases: libraryResult.cases,
    failures: libraryResult.failures,
    invalid: libraryResult.invalid,
    baseCases: libraryResult.cases,
    variants,
    variantsMeta,
  };
}
