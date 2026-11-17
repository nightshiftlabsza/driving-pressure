// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { VentControls } from './VentControls';
import type { DeviceSettings } from '../../shared/engineTypes';
import { venturiFio2 } from '../../engine/devices';
import { evaluateAlarms, defaultLimits } from '../../alarms';

const mask = (): DeviceSettings => ({ device: 'none', o2: 'simple-mask', o2FlowLpm: 10 });
const vc = (): DeviceSettings => ({ device: 'invasive', mode: 'VC-AC', fio2: 0.5, peep: 5, rrSetBpm: 16, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square' });
const base = { canChangeDevice: true, canChangeSettings: true, allowInvasiveSwitch: false };
const key = (name: RegExp) => screen.getByRole('button', { name });

describe('VentControls', () => {
  afterEach(cleanup);

  it('activates a key, adjusts it, and applies only on Confirm', () => {
    const onApply = vi.fn();
    const { rerender } = render(<VentControls active={vc()} {...base} onApply={onApply} pbwKg={70} />);
    fireEvent.click(key(/^PEEP: 5/));
    expect(key(/^PEEP: 5/).getAttribute('data-state')).toBe('active');
    fireEvent.click(screen.getByRole('button', { name: 'Increase PEEP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase PEEP' }));
    rerender(<VentControls active={vc()} {...base} onApply={onApply} pbwKg={70} />); // simulation tick with an equal device
    expect(onApply).not.toHaveBeenCalled();
    expect(key(/^PEEP: 7 cmH2O, active 5/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0].peep).toBe(7);
    expect(onApply.mock.calls[0]![1]).toBe(false);
  });

  it('Cancel discards the unconfirmed value', () => {
    const onApply = vi.fn();
    render(<VentControls active={vc()} {...base} onApply={onApply} />);
    fireEvent.click(key(/^Tidal volume: 450/));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Tidal volume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(key(/^Tidal volume: 450 mL$/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('stages a mode change and applies it with Confirm mode', () => {
    const onApply = vi.fn();
    render(<VentControls active={vc()} {...base} onApply={onApply} />);
    fireEvent.click(screen.getByRole('tab', { name: 'PC-AC' }));
    expect(screen.getByText(/New mode: PC-AC/)).toBeTruthy();
    expect(key(/^Inspiratory pressure above PEEP/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm mode' }));
    expect(onApply.mock.calls[0]![0]).toMatchObject({ mode: 'PC-AC', pinspAbovePeep: 15, tiSec: 1 });
  });

  it('switches device to NIV without stepping oxygen down', () => {
    const onApply = vi.fn();
    render(<VentControls active={mask()} {...base} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /^Device:/ }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Choose device' })).getByRole('button', { name: 'NIV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm device' }));
    const [next, typeChanged] = onApply.mock.calls[0]!;
    expect(typeChanged).toBe(true);
    expect(next.device).toBe('niv');
    expect(next.fio2).toBeGreaterThanOrEqual(0.55);
  });

  it('blocks IPAP at or below EPAP', () => {
    const onApply = vi.fn();
    const niv: DeviceSettings = { device: 'niv', mode: 'ST', fio2: 0.5, epap: 8, ipap: 9, backupRrBpm: 12, tiSec: 1, interface: 'oronasal', maskFit: 'good' };
    render(<VentControls active={niv} {...base} onApply={onApply} />);
    fireEvent.click(key(/^Inspiratory positive airway pressure: 9/));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Inspiratory positive airway pressure' }));
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers only realistic flows per oxygen interface', () => {
    render(<VentControls active={{ device: 'none', o2: 'nasal-cannula', o2FlowLpm: 2 }} {...base} onApply={() => {}} />);
    fireEvent.click(key(/^Oxygen flow/));
    const flows = within(screen.getByRole('radiogroup', { name: 'Oxygen flow' })).getAllByRole('radio').map(r => r.textContent);
    expect(flows).toEqual(['1 L/min', '2 L/min', '3 L/min', '4 L/min', '5 L/min', '6 L/min']);
  });

  it('Venturi valves give fixed FiO2', () => {
    expect(venturiFio2(2)).toBe(0.24);
    expect(venturiFio2(4)).toBe(0.28);
    expect(venturiFio2(15)).toBe(0.6);
  });

  it('raises alarms from monitored values and limits', () => {
    const m = { simTimeSec: 0, ppeakCmH2O: 45, pmeanCmH2O: 15, peepSetCmH2O: 5, vteMl: 450, minuteVentLpm: 7, rrTotalBpm: 16, rrSpontBpm: 0, fio2: 0.5, leakLpm: null, hrBpm: 90, sbpMmHg: 120, dbpMmHg: 70, mapMmHg: 85, spo2Pct: 85, etco2MmHg: 40, temperatureC: 37 };
    const a = evaluateAlarms(m, vc(), defaultLimits());
    expect(a.map(x => x.id)).toEqual(['ppeak-high', 'spo2-low']);
    expect(evaluateAlarms(m, mask(), defaultLimits()).map(x => x.id)).toEqual(['spo2-low']); // no circuit alarms off the ventilator
  });

  it('renders Hamilton skin with device-specific mode names, labels, and disabled PRVC modes', () => {
    render(<VentControls active={vc()} {...base} onApply={() => {}} skin="hamilton" />);
    // Modes
    expect(screen.getByRole('tab', { name: '(S)CMV' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'PCV+' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'SIMV' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'SPONT' })).toBeTruthy();
    // PRVC family disabled with not simulated yet
    const apv = screen.getByRole('tab', { name: /APVcmv/i }) as HTMLButtonElement;
    expect(apv.disabled).toBe(true);
    expect(apv.textContent).toContain('not simulated yet');
    const asv = screen.getByRole('tab', { name: /ASV®/i }) as HTMLButtonElement;
    expect(asv.disabled).toBe(true);

    // Setting key labels: Hamilton uses Oxygen, Vt, Rate, PEEP/CPAP
    const keysContainer = screen.getByTestId('setting-keys');
    expect(within(keysContainer).getByText('Oxygen')).toBeTruthy();
    expect(within(keysContainer).getByText('Vt')).toBeTruthy();
    expect(within(keysContainer).getByText('Rate')).toBeTruthy();
    expect(within(keysContainer).getByText('PEEP/CPAP')).toBeTruthy();
  });

  it('renders Mindray skin with device-specific mode names, labels, and disabled PRVC modes', () => {
    render(<VentControls active={vc()} {...base} onApply={() => {}} skin="mindray" />);
    // Modes
    expect(screen.getByRole('tab', { name: 'V-A/C' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'P-A/C' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'V-SIMV' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'CPAP/PSV' })).toBeTruthy();
    // PRVC family disabled
    const prvc = screen.getByRole('tab', { name: /^PRVC\s/i }) as HTMLButtonElement;
    expect(prvc.disabled).toBe(true);
    expect(prvc.textContent).toContain('not simulated yet');

    // Setting key labels: Mindray uses O2%, TV, f, PEEP
    const keysContainer = screen.getByTestId('setting-keys');
    expect(within(keysContainer).getByText('O2%')).toBeTruthy();
    expect(within(keysContainer).getByText('TV')).toBeTruthy();
    expect(within(keysContainer).getByText('f')).toBeTruthy();
    expect(within(keysContainer).getByText('PEEP')).toBeTruthy();
  });

  it('selects spontaneous mode tab when active device is CPAP under Hamilton and Mindray skins', () => {
    const cpap: DeviceSettings = { device: 'invasive', mode: 'CPAP', fio2: 0.4, peep: 5, psAbovePeep: 5, rrSetBpm: 0 };
    const { rerender } = render(<VentControls active={cpap} {...base} onApply={() => {}} skin="hamilton" />);
    const spontTab = screen.getByRole('tab', { name: 'SPONT' });
    expect(spontTab.getAttribute('aria-selected')).toBe('true');

    rerender(<VentControls active={cpap} {...base} onApply={() => {}} skin="mindray" />);
    const mindrayTab = screen.getByRole('tab', { name: 'CPAP/PSV' });
    expect(mindrayTab.getAttribute('aria-selected')).toBe('true');
  });

  it('uses skin-appropriate oxygen label for HFNC', () => {
    const hfnc: DeviceSettings = { device: 'hfnc', flowLpm: 40, fio2: 0.6, temperatureC: 37 };
    const { rerender } = render(<VentControls active={hfnc} {...base} onApply={() => {}} skin="hamilton" />);
    const keysH = screen.getByTestId('setting-keys');
    expect(within(keysH).getByText('Oxygen')).toBeTruthy();

    rerender(<VentControls active={hfnc} {...base} onApply={() => {}} skin="mindray" />);
    const keysM = screen.getByTestId('setting-keys');
    expect(within(keysM).getByText('O2%')).toBeTruthy();
  });

  it('allows typing multi-digit value 480 into control-vt without mid-keystroke clamping and restores original active setting on Cancel', () => {
    const onApply = vi.fn();
    render(<VentControls active={vc()} {...base} onApply={onApply} />);
    const vtInput = screen.getByTestId('control-vt') as HTMLInputElement;
    fireEvent.change(vtInput, { target: { value: '4' } });
    expect(vtInput.value).toBe('4');
    fireEvent.change(vtInput, { target: { value: '48' } });
    expect(vtInput.value).toBe('48');
    fireEvent.change(vtInput, { target: { value: '480' } });
    expect(vtInput.value).toBe('480');
    fireEvent.blur(vtInput);
    expect(vtInput.value).toBe('480');

    // Cancel must restore original active setting (450 mL)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(vtInput.value).toBe('450');
  });
});
