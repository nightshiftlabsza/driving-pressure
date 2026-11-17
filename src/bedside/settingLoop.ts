import type { DeviceSettings, MonitoredValues } from '../shared/engineTypes';

/** Same three-way direction the case predictions already use (runtime Direction). */
export type LoopDirection = 'up' | 'down' | 'same';

export type SettingType = 'peep' | 'fio2' | 'rate' | 'volume-pressure' | 'mode' | 'device' | 'other';
export type ReadoutKey = 'ppeak' | 'vte' | 'spo2' | 'etco2';
export type ReassessChoice = '1min' | '5min' | '15min' | 'abg';

export const READOUT_LABEL: Record<ReadoutKey, string> = {
  ppeak: 'Peak pressure',
  vte: 'Tidal volume',
  spo2: 'SpO2',
  etco2: 'EtCO2',
};

/** Changes smaller than this count as "no change" (units: cmH2O, mL, %, mmHg). */
export const DEAD_BAND: Record<ReadoutKey, number> = { ppeak: 1, vte: 20, spo2: 1, etco2: 2 };

export const REASSESS_SEC: Record<Exclude<ReassessChoice, 'abg'>, number> = { '1min': 60, '5min': 300, '15min': 900 };
export const REASSESS_LABEL: Record<ReassessChoice, string> = { '1min': '1 min', '5min': '5 min', '15min': '15 min', abg: 'After next blood gas' };

export const SETTING_LABEL: Record<SettingType, string> = {
  peep: 'PEEP', fio2: 'FiO2', rate: 'Rate', 'volume-pressure': 'Tidal volume / pressure', mode: 'Mode', device: 'Device', other: 'Settings',
};

const READOUTS_FOR: Record<SettingType, ReadoutKey[]> = {
  peep: ['ppeak', 'vte', 'spo2'],
  fio2: ['spo2', 'etco2', 'ppeak'],
  rate: ['etco2', 'vte', 'ppeak', 'spo2'],
  'volume-pressure': ['ppeak', 'vte', 'etco2', 'spo2'],
  mode: ['ppeak', 'vte', 'etco2', 'spo2'],
  device: ['ppeak', 'vte', 'etco2', 'spo2'],
  other: ['ppeak', 'vte', 'spo2'],
};
export function readoutsFor(t: SettingType): ReadoutKey[] { return READOUTS_FOR[t]; }

type Rec = Record<string, unknown>;
function differs(a: Rec, b: Rec, k: string): boolean { return a[k] !== b[k]; }

/** Which kind of change this was. When several change at once the first match in this order wins. */
export function classifySettingChange(before: DeviceSettings, after: DeviceSettings): SettingType {
  if (before.device !== after.device) return 'device';
  const a = before as unknown as Rec, b = after as unknown as Rec;
  if (differs(a, b, 'mode')) return 'mode';
  if (differs(a, b, 'peep') || differs(a, b, 'epap')) return 'peep';
  if (differs(a, b, 'fio2')) return 'fio2';
  if (['rrSetBpm', 'backupRrBpm'].some(k => differs(a, b, k))) return 'rate';
  if (['vtSetMl', 'pinspAbovePeep', 'psAbovePeep', 'ipap', 'flowLpm'].some(k => differs(a, b, k))) return 'volume-pressure';
  return 'other';
}

export type Readouts = Record<ReadoutKey, number | null>;
export function snapshotReadouts(m: MonitoredValues): Readouts {
  return { ppeak: m.ppeakCmH2O, vte: m.vteMl, spo2: m.spo2Pct, etco2: m.etco2MmHg };
}

/** Direction of a change, with a dead-band so tiny moves count as "same". */
export function directionOf(key: ReadoutKey, before: number, after: number): LoopDirection {
  const d = after - before;
  if (Math.abs(d) < DEAD_BAND[key]) return 'same';
  return d > 0 ? 'up' : 'down';
}

export interface ComparisonRow {
  key: ReadoutKey;
  predicted: LoopDirection;
  actual: LoopDirection | null; // null = readout not available
  matched: boolean | null;
}

export function compareExpectations(expect: Partial<Record<ReadoutKey, LoopDirection>>, before: Readouts, after: Readouts): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const key of Object.keys(expect) as ReadoutKey[]) {
    const predicted = expect[key];
    if (!predicted) continue;
    const b = before[key], a = after[key];
    const actual = b === null || a === null ? null : directionOf(key, b, a);
    rows.push({ key, predicted, actual, matched: actual === null ? null : actual === predicted });
  }
  return rows;
}

/** True only when at least one row could be judged and every judged row matched. */
export function fullyMatched(rows: ComparisonRow[]): boolean {
  const judged = rows.filter(r => r.matched !== null);
  return judged.length > 0 && judged.every(r => r.matched === true);
}

// ---- Fading --------------------------------------------------------------------------------------------
/**
 * Is a pending setting-change loop ready to compare? A timed reassessment is ready once its time arrives.
 * An 'after next blood gas' reassessment needs a gas whose sample was drawn after the change: a gas ordered
 * before the change can come back after it but describes blood from before the change.
 */
export function loopReassessReady(
  entry: { dueSimSec: number | null; changeSimSec: number },
  abgs: readonly { sampledAtSimSec: number }[],
  nowSimSec: number,
): boolean {
  if (entry.dueSimSec !== null) return nowSimSec >= entry.dueSimSec;
  return abgs.some(a => a.sampledAtSimSec > entry.changeSimSec);
}

/** A baseline taken less than this long after a previous change still shows the earlier change's breath. */
export const BASELINE_SETTLE_SEC = 60;
export const NOT_SCORED_TEXT = 'Not scored: you changed something else before this could be judged.';

/**
 * Can this loop entry be judged fairly? Not if a previous settings/device change landed within
 * BASELINE_SETTLE_SEC before it (unsettled baseline), or if another change landed after it and up to the
 * look-again time (the effect cannot be blamed on this change). `changeTimes` lists every settings/device
 * change in the run, including this one (entries at exactly `changeSimSec` are treated as this change).
 */
export function loopScoringDecision(
  entry: { changeSimSec: number },
  lookSimSec: number,
  changeTimes: readonly number[],
): 'scored' | 'not-scored' {
  for (const t of changeTimes) {
    if (t < entry.changeSimSec && entry.changeSimSec - t < BASELINE_SETTLE_SEC) return 'not-scored';
    if (t > entry.changeSimSec && t <= lookSimSec) return 'not-scored';
  }
  return 'scored';
}

export const FADE_AFTER_MATCHES = 3;
export interface FadeState { streak: number; unprompted: number }
export type FadeMap = Partial<Record<SettingType, FadeState>>;
const FRESH: FadeState = { streak: 0, unprompted: 0 };

/** Prompt on every change until 3 fully matched in a row; then on every 3rd change of that type. */
export function shouldPrompt(s: FadeState = FRESH): boolean {
  return s.streak < FADE_AFTER_MATCHES || s.unprompted >= FADE_AFTER_MATCHES - 1;
}
/** Call once per change of this type, after deciding whether to prompt. */
export function afterChange(s: FadeState = FRESH, prompted: boolean): FadeState {
  return { streak: s.streak, unprompted: prompted ? 0 : s.unprompted + 1 };
}
/** Call when a prediction has been compared. Any mismatch resets to prompting every change. */
export function afterOutcome(s: FadeState = FRESH, matched: boolean): FadeState {
  return matched ? { streak: s.streak + 1, unprompted: s.unprompted } : { streak: 0, unprompted: 0 };
}

// ---- Persistence (browser local storage, same place the learner keeps its small flags) -------------------
const KEY = 'ovs_setting_loop_v1';
export function loadFade(): FadeMap {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FadeMap) : {};
  } catch { return {}; }
}
export function saveFade(m: FadeMap): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}
