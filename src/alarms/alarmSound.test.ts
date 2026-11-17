// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AlarmSounder, TONE_PATTERNS, audibleAlarm, isAlarmSoundEnabled, setAlarmSoundEnabled, subscribeAlarmSound,
} from './alarmSound';
import type { ActiveAlarm } from './types';

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
  id, priority, message: id, raisedAtSimSec: 0, conditionActive: true, ...o,
});

describe('audibleAlarm', () => {
  it('picks the highest priority active unacknowledged alarm', () => {
    const r = audibleAlarm([alarm('l', 'low'), alarm('h', 'high'), alarm('m', 'med')]);
    expect(r?.id).toBe('h');
  });
  it('ignores resolved and acknowledged alarms', () => {
    const r = audibleAlarm([
      alarm('h1', 'high', { conditionActive: false, isLatched: true }),
      alarm('h2', 'high', { acknowledgedAtSimSec: 5 }),
      alarm('l', 'low'),
    ]);
    expect(r?.id).toBe('l');
  });
  it('is undefined when none qualify', () => {
    expect(audibleAlarm([])).toBeUndefined();
    expect(audibleAlarm([alarm('h', 'high', { acknowledgedAtSimSec: 1 })])).toBeUndefined();
  });
});

describe('alarm sound preference', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to on', () => expect(isAlarmSoundEnabled()).toBe(true));
  it('persists off and notifies subscribers', () => {
    const fn = vi.fn();
    const un = subscribeAlarmSound(fn);
    setAlarmSoundEnabled(false);
    expect(localStorage.getItem('vt-alarm-sound')).toBe('off');
    expect(isAlarmSoundEnabled()).toBe(false);
    expect(fn).toHaveBeenCalledWith(false);
    un();
    setAlarmSoundEnabled(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isAlarmSoundEnabled()).toBe(true);
  });
});

describe('AlarmSounder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('bursts at start and every repeatSec, and stops', () => {
    const s = new AlarmSounder();
    s.set('high');
    expect(s.burstCount).toBe(1);
    expect(s.playing).toBe('high');
    vi.advanceTimersByTime(TONE_PATTERNS.high.repeatSec * 1000);
    expect(s.burstCount).toBe(2);
    s.set(null);
    expect(s.playing).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(s.burstCount).toBe(2);
    s.dispose();
  });

  it('does not restart for the same priority', () => {
    const s = new AlarmSounder();
    s.set('med');
    s.set('med');
    expect(s.burstCount).toBe(1);
    s.dispose();
  });
});
