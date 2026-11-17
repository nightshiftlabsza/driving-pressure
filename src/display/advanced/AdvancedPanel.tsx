import React, { useState } from 'react';
import type { MonitoredValues, ManoeuvreResult } from '../../shared/engineTypes';

export interface AdvancedPanelProps {
  monitored: MonitoredValues;
  lastManoeuvre?: ManoeuvreResult | null;
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: (expanded: boolean) => void;
  className?: string;
}

function fmt(val: number | null | undefined, digits: number = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return '--';
  }
  return val.toFixed(digits);
}

interface MetricTileProps {
  testId: string;
  name: string;
  sublabel: string;
  value: string;
  unit: string;
  accentColor: string;
  hint?: string;
}

const MetricTile: React.FC<MetricTileProps> = ({
  testId,
  name,
  sublabel,
  value,
  unit,
  accentColor,
  hint,
}) => (
  <div
    data-testid={testId}
    className="flex flex-col p-2.5 rounded bg-[var(--surface-3)] border border-[var(--line)] hover:border-[var(--line)] transition-colors"
  >
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accentColor }}>
        {name}
      </span>
      <span className="text-[10px] text-[var(--text-2)] font-mono">{unit}</span>
    </div>
    <div className="flex items-baseline justify-between">
      <span className="text-xl font-mono font-bold text-[var(--text)]">{value}</span>
      {hint && <span className="text-[10px] text-[var(--text-2)]">{hint}</span>}
    </div>
    <span className="text-[10px] text-[var(--text-2)] mt-1 leading-tight">{sublabel}</span>
  </div>
);

/**
 * Bedside advanced mechanics and effort monitoring panel.
 * Displays:
 * - Esophageal pressure (Pes)
 * - Transpulmonary end-inspiratory pressure (PL,end-insp)
 * - Transpulmonary end-expiratory pressure (PL,end-exp)
 * - Airway occlusion pressure at 100 ms (P0.1)
 * - End-expiratory occlusion pressure deflection (ΔPocc)
 * - Occlusion manoeuvre results (estimated Pmus and dynamic PL driving pressure)
 */
export const AdvancedPanel: React.FC<AdvancedPanelProps> = ({
  monitored,
  lastManoeuvre,
  defaultExpanded = true,
  isExpanded: controlledExpanded,
  onToggleExpanded,
  className = '',
}) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const toggle = () => {
    const next = !isExpanded;
    if (onToggleExpanded) {
      onToggleExpanded(next);
    } else {
      setInternalExpanded(next);
    }
  };

  const isOcclusionResult = lastManoeuvre?.kind === 'occlusion';
  const p01Value = isOcclusionResult && lastManoeuvre.p01CmH2O !== undefined
    ? lastManoeuvre.p01CmH2O
    : monitored.p01CmH2O;
  const deltaPoccValue = isOcclusionResult && lastManoeuvre.deltaPoccCmH2O !== undefined
    ? lastManoeuvre.deltaPoccCmH2O
    : monitored.deltaPoccCmH2O;

  return (
    <div
      data-testid="advanced-panel"
      className={`rounded-lg bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] overflow-hidden ${className}`}
      role="region"
      aria-label="Advanced mechanics and effort monitoring"
    >
      {/* Header with toggle */}
      <button
        type="button"
        data-testid="btn-toggle-advanced"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between px-3 py-2 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors text-left border-b border-[var(--line)]"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--sel)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--sel)]">
            Advanced Mechanics & Effort
          </span>
          {monitored.p01CmH2O !== null && monitored.p01CmH2O !== undefined && monitored.p01CmH2O >= 3.5 && (
            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-[var(--warn-bg)] text-[var(--warn-ink)] border border-[var(--warn-line)]">
              HIGH DRIVE
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--text-2)] font-mono">
          {isExpanded ? '▲ Hide' : '▼ Show'}
        </span>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {/* 1. Esophageal Pressure (Pes) */}
            <MetricTile
              testId="tile-pes"
              name="Pes"
              sublabel="Pleural / Esophageal (V/Ccw - Pmus)"
              value={fmt(monitored.pesCmH2O)}
              unit="cmH2O"
              accentColor="#f59e0b"
            />

            {/* 2. End-Inspiratory Transpulmonary Pressure (PL,end-insp) */}
            <MetricTile
              testId="tile-pl-end-insp"
              name="PL,end-insp"
              sublabel="Paw - Pes (Inspiration)"
              value={fmt(monitored.plEndInspCmH2O)}
              unit="cmH2O"
              accentColor="#38bdf8"
              hint={monitored.plEndInspCmH2O !== null && monitored.plEndInspCmH2O !== undefined && monitored.plEndInspCmH2O > 20 ? 'High stress' : undefined}
            />

            {/* 3. End-Expiratory Transpulmonary Pressure (PL,end-exp) */}
            <MetricTile
              testId="tile-pl-end-exp"
              name="PL,end-exp"
              sublabel="Paw - Pes (Expiration)"
              value={fmt(monitored.plEndExpCmH2O)}
              unit="cmH2O"
              accentColor="#0ea5e9"
              hint={monitored.plEndExpCmH2O !== null && monitored.plEndExpCmH2O !== undefined && monitored.plEndExpCmH2O < 0 ? 'Cyclic collapse' : undefined}
            />

            {/* 4. Airway Occlusion Pressure at 100 ms (P0.1) */}
            <MetricTile
              testId="tile-p01"
              name="P0.1"
              sublabel="Drive marker (Telias 2018)"
              value={fmt(p01Value)}
              unit="cmH2O"
              accentColor="#ec4899"
              hint={p01Value !== null && p01Value !== undefined && p01Value >= 3.5 ? 'Drive >= 3.5' : 'Norm 1.0–2.0'}
            />

            {/* 5. Max Occlusion Deflection (ΔPocc) */}
            <MetricTile
              testId="tile-delta-pocc"
              name="ΔPocc"
              sublabel="Occlusion Deflection (Bertoni)"
              value={fmt(deltaPoccValue)}
              unit="cmH2O"
              accentColor="#a855f7"
            />
          </div>

          {/* Occlusion Manoeuvre Diagnostic Box */}
          {isOcclusionResult && lastManoeuvre && (
            <div
              data-testid="manoeuvre-occlusion-result"
              className="p-2.5 rounded bg-[var(--info-bg)] border border-[var(--info-line)] flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--sel)]">
                  Last Occlusion Manoeuvre
                </span>
                <span
                  data-testid="manoeuvre-validity"
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                    lastManoeuvre.valid
                      ? 'bg-[var(--ok-bg)] text-[var(--ok-ink)] border border-[var(--ok-line)]'
                      : 'bg-[var(--danger-bg)] text-[var(--danger-ink)] border border-[var(--danger-line)]'
                  }`}
                >
                  {lastManoeuvre.valid ? 'VALID EFFORT' : 'SUB-THRESHOLD EFFORT'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-[var(--info-line)]">
                <div data-testid="tile-pmus-est">
                  <span className="text-[10px] text-[var(--text-2)] block">Est. Pmus (0.75 × ΔPocc)</span>
                  <span className="font-mono font-bold text-[var(--text)] text-sm">
                    {fmt(lastManoeuvre.pmusEstimatedCmH2O)} <span className="text-[10px] text-[var(--text-2)]">cmH2O</span>
                  </span>
                </div>
                <div data-testid="tile-pl-dyn-est">
                  <span className="text-[10px] text-[var(--text-2)] block">Est. Dynamic ΔPL</span>
                  <span className="font-mono font-bold text-[var(--text)] text-sm">
                    {fmt(lastManoeuvre.deltaPlDynEstimatedCmH2O)} <span className="text-[10px] text-[var(--text-2)]">cmH2O</span>
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-2)] block">ΔPocc Airway Drop</span>
                  <span className="font-mono font-bold text-[var(--text)] text-sm">
                    {fmt(lastManoeuvre.deltaPoccCmH2O)} <span className="text-[10px] text-[var(--text-2)]">cmH2O</span>
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-2)] block">P0.1 100 ms</span>
                  <span className="font-mono font-bold text-[var(--text)] text-sm">
                    {fmt(lastManoeuvre.p01CmH2O)} <span className="text-[10px] text-[var(--text-2)]">cmH2O</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
