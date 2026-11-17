// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { VentControls } from './VentControls';
import { holdIntervalMs, HOLD_START_MS } from './useHoldRepeat';
import type { DeviceSettings } from '../../shared/engineTypes';

if (typeof window !== 'undefined' && !window.PointerEvent) {
  class MockPointerEvent extends window.MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType || '';
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof window.PointerEvent;
  global.PointerEvent = MockPointerEvent as unknown as typeof global.PointerEvent;
}

const vc = (): DeviceSettings => ({ device: 'invasive', mode: 'VC-AC', fio2: 1, peep: 5, rrSetBpm: 16, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square' });
const base = { canChangeDevice: true, canChangeSettings: true, allowInvasiveSwitch: false };
const open = (re: RegExp) => fireEvent.click(screen.getByRole('button', { name: re }));
const stepBtn = (name: string) => screen.getByRole('button', { name });

describe('step buttons', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('repeat gap shortens the longer the button is held', () => {
    expect(holdIntervalMs(0)).toBeGreaterThan(holdIntervalMs(10));
    expect(holdIntervalMs(10)).toBeGreaterThan(holdIntervalMs(25));
  });

  it('a single press steps once, a keyboard click steps once', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^PEEP: 5/);
    fireEvent.pointerDown(stepBtn('Increase PEEP'), { button: 0 });
    fireEvent.pointerUp(stepBtn('Increase PEEP'));
    fireEvent.click(stepBtn('Increase PEEP')); // the click that follows the press must not step again
    expect(screen.getByRole('button', { name: /^PEEP: 6/ })).toBeTruthy();
    fireEvent.click(stepBtn('Increase PEEP')); // keyboard activation
    expect(screen.getByRole('button', { name: /^PEEP: 7/ })).toBeTruthy();
  });

  it('holding Decrease on O2 repeats after a delay and stops on release', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^Oxygen concentration: 100/);
    const dec = stepBtn('Decrease Oxygen concentration');
    fireEvent.pointerDown(dec, { button: 0 });
    act(() => { vi.advanceTimersByTime(HOLD_START_MS - 10); });
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 99/ })).toBeTruthy(); // not repeating yet
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerUp(dec);
    const at = /Oxygen concentration: (\d+)/.exec(screen.getByRole('button', { name: /^Oxygen concentration:/ }).getAttribute('aria-label') ?? '')![1]!;
    expect(Number(at)).toBeLessThan(80); // 60 clicks become a hold of a few seconds
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: new RegExp(`^Oxygen concentration: ${at}`) })).toBeTruthy();
  });

  it('Shift-click steps O2 by 5 and VT by 50, and a plain click still steps by 1 and 10', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^Oxygen concentration: 100/);
    fireEvent.click(stepBtn('Decrease Oxygen concentration'), { shiftKey: true });
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 95/ })).toBeTruthy();
    fireEvent.click(stepBtn('Decrease Oxygen concentration'));
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 94/ })).toBeTruthy();
    open(/^Tidal volume: 450/);
    fireEvent.click(stepBtn('Increase Tidal volume'), { shiftKey: true });
    expect(screen.getByRole('button', { name: /^Tidal volume: 500/ })).toBeTruthy();
    fireEvent.click(stepBtn('Increase Tidal volume'));
    expect(screen.getByRole('button', { name: /^Tidal volume: 510/ })).toBeTruthy();
  });

  it('for touch pointerType, does not step on pointer-down, steps once on click', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^PEEP: 5/);
    const inc = stepBtn('Increase PEEP');
    fireEvent.pointerDown(inc, { button: 0, pointerType: 'touch' });
    expect(screen.getByRole('button', { name: /^PEEP: 5/ })).toBeTruthy(); // no step on pointer-down
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerUp(inc, { pointerType: 'touch' });
    expect(screen.getByRole('button', { name: /^PEEP: 5/ })).toBeTruthy(); // still no step
    fireEvent.click(inc);
    expect(screen.getByRole('button', { name: /^PEEP: 6/ })).toBeTruthy(); // steps once on click
  });

  it('for touch pointerType, repeats only after the 350 ms hold', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^Oxygen concentration: 100/);
    const dec = stepBtn('Decrease Oxygen concentration');
    fireEvent.pointerDown(dec, { button: 0, pointerType: 'touch' });
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 100/ })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(HOLD_START_MS - 10); });
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 100/ })).toBeTruthy(); // does not repeat before 350 ms
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getByRole('button', { name: /^Oxygen concentration: 99/ })).toBeTruthy(); // first repeat after 350 ms
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerUp(dec, { pointerType: 'touch' });
    const at = /Oxygen concentration: (\d+)/.exec(screen.getByRole('button', { name: /^Oxygen concentration:/ }).getAttribute('aria-label') ?? '')![1]!;
    expect(Number(at)).toBeLessThan(80);
    fireEvent.click(dec); // trailing click does not step again after repeat
    expect(screen.getByRole('button', { name: new RegExp(`^Oxygen concentration: ${at}`) })).toBeTruthy();
  });

  it('releasing the pointer outside the button must not swallow the next keyboard click', () => {
    render(<VentControls active={vc()} {...base} onApply={vi.fn()} />);
    open(/^PEEP: 5/);
    const inc = stepBtn('Increase PEEP');
    fireEvent.pointerDown(inc, { button: 0 });
    expect(screen.getByRole('button', { name: /^PEEP: 6/ })).toBeTruthy(); // mouse steps on down
    fireEvent.pointerLeave(inc);
    fireEvent.pointerUp(document.body);
    // Next activation via keyboard click should step to 7, not be swallowed
    fireEvent.click(inc);
    expect(screen.getByRole('button', { name: /^PEEP: 7/ })).toBeTruthy();
  });
});
