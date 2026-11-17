import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSettings } from '../../shared/engineTypes';
import { useHoldRepeat } from './useHoldRepeat';
import {
  clampToSpec, defaultsFor, DEVICE_LABEL, DEVICE_LONG, formatValue, MODE_LABEL, MODE_LONG, modeKey, modesFor,
  modeLabel, modeLong, isSameSkinMode, unsupportedModesFor, O2_HINTS, sameSettings, settingProblems, settingsKey, specsFor,
  timingReadout, withMode, type DeviceKind, type SettingSpec, type VentSkin,
} from './settings';

export interface VentControlsProps {
  active: DeviceSettings;
  canChangeSettings: boolean;
  canChangeDevice: boolean;
  /** Invasive ventilation is reached by the Intubate order, not by switching device here. */
  allowInvasiveSwitch: boolean;
  /** PBW in kg, for the VT per kg readout. */
  pbwKg?: number;
  disabled?: boolean;
  skin?: VentSkin;
  onApply: (next: DeviceSettings, typeChanged: boolean) => void;
}

type Selection = { kind: 'setting'; id: string; before: DeviceSettings } | { kind: 'device' } | null;

function specTestId(id: string): string {
  switch (id) {
    case 'vtSetMl': return 'control-vt';
    case 'peep': return 'control-peep';
    case 'rrSetBpm': return 'control-rr';
    case 'fio2': return 'control-fio2';
    case 'pinspAbovePeep': return 'control-pinsp';
    case 'psAbovePeep': return 'control-ps';
    default: return `control-${id}`;
  }
}

export const VentControls: React.FC<VentControlsProps> = ({
  active,
  canChangeSettings,
  canChangeDevice,
  allowInvasiveSwitch,
  pbwKg,
  disabled,
  skin,
  onApply,
}) => {
  const [draft, setDraft] = useState<DeviceSettings>(active);
  const [sel, setSel] = useState<Selection>(null);

  // The engine hands back a fresh copy of the device every tick: reset only when the content changes.
  const activeKey = settingsKey(active);
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(active)) as DeviceSettings);
    setSel(null);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceChange = draft.device !== active.device;
  const modeChange = !deviceChange && !isSameSkinMode(modeKey(draft), modeKey(active), skin);
  const staged = deviceChange || modeChange;
  const specs = specsFor(draft, skin);
  const activeSpecs = new Set(specsFor(active, skin).map(s => s.id));
  const editable = !disabled && (deviceChange ? canChangeDevice : canChangeSettings);
  const problems = settingProblems(draft);

  const activeRef = useRef(active);
  activeRef.current = active;

  // Deliverable 4: Unconfirmed changes revert after 10 s
  const isDirty = Boolean(sel || staged || !sameSettings(draft, activeRef.current));
  const draftKey = settingsKey(draft);
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      setDraft(JSON.parse(JSON.stringify(activeRef.current)));
      setSel(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [sel, staged, draftKey, isDirty]);

  const selectedSpec = sel?.kind === 'setting' ? specs.find(s => s.id === sel.id) : undefined;

  const [draftInputs, setDraftInputs] = useState<Partial<Record<string, string>>>({});

  const confirmSetting = () => {
    let finalDraft = draft;
    if (sel?.kind === 'setting') {
      const raw = draftInputs[sel.id];
      if (raw !== undefined && raw.trim() !== '') {
        const spec = specs.find(s => s.id === sel.id);
        const num = Number(raw);
        if (spec && Number.isFinite(num)) {
          finalDraft = spec.write(draft, clampToSpec(spec, num));
          setDraft(finalDraft);
        }
      }
    }
    setDraftInputs({});
    setSel(null);
    if (problems.length) return;
    if (!sameSettings(finalDraft, active)) onApply(finalDraft, false);
  };
  const cancelSetting = () => {
    if (sel?.kind === 'setting') setDraft(sel.before);
    setDraftInputs({});
    setSel(null);
  };
  const cancelStaged = () => {
    setDraft(active);
    setDraftInputs({});
    setSel(null);
  };
  const confirmStaged = () => {
    if (problems.length) return;
    setDraftInputs({});
    setSel(null);
    onApply(draft, deviceChange);
  };

  const pickKey = (spec: SettingSpec) => {
    if (!editable) return;
    if (sel?.kind === 'setting' && sel.id === spec.id) {
      confirmSetting();
      return;
    }
    if (sel?.kind === 'setting' && !staged) {
      setDraft(sel.before);
      setSel({ kind: 'setting', id: spec.id, before: sel.before });
      return;
    }
    setSel({ kind: 'setting', id: spec.id, before: draft });
  };

  const pickMode = (m: string) => {
    if (!editable && !canChangeSettings) return;
    setSel(null);
    if (!deviceChange && isSameSkinMode(m, modeKey(active), skin)) {
      setDraft(active);
      return;
    }
    setDraft(d => withMode(d, m));
  };

  const pickDevice = (k: DeviceKind) => {
    setSel(null);
    setDraft(k === active.device ? active : defaultsFor(k, active));
  };

  const modes = modesFor(draft.device, skin);
  const unsupported = unsupportedModesFor(draft.device, skin);
  const kinds = (['none', 'hfnc', 'niv', 'invasive'] as const);

  return (
    <div className="flex flex-col gap-1.5" data-testid="vent-controls">
      {staged && (
        <div className="vt-adjust flex flex-wrap items-center gap-3 px-3 py-2" role="region" aria-label="Pending change">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold" style={{ color: 'var(--act)' }}>
              {deviceChange ? `Switch to ${DEVICE_LONG[draft.device]}` : `New mode: ${modeLabel(modeKey(draft), skin)}`}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-2)' }}>
              Not active yet. Review each setting, then confirm. The patient stays on {deviceChange ? DEVICE_LONG[active.device].toLowerCase() : modeLabel(modeKey(active), skin)} until you do.
            </div>
            {problems.map(p => <div key={p} className="text-xs font-semibold mt-0.5" style={{ color: 'var(--alarm-high)' }}>{p}</div>)}
          </div>
          <button type="button" className="vt-btn" onClick={cancelStaged}>Cancel</button>
          <button
            type="button"
            data-testid="control-apply"
            className="vt-btn vt-btn--confirm"
            disabled={!editable || problems.length > 0}
            onClick={confirmStaged}
          >
            {deviceChange ? 'Confirm device' : 'Confirm mode'}
          </button>
        </div>
      )}

      {sel?.kind === 'setting' && selectedSpec && (
        <AdjustBar
          spec={selectedSpec}
          draft={draft}
          active={active}
          activeHas={activeSpecs.has(selectedSpec.id)}
          pbwKg={pbwKg}
          staged={staged}
          problems={staged ? [] : problems}
          onChange={setDraft}
          onConfirm={confirmSetting}
          onCancel={cancelSetting}
        />
      )}

      {sel?.kind === 'device' && (
        <div className="vt-adjust flex flex-wrap items-center gap-2 px-3 py-2" role="region" aria-label="Choose device">
          <span className="vt-label mr-1">Device</span>
          {kinds.map(k => {
            const reachable = k === active.device || (canChangeDevice && (k !== 'invasive' || allowInvasiveSwitch));
            return (
              <button
                key={k}
                type="button"
                className="vt-btn"
                aria-pressed={draft.device === k}
                disabled={!reachable}
                onClick={() => pickDevice(k)}
                title={k === 'invasive' && !allowInvasiveSwitch ? 'Use the Intubate order' : undefined}
              >
                {DEVICE_LABEL[k]}
              </button>
            );
          })}
          {!allowInvasiveSwitch && <span className="text-xs" style={{ color: 'var(--text-3)' }}>Invasive ventilation starts with the Intubate order.</span>}
          <span className="flex-1" />
          <button type="button" className="vt-btn vt-btn--quiet" onClick={() => setSel(null)}>Close</button>
        </div>
      )}

      {/* Mode row */}
      <div className="flex flex-wrap items-end gap-1" role="tablist" aria-label="Ventilation mode">
        {/* Dropdown for automated tests (test-id: control-mode) and accessibility */}
        <select
          data-testid="control-mode"
          aria-label="Ventilation mode"
          value={modeKey(draft)}
          onChange={e => pickMode(e.target.value)}
          className="md:hidden min-w-0 flex-1 text-sm bg-[var(--surface-2)] text-[var(--warn-ink)] font-bold border border-[var(--warn-line)] rounded px-2 py-1.5"
        >
          {modes.map(m => (
            <option key={m} value={m}>{modeLabel(m, skin)}</option>
          ))}
        </select>

        <button
          type="button"
          className="vt-modetab"
          data-state={sel?.kind === 'device' || deviceChange ? 'pending' : undefined}
          aria-label={`Device: ${DEVICE_LONG[draft.device]}`}
          disabled={!canChangeDevice || disabled}
          onClick={() => setSel(s => (s?.kind === 'device' ? null : { kind: 'device' }))}
        >
          {DEVICE_LABEL[draft.device]}<Chevron />
        </button>
        {/* From 768 px the modes are tabs; below that the select above is the only mode control. */}
        <div className="hidden md:contents">
        <span className="w-px h-5 self-center mx-1" style={{ background: 'var(--line-strong)' }} />
        {modes.map(m => {
          const isCur = isSameSkinMode(modeKey(draft), m, skin);
          const state = isCur ? (staged && (deviceChange || !isSameSkinMode(m, modeKey(active), skin)) ? 'pending' : 'current') : undefined;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={isCur}
              className="vt-modetab"
              data-state={state}
              title={modeLong(m, skin)}
              disabled={!canChangeSettings || disabled}
              onClick={() => pickMode(m)}
            >
              {modeLabel(m, skin)}
            </button>
          );
        })}
        {unsupported.length > 0 && (
          <details className="relative self-center">
            <summary className="vt-modetab list-none cursor-pointer inline-flex items-center" title="Modes this simulator does not model yet">More modes</summary>
            <div className="absolute left-0 top-full z-30 mt-1 flex flex-col gap-1 p-2 rounded border shadow-lg w-max" style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)' }}>
            {unsupported.map(u => (
              <button
                key={u.id}
                type="button"
                role="tab"
                aria-selected={false}
                className="vt-modetab opacity-40 cursor-not-allowed"
                disabled
                title={u.title}
              >
                {u.label} <span className="text-[10px] opacity-75 font-normal">(not simulated yet)</span>
              </button>
            ))}
            </div>
          </details>
        )}
        </div>
        {modes.length === 0 && (
          <span className="text-xs pb-1.5" style={{ color: 'var(--text-3)' }}>
            {draft.device === 'none' ? O2_HINTS[draft.o2].replace('0.6 to 0.85', '60% to 85%') : 'Set flow, oxygen and temperature.'}
          </span>
        )}
      </div>

      {/* Setting keys */}
      <div className="flex flex-wrap gap-1.5 pb-0.5" data-testid="setting-keys">
        {specs.map(spec => {
          const value = formatValue(spec, draft);
          const activeVal = activeSpecs.has(spec.id) && !deviceChange ? formatValue(spec, active) : null;
          const differs = activeVal === null ? staged : activeVal !== value;
          const isSel = sel?.kind === 'setting' && sel.id === spec.id;
          const state = isSel ? 'active' : differs ? 'pending' : undefined;
          const testId = specTestId(spec.id);

          return (
            <button
              key={spec.id}
              type="button"
              className="vt-key"
              data-state={state}
              disabled={!editable}
              aria-label={`${spec.name}: ${value}${spec.unit ? ` ${spec.unit}` : ''}${differs && activeVal !== null ? `, active ${activeVal}` : ''}`}
              aria-pressed={isSel}
              onClick={() => pickKey(spec)}
              onWheel={e => {
                if (isSel && spec.kind === 'number') {
                  e.preventDefault();
                  nudge(spec, draft, e.deltaY < 0 ? 1 : -1, setDraft);
                }
              }}
            >
              <span className="vt-key__label">{spec.label}</span>
              <input
                data-testid={testId}
                aria-label={spec.name}
                type="text"
                value={draftInputs[spec.id] ?? value}
                onClick={e => {
                  e.stopPropagation();
                  pickKey(spec);
                }}
                onChange={e => {
                  const raw = e.target.value;
                  setDraftInputs(prev => ({ ...prev, [spec.id]: raw }));
                  if (!sel || sel.kind !== 'setting' || sel.id !== spec.id) {
                    setSel({ kind: 'setting', id: spec.id, before: draft });
                  }
                  const num = Number(raw);
                  if (Number.isFinite(num) && raw.trim() !== '') {
                    setDraft(spec.write(draft, clampToSpec(spec, num)));
                  }
                }}
                onBlur={() => {
                  const raw = draftInputs[spec.id];
                  if (raw !== undefined) {
                    const num = Number(raw);
                    if (Number.isFinite(num) && raw.trim() !== '') {
                      setDraft(spec.write(draft, clampToSpec(spec, num)));
                    }
                    setDraftInputs(prev => {
                      const copy = { ...prev };
                      delete copy[spec.id];
                      return copy;
                    });
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmSetting();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelSetting();
                  }
                }}
                style={spec.kind === 'list' ? { width: `${Math.max(4, value.length + 1)}ch` } : undefined}
                className={`vt-key__value num cursor-pointer bg-transparent border-0 text-center p-0 outline-none ${spec.kind === 'list' ? '' : 'w-16'} ${
                  spec.kind === 'list' && value.length > 5 ? '!text-base font-semibold' : ''
                }`}
              />
              <span className="vt-key__unit">{spec.unit ?? ''}</span>
              {differs && activeVal !== null && <span className="vt-key__was num">{activeVal}</span>}
            </button>
          );
        })}
      </div>
      {!editable && !disabled && <div className="text-xs" style={{ color: 'var(--text-3)' }}>This case does not let you change these settings.</div>}
    </div>
  );
};

export function nudge(spec: SettingSpec, d: DeviceSettings, dir: 1 | -1, set: (d: DeviceSettings) => void, coarse = false): DeviceSettings {
  const cur = Number(spec.read(d) ?? spec.min ?? 0);
  const size = coarse && spec.coarseStep ? spec.coarseStep : (spec.step ?? 1);
  const next = spec.write(d, clampToSpec(spec, cur + dir * size));
  set(next);
  return next;
}

/** A - or + button: press once to step, hold to repeat (and speed up), Shift for the coarse step where there is one. */
const StepButton: React.FC<{ spec: SettingSpec; dir: 1 | -1; latest: React.MutableRefObject<DeviceSettings>; onChange: (d: DeviceSettings) => void }> = ({ spec, dir, latest, onChange }) => {
  const handlers = useHoldRepeat(coarse => { latest.current = nudge(spec, latest.current, dir, onChange, coarse); });
  const name = dir === 1 ? 'Increase' : 'Decrease';
  return (
    <button
      type="button"
      className="vt-btn w-10 !text-lg touch-manipulation select-none"
      aria-label={`${name} ${spec.name}`}
      title={spec.coarseStep ? `Hold to repeat. Shift-click steps by ${spec.coarseStep}.` : 'Hold to repeat.'}
      {...handlers}
    >
      {dir === 1 ? '+' : '−'}
    </button>
  );
};

interface AdjustBarProps {
  spec: SettingSpec;
  draft: DeviceSettings;
  active: DeviceSettings;
  activeHas: boolean;
  staged: boolean;
  problems: string[];
  pbwKg?: number;
  onChange: (d: DeviceSettings) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const AdjustBar: React.FC<AdjustBarProps> = ({
  spec,
  draft,
  active,
  activeHas,
  staged,
  problems,
  pbwKg,
  onChange,
  onConfirm,
  onCancel,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  useEffect(() => {
    ref.current?.focus();
  }, [spec.id]);

  const value = spec.read(draft);
  const activeText = activeHas && draft.device === active.device ? formatValue(spec, active) : '—';
  const timing = timingReadout(draft);

  // Deliverable 4 live derived calculations: VT/kg PBW, Ti, I:E, expected MV
  const curVt = draft.device === 'invasive' ? (draft.vtSetMl ?? (spec.id === 'vtSetMl' ? Number(value) : undefined)) : undefined;
  const vtPerKg = curVt && pbwKg ? curVt / pbwKg : null;

  const expectedMv = useMemo(() => {
    if (draft.device === 'invasive') {
      const vt = draft.vtSetMl ?? (spec.id === 'vtSetMl' ? Number(value) : undefined);
      const rr = draft.rrSetBpm ?? (spec.id === 'rrSetBpm' ? Number(value) : undefined);
      if (vt && rr) return (vt * rr) / 1000;
    }
    return null;
  }, [draft, spec.id, value]);

  const options = useMemo(() => spec.options?.(draft) ?? [], [spec, draft]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!problems.length) onConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (spec.kind === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nudge(spec, draft, 1, onChange, e.shiftKey);
    } else if (spec.kind === 'number' && (e.key === 'ArrowDown' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      nudge(spec, draft, -1, onChange, e.shiftKey);
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="vt-adjust px-3 py-2 outline-none"
      role="group"
      aria-label={`Adjust ${spec.name}`}
      onKeyDown={onKey}
      onWheel={e => {
        if (spec.kind === 'number') {
          e.preventDefault();
          nudge(spec, draft, e.deltaY < 0 ? 1 : -1, onChange);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[9rem]">
          <div className="text-sm font-bold">{spec.name}</div>
          <div className="text-xs num" style={{ color: 'var(--text-2)' }}>
            Active {activeText}{spec.unit && activeText !== '—' ? ` ${spec.unit}` : ''}
          </div>
        </div>

        {spec.kind === 'number' ? (
          <div className="flex items-center gap-2 flex-1 min-w-[16rem]">
            <span className="text-xs num w-10 text-right" style={{ color: 'var(--text-3)' }}>{fmt(spec, spec.min)}</span>
            <input
              type="range"
              className="vt-range flex-1"
              aria-label={`${spec.name} slider`}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={Number(value ?? spec.min)}
              onChange={e => onChange(spec.write(draft, clampToSpec(spec, Number(e.target.value))))}
            />
            <span className="text-xs num w-10" style={{ color: 'var(--text-3)' }}>{fmt(spec, spec.max)}</span>
            <StepButton spec={spec} dir={-1} latest={latestDraft} onChange={onChange} />
            <output className="num text-4xl leading-none min-w-[5.5rem] text-center" style={{ color: 'var(--act)' }} aria-live="polite">
              {fmt(spec, Number(value))}
            </output>
            <StepButton spec={spec} dir={1} latest={latestDraft} onChange={onChange} />
            <span className="text-xs w-12" style={{ color: 'var(--text-2)' }}>{spec.unit}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 flex-1" role="radiogroup" aria-label={spec.name}>
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={String(value) === o.value}
                className="vt-btn"
                aria-pressed={String(value) === o.value}
                onClick={() => onChange(spec.write(draft, o.value))}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button type="button" className="vt-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            data-testid="control-apply"
            className="vt-btn vt-btn--confirm"
            disabled={problems.length > 0}
            onClick={onConfirm}
          >
            {staged ? 'Accept' : 'Confirm'}
          </button>
        </div>
      </div>

      {/* Live Derived Values Readout Row */}
      <div className="flex flex-wrap gap-x-4 mt-1 text-xs num" style={{ color: 'var(--text-2)' }}>
        {vtPerKg !== null && (
          <span style={{ color: vtPerKg > 8 ? 'var(--alarm-med)' : undefined }}>
            {vtPerKg.toFixed(1)} mL/kg PBW ({pbwKg ? `${pbwKg.toFixed(0)} kg` : ''})
          </span>
        )}
        {timing && <span>{timing}</span>}
        {expectedMv !== null && <span>expected MV {expectedMv.toFixed(1)} L/min</span>}
        {problems.map(p => <span key={p} style={{ color: 'var(--alarm-high)' }}>{p}</span>)}
      </div>

      <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
        Wheel, slider or arrow keys adjust{spec.coarseStep ? ` (Shift for steps of ${spec.coarseStep})` : ''}. Enter confirms; Esc cancels. Changes revert if unconfirmed for 10 s.{staged ? ' The new mode applies when you confirm it above.' : ''}
      </div>
    </div>
  );
};

function fmt(spec: SettingSpec, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '--';
  return v.toFixed(spec.decimals ?? 0);
}

const Chevron: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="inline-block ml-1.5 -mt-0.5">
    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
