/**
 * Validates every case variant in src/cases/variants against the frozen case schema,
 * and runs each headlessly for 10 sim-minutes through exported runtime functions.
 * Checks that no NaNs occur and all metrics stay within physiological bounds.
 *
 * Usage: npm run variant:check
 * Exits 1 if any variant fails.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { engine } from '../src/engine/index';
import { MemoryEventSink } from '../src/shared/eventSink';
import { CaseSchema, type CaseFile } from '../src/shared/caseSchema';
import { startRun, advance, metric, type Runtime } from '../src/runtime/caseRuntime';
import { mergeVariant, type CaseVariantMetadata } from '../src/cases/variants/loader';

const variantsDir = resolve(__dirname, '../src/cases/variants');
const libraryDir = resolve(__dirname, '../src/cases/library');

const files = readdirSync(variantsDir).filter(f => f.endsWith('.json')).map(f => join(variantsDir, f));

if (files.length === 0) {
  console.error('No variant files found in', variantsDir);
  process.exit(1);
}

let failed = 0;
console.log(`Checking ${files.length} case variants...\n`);

for (const variantPath of files) {
  let rawVariant: unknown;
  try {
    rawVariant = JSON.parse(readFileSync(variantPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${variantPath}: Invalid JSON: ${(err as Error).message}`);
    failed++;
    continue;
  }

  const variant = rawVariant as CaseVariantMetadata;

  // 1. Validate metadata fields
  if (!variant.variantId || !variant.baseCaseId) {
    console.error(`FAIL ${variantPath}: Missing variantId or baseCaseId`);
    failed++;
    continue;
  }
  if (!variant.rationale) {
    console.error(`FAIL ${variantPath}: Missing rationale`);
    failed++;
    continue;
  }
  if (!variant.source) {
    console.error(`FAIL ${variantPath}: Missing clinical source citation`);
    failed++;
    continue;
  }
  if (!variant.retestsMistake?.mistakeId || !variant.retestsMistake?.competencyId) {
    console.error(`FAIL ${variantPath}: Missing retestsMistake (mistakeId & competencyId required)`);
    failed++;
    continue;
  }

  // 2. Load base case
  const baseCasePath = join(libraryDir, `${variant.baseCaseId}.json`);
  let baseCase: CaseFile;
  try {
    const rawBase = JSON.parse(readFileSync(baseCasePath, 'utf8'));
    baseCase = CaseSchema.parse(rawBase);
  } catch (err) {
    console.error(`FAIL ${variantPath}: Failed to load base case "${variant.baseCaseId}": ${(err as Error).message}`);
    failed++;
    continue;
  }

  // 3. Merge overlay and validate schema
  let mergedCase: CaseFile;
  try {
    mergedCase = mergeVariant(baseCase, variant);
  } catch (err) {
    console.error(`FAIL ${variantPath}: Merge or validation error: ${(err as Error).message}`);
    failed++;
    continue;
  }

  // 4. Headless simulation run for 10 sim-minutes (600 seconds)
  const sink = new MemoryEventSink();
  const rt: Runtime = { engine, sink };

  try {
    const runPromise = (async () => {
      const run = await startRun(rt, mergedCase, { sessionId: `check-${variant.variantId}` });
      await advance(rt, run, 600, false);

      const ph = metric(run, 'ph');
      const paco2 = metric(run, 'paco2');
      const spo2 = metric(run, 'spo2');
      const map = metric(run, 'map');
      const ppeak = metric(run, 'ppeak');

      // Check physiological bounds and NaN
      if (ph === null || isNaN(ph) || ph < 6.8 || ph > 7.8) {
        throw new Error(`Invalid pH after 10 sim-min: ${ph}`);
      }
      if (paco2 === null || isNaN(paco2) || paco2 < 15 || paco2 > 160) {
        throw new Error(`Invalid PaCO2 after 10 sim-min: ${paco2}`);
      }
      if (spo2 === null || isNaN(spo2) || spo2 < 50 || spo2 > 100) {
        throw new Error(`Invalid SpO2 after 10 sim-min: ${spo2}`);
      }
      if (map === null || isNaN(map) || map < 30 || map > 220) {
        throw new Error(`Invalid MAP after 10 sim-min: ${map}`);
      }
      if (ppeak !== null && isNaN(ppeak)) {
        throw new Error(`NaN peak pressure detected`);
      }

      return { ph, paco2, spo2, map };
    })();

    // Run synchronously in node script
    await runPromise.then(metrics => {
      console.log(
        `ok   ${variant.variantId} (base: ${variant.baseCaseId})` +
        ` - 10 sim-min headless run ok [pH ${metrics.ph.toFixed(2)}, PaCO2 ${metrics.paco2.toFixed(1)}, SpO2 ${metrics.spo2.toFixed(0)}%]`
      );
    });
  } catch (err) {
    console.error(`FAIL ${variantPath}: Headless sim error: ${(err as Error).message}`);
    failed++;
  }
}

console.log(`\n${files.length - failed}/${files.length} variants valid and verified headlessly.`);
process.exit(failed ? 1 : 0);
