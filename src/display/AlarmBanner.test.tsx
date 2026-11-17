// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AlarmBanner } from './AlarmBanner';
import type { ActiveAlarm, AlarmState } from '../alarms';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}
vi.stubGlobal('localStorage', memoryStorage());

const alarm = (id: string, priority: ActiveAlarm['priority'], o: Partial<ActiveAlarm> = {}): ActiveAlarm => ({
  id, priority, message: `msg-${id}`, raisedAtSimSec: 0, conditionActive: true, ...o,
});

function setup(state: AlarmState, extra: Partial<React.ComponentProps<typeof AlarmBanner>> = {}) {
  const onSilence = vi.fn();
  const onAcknowledge = vi.fn();
  const utils = render(
    <AlarmBanner alarmState={state} simTimeSec={100} onSilence={onSilence} onAcknowledge={onAcknowledge} {...extra} />,
  );
  const bar = utils.container.firstElementChild as HTMLElement;
  return { ...utils, bar, onSilence, onAcknowledge };
}

describe('AlarmBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('shows no alarms with only the sound button', () => {
    const { bar } = setup({ alarms: [] });
    expect(screen.getByText('No active alarms')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Sound on')).toBeTruthy();
    expect(bar.getAttribute('data-sounding')).toBe('off');
  });

  it('shows an active high alarm and sounds', () => {
    const { bar } = setup({ alarms: [alarm('a', 'high')] });
    expect(screen.getByText('msg-a')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Silence 2 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    expect(bar.getAttribute('data-sounding')).toBe('high');
    expect(bar.textContent).not.toContain('Silence 2m ');
    expect(screen.queryByRole('button', { name: 'Ack' })).toBeNull();
  });

  it('does not sound when audible is false', () => {
    const { bar } = setup({ alarms: [alarm('a', 'high')] }, { audible: false });
    expect(bar.getAttribute('data-sounding')).toBe('off');
  });

  it('shows the silenced countdown', () => {
    const { bar } = setup({ alarms: [alarm('a', 'high')], silencedUntilSimSec: 190 });
    expect(screen.getByRole('button', { name: 'Silenced 1:30' })).toBeTruthy();
    expect(bar.getAttribute('data-sounding')).toBe('off');
  });

  it('shows an acknowledged alarm without an Acknowledge button', () => {
    const { bar } = setup({ alarms: [alarm('a', 'high', { acknowledgedAtSimSec: 50 })] });
    expect(screen.getByText('Acknowledged')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(bar.getAttribute('data-sounding')).toBe('off');
  });

  it('shows a resolved alarm with Clear alarm', () => {
    setup({ alarms: [alarm('a', 'high', { conditionActive: false, isLatched: true })] });
    expect(screen.getByText('Resolved, not yet cleared')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear alarm' })).toBeTruthy();
  });

  it('displays an active medium alarm ahead of a resolved high one', () => {
    setup({
      alarms: [alarm('r', 'high', { conditionActive: false, isLatched: true }), alarm('m', 'med')],
    });
    expect(screen.getByText('msg-m')).toBeTruthy();
    expect(screen.queryByText('msg-r')).toBeNull();
  });

  it('acknowledges once per alarm needing action', () => {
    const { onAcknowledge } = setup({ alarms: [alarm('a', 'high'), alarm('b', 'low')] });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onAcknowledge).toHaveBeenCalledTimes(2);
    expect(onAcknowledge).toHaveBeenCalledWith('a');
    expect(onAcknowledge).toHaveBeenCalledWith('b');
  });

  it('toggles sound on and off', () => {
    setup({ alarms: [] });
    fireEvent.click(screen.getByTestId('alarm-sound-toggle'));
    expect(screen.getByText('Sound off')).toBeTruthy();
    fireEvent.click(screen.getByTestId('alarm-sound-toggle'));
    expect(screen.getByText('Sound on')).toBeTruthy();
  });
});
