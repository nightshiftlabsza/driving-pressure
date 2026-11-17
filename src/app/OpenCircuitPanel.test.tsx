// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OpenCircuitPanel, roxIndex, ROX_GUIDANCE, type VitalSample } from './OpenCircuitPanel';
import { withVitalsRecording } from './vitalsHistory';
import { engine } from '../engine/index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceSettings, MonitoredValues, PatientParams } from '../shared/engineTypes';

afterEach(cleanup);
const m = (over: Partial<MonitoredValues> = {}): MonitoredValues => ({
  simTimeSec: 600, ppeakCmH2O: null, pmeanCmH2O: null, peepSetCmH2O: null, vteMl: null, minuteVentLpm: null, rrTotalBpm: 25, rrSpontBpm: 25,
  fio2: 0.5, leakLpm: null, hrBpm: 100, sbpMmHg: 120, dbpMmHg: 70, mapMmHg: 87, spo2Pct: 90, etco2MmHg: null, temperatureC: 37, ...over,
});
const hist: VitalSample[] = [0, 60, 120, 180].map(t => ({ t: 600 - 180 + t, spo2: 92 - t / 60, rr: 22 + t / 60, hr: 98, sbp: 120, dbp: 70 }));
const hfnc: DeviceSettings = { device: 'hfnc', flowLpm: 40, fio2: 0.5, temperatureC: 37 };
const nrb: DeviceSettings = { device: 'none', o2: 'non-rebreather', o2FlowLpm: 15 };

describe('roxIndex', () => {
  it('is (SpO2 / FiO2) / RR', () => {
    expect(roxIndex(94, 0.5, 20)).toBeCloseTo(9.4, 5);
    expect(roxIndex(90, 0.5, 25)).toBeCloseTo(7.2, 5);
  });
  it('is null when it cannot be worked out', () => {
    expect(roxIndex(90, 0.5, 0)).toBeNull();
    expect(roxIndex(90, 0, 20)).toBeNull();
  });
});

describe('OpenCircuitPanel', () => {
  it('on HFNC shows flow, FiO2, big numbers, the ROX value and the Roca guidance verbatim', () => {
    render(<OpenCircuitPanel device={hfnc} m={m()} history={hist} />);
    expect(screen.getByTestId('open-circuit-device').textContent).toBe('40 L/min · FiO2 50%');
    expect(screen.getByTestId('oc-spo2').textContent).toContain('90');
    expect(screen.getByTestId('oc-bp').textContent).toContain('120/70');
    expect(screen.getByTestId('rox-value').textContent).toBe('7.20');
    expect(screen.getByTestId('rox-guidance').textContent).toBe('>= 4.88 at 2, 6 or 12 h: HFNC likely to succeed. Below 2.85 at 2 h, 3.47 at 6 h or 3.85 at 12 h: high risk of failure. In between: reassess.');
    expect(ROX_GUIDANCE).toBe(screen.getByTestId('rox-guidance').textContent);
    expect(screen.getByTestId('rox-panel').textContent).toMatch(/Validated in pneumonia on HFNC/);
  });
  it('on a non-rebreather there is no ROX', () => {
    render(<OpenCircuitPanel device={nrb} m={m({ fio2: 0.8 })} history={hist} />);
    expect(screen.queryByTestId('rox-panel')).toBeNull();
    expect(screen.getByTestId('open-circuit-device').textContent).toContain('15 L/min');
    expect(screen.getByLabelText('SpO2, last 30 minutes')).toBeTruthy();
  });
  it('renders a vertical scale with min and max values including units matching lo/hi/data range', () => {
    render(<OpenCircuitPanel device={hfnc} m={m()} history={hist} />);
    const scales = screen.getAllByTestId('trend-scale');
    expect(scales.length).toBe(4);
    // SpO2 tile: lo 88, hi 100, hist has 89..92, so min 88%, max 100%
    const spo2Tile = screen.getByTestId('oc-spo2');
    expect(spo2Tile.textContent).toContain('100%');
    expect(spo2Tile.textContent).toContain('88%');
    // RR tile: lo 10, hi 30, hist has 22..25, so min 10 /min, max 30 /min
    const rrTile = screen.getByTestId('oc-rr');
    expect(rrTile.textContent).toContain('30 /min');
    expect(rrTile.textContent).toContain('10 /min');
    // HR tile: lo 60, hi 120, hist has 98, so min 60 /min, max 120 /min
    const hrTile = screen.getByTestId('oc-hr');
    expect(hrTile.textContent).toContain('120 /min');
    expect(hrTile.textContent).toContain('60 /min');
    // BP tile: lo 60, hi 140, hist has sbp 120, dbp 70, so min 60 mmHg, max 140 mmHg
    const bpTile = screen.getByTestId('oc-bp');
    expect(bpTile.textContent).toContain('140 mmHg');
    expect(bpTile.textContent).toContain('60 mmHg');
  });
});

describe('withVitalsRecording', () => {
  it('records the engine monitored values as time passes and keeps 30 simulated minutes', () => {
    const history: VitalSample[] = [];
    const rec = withVitalsRecording(engine, history);
    const c = JSON.parse(readFileSync(join(__dirname, '../cases/library/pneumonia-hfnc-01.json'), 'utf8')) as { patient: { params: PatientParams }; initialDevice: DeviceSettings };
    const patient = c.patient.params;
    let st = rec.createState(patient, c.initialDevice);
    for (let i = 0; i < 3000; i++) st = rec.fastForward(st, 1);
    expect(history.length).toBeGreaterThan(100);
    expect(history[history.length - 1]!.t).toBeGreaterThan(2900);
    expect(history[0]!.t).toBeGreaterThanOrEqual(3000 - 1800 - 20);
    expect(history[history.length - 1]!.spo2).toBe(st.monitored.spo2Pct);
  });
});
