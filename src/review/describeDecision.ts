import type { DeviceSettings } from '../shared/engineTypes';
import type { DecisionInput } from './types';

type Fmt = (v: unknown) => string;
const plain: Fmt = v => String(v);
const pct: Fmt = v => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v));

/** Display metadata for every settings field, in the order changes are listed. */
const FIELDS: Array<{ key: string; label: string; unit?: string; fmt?: Fmt }> = [
  { key: 'device', label: 'Device' },
  { key: 'mode', label: 'Mode' },
  { key: 'interface', label: 'Interface' },
  { key: 'maskFit', label: 'Mask fit' },
  { key: 'o2', label: 'O2 device' },
  { key: 'o2FlowLpm', label: 'O2 flow', unit: 'L/min' },
  { key: 'fio2', label: 'FiO2', fmt: pct },
  { key: 'vtSetMl', label: 'Vt', unit: 'mL' },
  { key: 'rrSetBpm', label: 'Rate', unit: 'bpm' },
  { key: 'backupRrBpm', label: 'Backup rate', unit: 'bpm' },
  { key: 'peep', label: 'PEEP', unit: 'cmH2O' },
  { key: 'epap', label: 'EPAP', unit: 'cmH2O' },
  { key: 'ipap', label: 'IPAP', unit: 'cmH2O' },
  { key: 'pinspAbovePeep', label: 'Inspiratory pressure', unit: 'cmH2O' },
  { key: 'psAbovePeep', label: 'Pressure support', unit: 'cmH2O' },
  { key: 'tiSec', label: 'I-time', unit: 's' },
  { key: 'inspFlowLpm', label: 'Inspiratory flow', unit: 'L/min' },
  { key: 'flowLpm', label: 'Flow', unit: 'L/min' },
  { key: 'flowPattern', label: 'Flow pattern' },
  { key: 'triggerFlowLpm', label: 'Trigger', unit: 'L/min' },
  { key: 'cyclePctPeakFlow', label: 'Cycle-off', unit: '% peak flow' },
  { key: 'cycleOffPct', label: 'Cycle-off', unit: '% peak flow' },
  { key: 'riseTimeSec', label: 'Rise time', unit: 's' },
  { key: 'pmaxCmH2O', label: 'Pressure limit', unit: 'cmH2O' },
  { key: 'circuitLeakLpm', label: 'Circuit leak', unit: 'L/min' },
  { key: 'temperatureC', label: 'Temperature', unit: 'C' },
];

const SPONTANEOUS_MODES = ['PSV', 'CPAP'];

function show(f: (typeof FIELDS)[number], v: unknown): string {
  return `${(f.fmt ?? plain)(v)}${f.unit ? ` ${f.unit}` : ''}`;
}

function describeFull(s: Record<string, unknown>): string {
  const spontaneous = SPONTANEOUS_MODES.includes(String(s.mode));
  const parts: string[] = [];
  for (const f of FIELDS) {
    const v = s[f.key];
    if (v === undefined || v === null) continue;
    if (spontaneous && (f.key === 'rrSetBpm' || f.key === 'vtSetMl')) continue;
    parts.push(f.key === 'mode' || f.key === 'device' ? `${f.label} ${v}` : `${f.label} ${show(f, v)}`);
  }
  return parts.join(', ');
}

/** One-line description of a settings change; lists only what differs from `previous` when known. */
export function describeSettingsChange(
  raw: Partial<DeviceSettings> | undefined,
  previous?: DeviceSettings | null,
): string {
  if (!raw) return 'Ventilator settings adjustment';
  const next = raw as Record<string, unknown>;
  if (previous) {
    const prev = previous as unknown as Record<string, unknown>;
    const changes: string[] = [];
    const seen = new Set<string>();
    for (const f of FIELDS) {
      if (!(f.key in next) || next[f.key] === undefined) continue;
      // Skip the alias if its twin was already reported with the same label.
      const sig = `${f.label}|${String(next[f.key])}`;
      if (seen.has(sig)) continue;
      if (next[f.key] === prev[f.key]) continue;
      seen.add(sig);
      const before = prev[f.key] === undefined ? 'off' : show(f, prev[f.key]).replace(` ${f.unit ?? ''}`, '');
      changes.push(`${f.label} ${before} to ${show(f, next[f.key])}`);
    }
    if (changes.length) return `Changed: ${changes.join(', ')}`;
  }
  const full = describeFull(next);
  return full ? `Set: ${full}` : 'Ventilator settings adjusted';
}

export function describeDecision(dec: DecisionInput, previous?: DeviceSettings | null): string {
  if (dec.kind === 'settings_change') {
    const raw = dec.settings ?? (dec.detail?.settings as Partial<DeviceSettings> | undefined)
      ?? (dec.detail?.device && typeof dec.detail.device === 'object'
        ? (dec.detail.device as Partial<DeviceSettings>) : undefined);
    return describeSettingsChange(raw, previous);
  }
  if (dec.kind === 'observe') {
    const to = typeof dec.detail?.toSimSec === 'number' ? dec.detail.toSimSec : dec.simTimeSec;
    const min = Math.max(0, Math.round((to - dec.simTimeSec) / 60));
    return `Observed without changes (${min} min)`;
  }
  if (dec.kind === 'hold') {
    return dec.holdKind === 'exp-hold' ? 'Expiratory hold (auto-PEEP)' : 'Inspiratory hold (plateau pressure)';
  }
  const ord = dec.order ?? 'order';
  return ord.charAt(0).toUpperCase() + ord.slice(1).replace(/-/g, ' ');
}
