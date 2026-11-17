import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { engine, lastTrace } from '../src/engine/index';
import { metricOf } from '../src/engine/metrics';
import { baseExcess } from '../src/engine/gas';
import type { DeviceSettings, PatientParams, PhysState, EngineState } from '../src/shared/engineTypes';
import type { Metric } from '../src/shared/caseSchema';

interface BenchmarkCheck {
  metric: Metric | 'drive' | 'sbe';
  op: '<' | '<=' | '>' | '>=' | 'approx';
  value: number;
  tolerance?: number;
}

interface BenchmarkSpec {
  id: string;
  source: string;
  claim: string;
  patient: PatientParams;
  device: DeviceSettings;
  phys?: Partial<PhysState>;
  runSec: number;
  checks: BenchmarkCheck[];
  kind: 'exact-relation' | 'direction' | 'published-range';
  expectedToFail?: boolean;
  failureReason?: string;
  baseline?: {
    device: DeviceSettings;
    checks: Array<{
      metric: Metric | 'drive' | 'sbe';
      op: '<' | '<=' | '>' | '>=';
    }>;
  };
}

interface SummaryRow {
  id: string;
  kind: string;
  status: string;
  checks: string;
}

const dir = path.resolve(__dirname, 'benchmarks');
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  : [];

const benchmarks: BenchmarkSpec[] = files.map(file => {
  const content = fs.readFileSync(path.join(dir, file), 'utf-8');
  return JSON.parse(content) as BenchmarkSpec;
});

function evaluateCheck(state: EngineState, check: BenchmarkCheck): { pass: boolean; actual: number | null; detail: string } {
  let actual: number | null = metricOf(state, check.metric as Metric);
  if (actual === null || actual === undefined) {
    if ((check.metric as string) === 'drive') {
      const trace = lastTrace(state);
      actual = trace?.drive ?? null;
    } else if ((check.metric as string) === 'sbe') {
      const ph = metricOf(state, 'ph') ?? 7.4;
      actual = baseExcess(state.phys.hco3MmolL, ph);
    } else {
      actual = null;
    }
  }
  if (actual === null) {
    return { pass: false, actual: null, detail: `${check.metric}: actual=null expected ${check.op} ${check.value}` };
  }
  let pass = false;
  let expStr = '';
  switch (check.op) {
    case 'approx': {
      const tol = check.tolerance ?? 1e-4;
      pass = Math.abs(actual - check.value) <= tol;
      expStr = `≈ ${check.value} (±${tol})`;
      break;
    }
    case '<':
      pass = actual < check.value;
      expStr = `< ${check.value}`;
      break;
    case '<=':
      pass = actual <= check.value;
      expStr = `<= ${check.value}`;
      break;
    case '>':
      pass = actual > check.value;
      expStr = `> ${check.value}`;
      break;
    case '>=':
      pass = actual >= check.value;
      expStr = `>= ${check.value}`;
      break;
  }
  return {
    pass,
    actual,
    detail: `${check.metric}: actual=${Number(actual.toFixed(2))} expected ${expStr}`,
  };
}

describe('benchmark suite', () => {
  const summary: SummaryRow[] = [];

  afterAll(() => {
    if (summary.length > 0) {
      console.log('\n============================= BENCHMARK EXECUTION SUMMARY =============================');
      console.table(summary);
      console.log('========================================================================================\n');
    }
  });

  if (benchmarks.length === 0) {
    it.skip('zero benchmarks found in tests/benchmarks/', () => {});
    return;
  }

  for (const b of benchmarks) {
    const isExpectedFail = Boolean(b.expectedToFail);
    const testFn = isExpectedFail ? it.fails : it;

    testFn(`${b.id} (${b.kind})`, () => {
      const state = engine.createState(b.patient, b.device, b.phys);
      const finalState = engine.fastForward(state, b.runSec);
      const results = b.checks.map(c => evaluateCheck(finalState, c));
      const failed = results.filter(r => !r.pass);
      const baselineFailed: string[] = [];
      let baselineSummary = '';
      if (b.baseline) {
        const baseState = engine.createState(b.patient, b.baseline.device, b.phys);
        const finalBase = engine.fastForward(baseState, b.runSec);
        for (const bc of b.baseline.checks) {
          const testVal = evaluateCheck(finalState, { metric: bc.metric, op: '>=', value: 0 }).actual;
          const baseVal = evaluateCheck(finalBase, { metric: bc.metric, op: '>=', value: 0 }).actual;
          if (testVal === null || baseVal === null) {
            baselineFailed.push(`${bc.metric}: null in baseline comparison`);
          } else {
            let pass = false;
            if (bc.op === '<') pass = testVal < baseVal;
            else if (bc.op === '<=') pass = testVal <= baseVal;
            else if (bc.op === '>') pass = testVal > baseVal;
            else if (bc.op === '>=') pass = testVal >= baseVal;
            const str = `${bc.metric}: test=${testVal.toFixed(2)} ${pass ? 'ok' : 'FAIL'} vs base=${baseVal.toFixed(2)} (${bc.op})`;
            if (!pass) baselineFailed.push(str);
            baselineSummary += (baselineSummary ? '; ' : '') + str;
          }
        }
      }

      const allFailed = [...failed.map(f => f.detail), ...baselineFailed];
      const checksSummary = [results.map(r => r.detail).join('; '), baselineSummary].filter(Boolean).join('; ');

      if (allFailed.length > 0) {
        summary.push({
          id: b.id,
          kind: b.kind,
          status: isExpectedFail ? 'EXPECTED_FAIL' : 'FAIL',
          checks: checksSummary,
        });
        throw new Error(`Benchmark check failed: ${allFailed.join('; ')}`);
      } else {
        summary.push({
          id: b.id,
          kind: b.kind,
          status: isExpectedFail ? 'UNEXPECTED_PASS' : 'PASS',
          checks: checksSummary,
        });
        // Note: For it.fails, returning without throwing causes vitest to fail the test as an unexpected pass.
      }
    });
  }
});
