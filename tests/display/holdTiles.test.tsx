// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { VentNumerics } from '../../src/display/Numerics';
import type { DeviceSettings, ManoeuvreResult, MonitoredValues } from '../../src/shared/engineTypes';
import { defaultLimits } from '../../src/alarms';

const m: MonitoredValues = {
  simTimeSec: 60, ppeakCmH2O: 22, pmeanCmH2O: 9.5, peepSetCmH2O: 5, vteMl: 480,
  minuteVentLpm: 7.2, rrTotalBpm: 15, rrSpontBpm: 0, fio2: 0.4, leakLpm: null,
  hrBpm: 80, sbpMmHg: 120, dbpMmHg: 70, mapMmHg: 87, spo2Pct: 96, etco2MmHg: 35, temperatureC: 37,
};

const invasive: DeviceSettings = { device: 'invasive', mode: 'VC-AC', fio2: 0.4, peep: 5, rrSetBpm: 16, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square' };
const invasivePeep8: DeviceSettings = { ...invasive, peep: 8 };
const niv: DeviceSettings = { device: 'niv', mode: 'CPAP', fio2: 0.4, epap: 5, interface: 'oronasal', maskFit: 'good' };

function inspHold(pplat: number): ManoeuvreResult {
  return { kind: 'insp-hold', pplatCmH2O: pplat, valid: true };
}
function expHold(totalPeep: number, autoPeep: number): ManoeuvreResult {
  return { kind: 'exp-hold', totalPeepCmH2O: totalPeep, autoPeepCmH2O: autoPeep, valid: true };
}

describe('hold-gated numerics tiles', () => {
  afterEach(cleanup);

  it('shows "Hold" on Pplat, PEEPtot and Auto-PEEP until a hold is measured', () => {
    render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} />);
    expect(screen.getByTestId('vent-pplat').textContent).toContain('Hold');
    expect(screen.getByTestId('vent-peep-tot').textContent).toContain('Hold');
    expect(screen.getByTestId('vent-auto-peep').textContent).toContain('Hold');
  });

  it('shows the measured Pplat after a valid inspiratory hold, until the settings change', () => {
    const { rerender } = render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={null} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={inspHold(25.4)} />);
    expect(screen.getByTestId('vent-pplat').textContent).toContain('25.4');
    // Settings change sends the tile back to "Hold".
    rerender(<VentNumerics m={m} device={invasivePeep8} alarms={[]} limits={defaultLimits()} lastManoeuvre={inspHold(25.4)} />);
    expect(screen.getByTestId('vent-pplat').textContent).toContain('Hold');
  });

  it('shows total PEEP and auto-PEEP after a valid expiratory hold', () => {
    const { rerender } = render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={null} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={expHold(12.3, 7.3)} />);
    expect(screen.getByTestId('vent-peep-tot').textContent).toContain('12.3');
    expect(screen.getByTestId('vent-auto-peep').textContent).toContain('7.3');
  });

  it('keeps "Hold" when a hold was measured but the patient effort spoiled it', () => {
    const { rerender } = render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={null} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={{ kind: 'insp-hold', pplatCmH2O: 31, valid: false }} />);
    expect(screen.getByTestId('vent-pplat').textContent).toContain('Hold');
  });

  it('does not show the hold tiles on non-invasive ventilation', () => {
    render(<VentNumerics m={m} device={niv} alarms={[]} limits={defaultLimits()} />);
    expect(screen.queryByTestId('vent-pplat')).toBeNull();
    expect(screen.queryByTestId('vent-peep-tot')).toBeNull();
    expect(screen.queryByTestId('vent-auto-peep')).toBeNull();
  });

  it("keeps the other hold's tiles when a second kind of hold is done", () => {
    const { rerender } = render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={null} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={expHold(12.3, 7.3)} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={null} />);
    rerender(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} lastManoeuvre={inspHold(25.4)} />);
    expect(screen.getByTestId('vent-pplat').textContent).toContain('25.4');
    expect(screen.getByTestId('vent-peep-tot').textContent).toContain('12.3');
    expect(screen.getByTestId('vent-auto-peep').textContent).toContain('7.3');
  });

  it('can leave the hold tiles out where holds cannot be done (the Lab)', () => {
    render(<VentNumerics m={m} device={invasive} alarms={[]} limits={defaultLimits()} holdTiles={false} />);
    expect(screen.queryByTestId('vent-pplat')).toBeNull();
    expect(screen.queryByTestId('vent-peep-tot')).toBeNull();
    expect(screen.queryByTestId('vent-auto-peep')).toBeNull();
  });
});
