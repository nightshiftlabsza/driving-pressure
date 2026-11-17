/**
 * Validates every case file in src/cases/library against the frozen case schema.
 * Usage: npm run case:check            (all cases)
 *        npm run case:check -- path.json (one file)
 * Exits 1 if any case fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CaseSchema } from '../src/shared/caseSchema';
import type { Condition, OrderType } from '../src/shared/caseSchema';
import { acuteBuffer } from '../src/engine/gas';

const dir = resolve(__dirname, '../src/cases/library');
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith('.json')).map(f => join(dir, f));
let failed = 0;
const ids = new Map<string, string>();

/** Orders handled directly by the case runtime (see placeOrder in src/runtime/caseRuntime.ts). */
const RUNTIME_HANDLED_ORDERS = new Set<OrderType>([
  'abg',
  'cxr',
  'examine',
  'change-device',
  'change-settings',
  'intubate',
  'disconnect-ventilator',
]);

function collectOrderedConditions(cond: Condition | undefined, set: Set<OrderType>): void {
  if (!cond) return;
  if (cond.ordered) set.add(cond.ordered.order);
  if (cond.all) for (const c of cond.all) collectOrderedConditions(c, set);
  if (cond.any) for (const c of cond.any) collectOrderedConditions(c, set);
  if (cond.not) collectOrderedConditions(cond.not, set);
}

for (const f of files) {
  let json: unknown;
  try { json = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.error(`FAIL ${f}: invalid JSON: ${(e as Error).message}`); failed++; continue; }
  const r = CaseSchema.safeParse(json);
  if (!r.success) {
    failed++;
    console.error(`FAIL ${f}`);
    for (const i of r.error.issues) console.error(`  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    continue;
  }
  if (ids.has(r.data.id)) { failed++; console.error(`FAIL ${f}: duplicate case id "${r.data.id}" (also in ${ids.get(r.data.id)})`); continue; }
  ids.set(r.data.id, f);

  const conditionOrders = new Set<OrderType>();
  for (const t of r.data.triggers) collectOrderedConditions(t.when, conditionOrders);
  for (const item of r.data.rubric) collectOrderedConditions(item.met, conditionOrders);
  const effectOrders = new Set(r.data.orderEffects.map(e => e.order));

  const deadEndOrders = r.data.availableOrders.filter(
    o => !RUNTIME_HANDLED_ORDERS.has(o) && !effectOrders.has(o) && !conditionOrders.has(o)
  );

  if (deadEndOrders.length > 0) {
    failed++;
    console.error(`FAIL ${f}: dead-end orders: ${deadEndOrders.map(o => `"${o}"`).join(', ')}`);
    for (const o of deadEndOrders) {
      console.error(`  - order "${o}" has no orderEffects entry, is not handled by runtime, and is not used in any trigger or rubric condition`);
    }
    continue;
  }

  // Chronic compensation check: warn if measured initial HCO3 diverges from expected chronic + acute buffer by > 2 mmol/L
  const chronicPaco2 = r.data.patient.params.chronicPaco2MmHg;
  if (r.data.initialPhys.hco3MmolL !== undefined && chronicPaco2 !== undefined) {
    const expected = (24 + 0.35 * Math.max(0, chronicPaco2 - 40)) + acuteBuffer(r.data.initialPhys.paco2MmHg - chronicPaco2, 24, 0);
    if (Math.abs(r.data.initialPhys.hco3MmolL - expected) > 2.0) {
      console.warn(`WARN ${f}: initialPhys.hco3MmolL (${r.data.initialPhys.hco3MmolL}) differs from expected starting HCO3 (${expected.toFixed(1)}) by > 2.0 mmol/L`);
    }
  }

  console.log(`ok   ${f} (${r.data.id} v${r.data.version})`);
}
console.log(`\n${files.length - failed}/${files.length} case files valid`);
if (files.length === 0) console.log('No case files found.');
process.exit(failed ? 1 : 0);
