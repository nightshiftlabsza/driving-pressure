import React from 'react';
import type { DeviceSettings, MonitoredValues } from '../shared/engineTypes';
import { DEVICE_LONG, O2_LABELS } from './vent/settings';

/** One recorded set of vital signs, taken from the engine's own monitored values. */
export interface VitalSample { t: number; spo2: number; rr: number; hr: number; sbp: number; dbp: number }

export const TREND_WINDOW_SEC = 30 * 60;

/** ROX index = (SpO2 / FiO2) / respiratory rate. FiO2 is a fraction (0.21 to 1). Null if it cannot be worked out. */
export function roxIndex(spo2Pct: number, fio2: number, rrBpm: number): number | null {
  if (!(spo2Pct > 0) || !(fio2 > 0) || !(rrBpm > 0)) return null;
  return spo2Pct / fio2 / rrBpm;
}

/** Wording for HFNC only. Thresholds: Roca et al., Am J Respir Crit Care Med 2019. */
export const ROX_GUIDANCE = '>= 4.88 at 2, 6 or 12 h: HFNC likely to succeed. Below 2.85 at 2 h, 3.47 at 6 h or 3.85 at 12 h: high risk of failure. In between: reassess.';
export const ROX_SOURCE = 'Roca et al., AJRCCM 2019. Validated in pneumonia on HFNC.';

function deviceLine(device: DeviceSettings, m: MonitoredValues): { name: string; detail: string; fio2: number } {
  if (device.device === 'hfnc') return { name: DEVICE_LONG.hfnc, detail: `${device.flowLpm} L/min`, fio2: device.fio2 };
  if (device.device === 'none') {
    return device.o2 === 'room-air'
      ? { name: 'Room air', detail: '', fio2: m.fio2 }
      : { name: O2_LABELS[device.o2], detail: `${device.o2FlowLpm} L/min`, fio2: m.fio2 };
  }
  return { name: DEVICE_LONG[device.device], detail: '', fio2: m.fio2 };
}

/** A small line chart of real recorded values over the last 30 simulated minutes. Gaps are not filled in. */
const Trend: React.FC<{ label: string; points: { t: number; v: number }[][]; now: number; lo: number; hi: number; unit?: string }> = ({ label, points, now, lo, hi, unit }) => {
  const W = 200, H = 90;
  // Fixed 30-minute axis ending now. Early in a case the lines are short, which is the truth.
  const span = TREND_WINDOW_SEC;
  const t0 = now - span;
  const vals = points.flat().map(p => p.v);
  const mn = Math.min(lo, ...vals), mx = Math.max(hi, ...vals);
  const x = (t: number) => ((t - t0) / span) * W;
  const y = (v: number) => H - 2 - ((v - mn) / (mx - mn || 1)) * (H - 4);
  const fmtUnit = (val: number) => (unit ? (unit === '%' ? `${Math.round(val)}%` : `${Math.round(val)} ${unit}`) : `${Math.round(val)}`);
  return (
    <div className="oc-trend flex flex-1 items-stretch gap-1">
      <div className="flex flex-col justify-between text-[10px] num select-none shrink-0" style={{ color: 'var(--text-3)' }} data-testid="trend-scale">
        <span data-testid="trend-scale-max">{fmtUnit(mx)}</span>
        <span data-testid="trend-scale-min">{fmtUnit(mn)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 block" preserveAspectRatio="none" role="img" aria-label={`${label}, last 30 minutes`}>
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {points.map((series, i) => series.length > 1 && (
          <polyline key={i} fill="none" stroke="var(--sel)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            points={series.filter(p => p.t >= t0).map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
        ))}
      </svg>
    </div>
  );
};

const AxisLabels: React.FC = () => (
  <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}><span>30 min ago</span><span>now</span></div>
);

const Tile: React.FC<{ label: string; value: string; unit?: string; children: React.ReactNode; testId: string }> = ({ label, value, unit, children, testId }) => (
  <div className="oc-tile flex flex-col gap-1 min-w-0 min-h-0 p-3 border rounded" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }} data-testid={testId}>
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="oc-num num text-4xl sm:text-6xl leading-none font-bold">{value}</span>
      {unit && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{unit}</span>}
    </div>
    {children}
    <AxisLabels />
  </div>
);

export const OpenCircuitPanel: React.FC<{
  device: DeviceSettings;
  m: MonitoredValues;
  history: readonly VitalSample[];
  children?: React.ReactNode;
}> = ({ device, m, history, children }) => {
  const now = m.simTimeSec;
  const recent = history.filter(s => s.t >= now - TREND_WINDOW_SEC);
  const series = (pick: (s: VitalSample) => number) => recent.map(s => ({ t: s.t, v: pick(s) }));
  const dl = deviceLine(device, m);
  const rox = device.device === 'hfnc' ? roxIndex(m.spo2Pct, dl.fio2, m.rrTotalBpm) : null;
  return (
    <div className="oc-panel p-3 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--surface-2)' }} data-testid="open-circuit-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-lg font-bold">{dl.name}</span>
        <span className="num text-lg" data-testid="open-circuit-device">
          {[dl.detail, `FiO2 ${device.device === 'none' && device.o2 !== 'room-air' ? '~' : ''}${Math.round(dl.fio2 * 100)}%`].filter(Boolean).join(' · ')}
        </span>
        {device.device === 'hfnc' && <span className="num text-sm" style={{ color: 'var(--text-3)' }}>{device.temperatureC} °C</span>}
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 flex-1 oc-grid">
        <Tile testId="oc-spo2" label="SpO2" value={String(Math.round(m.spo2Pct))} unit="%">
          <Trend label="SpO2" now={now} lo={88} hi={100} points={[series(s => s.spo2)]} unit="%" />
        </Tile>
        <Tile testId="oc-rr" label="RR" value={String(Math.round(m.rrTotalBpm))} unit="/min">
          <Trend label="Respiratory rate" now={now} lo={10} hi={30} points={[series(s => s.rr)]} unit="/min" />
        </Tile>
        <Tile testId="oc-hr" label="HR" value={String(Math.round(m.hrBpm))} unit="/min">
          <Trend label="Heart rate" now={now} lo={60} hi={120} points={[series(s => s.hr)]} unit="/min" />
        </Tile>
        <Tile testId="oc-bp" label="BP" value={`${Math.round(m.sbpMmHg)}/${Math.round(m.dbpMmHg)}`} unit="mmHg">
          <Trend label="Blood pressure" now={now} lo={60} hi={140} points={[series(s => s.sbp), series(s => s.dbp)]} unit="mmHg" />
        </Tile>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>Trends show patient time so far, up to the last 30 minutes. No airway waveforms on an open circuit; examine the patient and check a blood gas.</div>
      {device.device === 'hfnc' && (
        <div className="border-t pt-2" style={{ borderColor: 'var(--line)' }} data-testid="rox-panel">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>ROX index</span>
            <span className="num text-2xl font-bold" data-testid="rox-value">{rox === null ? '--' : rox.toFixed(2)}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>(SpO2 / FiO2) / RR</span>
          </div>
          <p className="text-sm mt-1 max-w-prose" data-testid="rox-guidance">{ROX_GUIDANCE}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{ROX_SOURCE}</p>
        </div>
      )}
      {children}
    </div>
  );
};
