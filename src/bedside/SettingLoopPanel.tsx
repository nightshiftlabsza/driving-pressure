import React, { useState } from 'react';
import {
  NOT_SCORED_TEXT, READOUT_LABEL, REASSESS_LABEL, SETTING_LABEL, readoutsFor,
  type ComparisonRow, type LoopDirection, type ReadoutKey, type ReassessChoice, type SettingType,
} from './settingLoop';

const box: React.CSSProperties = { backgroundColor: 'var(--surface-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' };
const chip = (on: boolean): React.CSSProperties => ({
  backgroundColor: on ? 'var(--act)' : 'var(--surface)',
  borderColor: 'var(--line)',
  color: on ? 'var(--bg)' : 'var(--text)',
});
const DIRS: { id: LoopDirection; label: string }[] = [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }, { id: 'same', label: 'No change' }];
const REASSESS: ReassessChoice[] = ['1min', '5min', '15min', 'abg'];

export interface SettingLoopAnswer {
  why: string;
  expect: Partial<Record<ReadoutKey, LoopDirection>>;
  reassess: ReassessChoice;
}

/** Small, non-modal prompt shown after a setting change has already been applied. */
export const SettingLoopPanel: React.FC<{
  settingType: SettingType;
  onSubmit: (a: SettingLoopAnswer) => void;
  onDismiss: () => void;
}> = ({ settingType, onSubmit, onDismiss }) => {
  const [why, setWhy] = useState('');
  const [expect, setExpect] = useState<Partial<Record<ReadoutKey, LoopDirection>>>({});
  const [reassess, setReassess] = useState<ReassessChoice>('5min');
  const keys = readoutsFor(settingType);
  return (
    <div className="border rounded-lg p-2.5 text-xs shadow-md space-y-2" style={box} role="region"
      aria-label="Setting change prediction" data-testid="setting-loop-panel">
      <div className="flex items-center justify-between font-medium" style={{ color: 'var(--act)' }}>
        <span>{SETTING_LABEL[settingType]} changed. What do you expect?</span>
        <button type="button" onClick={onDismiss} aria-label="Skip prediction" data-testid="setting-loop-skip" style={{ color: 'var(--text-2)' }}>Skip</button>
      </div>
      <input className="vt-select w-full" aria-label="Why (optional)" placeholder="Why? (optional, one line)" maxLength={140}
        value={why} onChange={e => setWhy(e.target.value)} />
      <div className="space-y-1">
        {keys.map(k => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-24" style={{ color: 'var(--text-2)' }}>{READOUT_LABEL[k]}</span>
            {DIRS.map(d => (
              <button key={d.id} type="button" aria-pressed={expect[k] === d.id} data-testid={`expect-${k}-${d.id}`}
                className="border rounded px-2 py-0.5" style={chip(expect[k] === d.id)}
                onClick={() => setExpect(prev => ({ ...prev, [k]: d.id }))}>{d.label}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span style={{ color: 'var(--text-2)' }}>Look again:</span>
        {REASSESS.map(r => (
          <button key={r} type="button" aria-pressed={reassess === r} data-testid={`reassess-${r}`}
            className="border rounded px-2 py-0.5" style={chip(reassess === r)} onClick={() => setReassess(r)}>{REASSESS_LABEL[r]}</button>
        ))}
        <button type="button" className="vt-btn !min-h-[24px] !px-2.5 !py-0.5 ml-auto" data-testid="setting-loop-save"
          disabled={Object.keys(expect).length === 0} onClick={() => onSubmit({ why: why.trim(), expect, reassess })}>Save</button>
      </div>
    </div>
  );
};

const arrow: Record<LoopDirection, string> = { up: 'up', down: 'down', same: 'no change' };

/** Expected vs actual, one line per readout. */
export const SettingLoopResult: React.FC<{ settingType: SettingType; rows: ComparisonRow[]; notScored?: boolean; onClose: () => void }> = ({ settingType, rows, notScored, onClose }) => (
  <div className="border rounded-lg p-2.5 text-xs shadow-md space-y-1" style={box} role="region"
    aria-label="Prediction result" data-testid="setting-loop-result">
    <div className="flex items-center justify-between font-medium" style={{ color: 'var(--act)' }}>
      <span>{SETTING_LABEL[settingType]} change: expected vs actual</span>
      <button type="button" onClick={onClose} aria-label="Close result" style={{ color: 'var(--text-2)' }}>&times;</button>
    </div>
    {notScored && <div data-testid="result-not-scored">{NOT_SCORED_TEXT}</div>}
    {rows.map(r => (
      <div key={r.key} data-testid={`result-${r.key}`}>
        {READOUT_LABEL[r.key]}: expected {arrow[r.predicted]}, actual {r.actual ? arrow[r.actual] : 'not available'}
        {' '}<b>{r.matched === null ? '' : r.matched ? 'matched' : 'not matched'}</b>
      </div>
    ))}
  </div>
);
