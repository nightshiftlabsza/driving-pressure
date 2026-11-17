import type { CaseFile } from '../../shared/caseSchema';
import type { DeviceSettings } from '../../shared/engineTypes';
import type { RunSummary } from '../../shared/learnerApi';
import mistakesJson from '../../shared/mistakes.json';
import competenciesJson from '../../shared/competencies.json';
import { describeDecision } from '../../review/describeDecision';
import { formatClinical, type ClinicalKind } from '../../review/formatClinical';
import type {
  DecisionClassification,
  MetricPoint,
  ProcessClass,
  ReplayDecisionPoint,
} from '../../review/types';

/** Run summary, optionally carrying predictions that ran out of time before they could be scored. */
export type DebriefRun = RunSummary & {
  unscoredPredictions?: { predictionId: string; elapsedSec: number }[];
};

const COMPETENCY_NAMES = new Map<string, string>(
  competenciesJson.domains.flatMap(d => d.competencies.map(c => [c.id, c.name] as [string, string]))
);

/** Human-readable competency title; never returns a raw id. */
export function competencyTitle(id: string): string {
  return COMPETENCY_NAMES.get(id) ?? 'Other clinical skill';
}

function humanise(id: string): string {
  const s = id.replace(/[-_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function mistakeTitle(id: string): string {
  return mistakesJson.mistakes.find(m => m.id === id)?.name ?? humanise(id);
}

export function formatSimTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function outcomeSentence(outcome: string | null): string {
  switch (outcome) {
    case 'improved': return 'The patient improved.';
    case 'stable': return 'The patient was stable at the end of the case.';
    case 'deteriorated': return 'The patient deteriorated.';
    case 'died': return 'The patient died.';
    case 'escalated': return 'The case was escalated.';
    case 'abandoned': return 'The case was abandoned before it finished.';
    case 'completed': return 'The case was completed.';
    default: return 'The case is finished.';
  }
}

export interface Endpoint { label: string; value: string; unit: string }

function lastValue(metrics: MetricPoint[], key: keyof MetricPoint): number | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    const v = metrics[i]![key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Up to four end-of-run values that matter for this case, from the last replayed values. */
export function pickEndpoints(caseFile: CaseFile, metrics: MetricPoint[]): Endpoint[] {
  const out: Endpoint[] = [];
  const isArds = caseFile.contextTags.includes('ards');
  const add = (label: string, unit: string, v: number | null, kind?: ClinicalKind, digits = 0) => {
    if (v === null || out.length >= 4) return;
    out.push({ label, unit, value: kind ? formatClinical(kind, v) : v.toFixed(digits) });
  };
  const pplat = lastValue(metrics, 'pplat');
  const dp = lastValue(metrics, 'drivingPressure');
  const invasive = pplat !== null || dp !== null;
  if (invasive) {
    add('Pplat', 'cmH2O', pplat, 'pplat');
    add('Driving pressure', 'cmH2O', dp, 'drivingPressure');
    add('Vt', 'mL/kg PBW', lastValue(metrics, 'vteMlKgPbw'), undefined, 1);
  }
  add('SpO2', '%', lastValue(metrics, 'spo2'), 'spo2');
  if (isArds) add('P:F', '', lastValue(metrics, 'pfRatio'), undefined, 0);
  if (!invasive) {
    add('PaCO2', 'mmHg', lastValue(metrics, 'paco2'), 'paco2');
    add('pH', '', lastValue(metrics, 'ph'), 'ph');
  }
  return out;
}

export interface ChartBand { lo: number | null; hi: number | null; label: string }
export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  kind: ClinicalKind;
  points: { t: number; v: number }[];
  band?: ChartBand;
}

/** Series from the replayed record. Bands only where a stated target applies to this case. */
export function buildChartSeries(caseFile: CaseFile, metrics: MetricPoint[]): ChartSeries[] {
  const isArds = caseFile.contextTags.includes('ards');
  const defs: { key: keyof MetricPoint; label: string; unit: string; kind: ClinicalKind; band?: (invasive: boolean) => ChartBand | undefined }[] = [
    { key: 'spo2', label: 'SpO2', unit: '%', kind: 'spo2', band: () => (isArds ? { lo: 88, hi: 95, label: 'Target 88-95% (ARDSNet)' } : undefined) },
    { key: 'pplat', label: 'Plateau pressure', unit: 'cmH2O', kind: 'pplat', band: inv => (inv ? { lo: null, hi: 30, label: 'Target at or below 30' } : undefined) },
    { key: 'drivingPressure', label: 'Driving pressure', unit: 'cmH2O', kind: 'drivingPressure', band: inv => (inv ? { lo: null, hi: 15, label: 'Target at or below 15' } : undefined) },
    { key: 'paco2', label: 'PaCO2', unit: 'mmHg', kind: 'paco2' },
  ];
  const invasive = metrics.some(m => m.pplat != null || m.drivingPressure != null);
  const out: ChartSeries[] = [];
  for (const d of defs) {
    const points = metrics
      .filter(m => typeof m[d.key] === 'number' && Number.isFinite(m[d.key] as number))
      .map(m => ({ t: m.simTimeSec, v: m[d.key] as number }));
    if (points.length < 2) continue;
    out.push({ key: String(d.key), label: d.label, unit: d.unit, kind: d.kind, points, band: d.band?.(invasive) });
  }
  return out;
}

export interface DecisionItem {
  key: string;
  title: string;
  did?: string;
  happened?: string;
  why?: string;
  tone: 'bad' | 'good' | 'neutral';
  point?: ReplayDecisionPoint;
}

const PROCESS_PRIORITY: Partial<Record<ProcessClass, number>> = { unsafe: 0, 'wrong-target': 3, delayed: 3 };

/** At most three items that mattered most, drawn only from the run record and case text. */
export function pickDecisions(
  run: DebriefRun,
  caseFile: CaseFile,
  classifications: DecisionClassification[],
  replayDecisions: ReplayDecisionPoint[],
  max = 3
): DecisionItem[] {
  type Cand = DecisionItem & { rank: number; comp?: string };
  const cands: Cand[] = [];

  for (let i = 0; i < classifications.length; i++) {
    const c = classifications[i]!;
    const rank = PROCESS_PRIORITY[c.processClass];
    if (rank === undefined) continue;

    let previousSettings = caseFile?.initialDevice as unknown as DeviceSettings | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const prevDec = classifications[j]!.decision;
      const s = prevDec.settings ?? (prevDec.detail?.settings as DeviceSettings | undefined) ?? (prevDec.detail?.device as DeviceSettings | undefined);
      if (prevDec.kind === 'settings_change' && s) {
        previousSettings = s;
        break;
      }
    }

    cands.push({
      key: `dec-${c.decisionIndex}`,
      rank,
      title: `At ${formatSimTime(c.decision.simTimeSec)}: ${c.processClass === 'unsafe' ? 'an unsafe action' : c.processClass === 'delayed' ? 'a delayed action' : 'action aimed at the wrong target'}`,
      did: describeDecision(c.decision, previousSettings),
      happened: c.response.summary,
      why: c.ruleExplanation,
      tone: 'bad',
      point: replayDecisions.find(p => p.index === c.decisionIndex),
    });
  }

  for (const r of run.rubric) {
    const def = caseFile.rubric.find(x => x.id === r.rubricId);
    const critical = r.critical || Boolean(def?.critical);
    if (!critical || !def) continue;
    const related = run.mistakes.find(m => m.competency === def.competency);
    cands.push({
      key: `rub-${r.rubricId}`,
      rank: r.met ? 5 : 1,
      comp: def.competency,
      title: def.description,
      did: r.met
        ? 'You met this critical requirement.'
        : `Not done by the end of the run${def.bySimMin ? ` (expected by ${formatSimTime(def.bySimMin * 60)})` : ''}.`,
      happened: !r.met && related ? related.detail : undefined,
      why: `Skill: ${competencyTitle(def.competency)}.`,
      tone: r.met ? 'good' : 'bad',
    });
  }

  for (const [i, m] of run.mistakes.entries()) {
    if (m.severity === 'minor') continue;
    const remediation = mistakesJson.mistakes.find(x => x.id === m.mistake)?.response;
    cands.push({
      key: `mis-${i}`,
      rank: m.severity === 'critical' ? 1 : 2,
      comp: m.competency,
      title: mistakeTitle(m.mistake),
      did: m.detail,
      why: remediation ? `${remediation} (${competencyTitle(m.competency)})` : competencyTitle(m.competency),
      tone: 'bad',
    });
  }

  cands.sort((a, b) => a.rank - b.rank);
  const chosen: Cand[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    if (chosen.length >= max) break;
    // One item per competency, so a missed item and its matching mistake do not both take a slot.
    const dedupe = c.comp && c.tone === 'bad' ? c.comp : undefined;
    if (dedupe && seen.has(dedupe)) continue;
    if (dedupe) seen.add(dedupe);
    chosen.push(c);
  }
  return chosen.map(({ rank: _r, comp: _c, ...item }) => item);
}
