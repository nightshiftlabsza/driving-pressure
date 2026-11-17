/**
 * Audible alarm tones, generated in the browser (no audio files, no network).
 *
 * Behaviour follows the bedside convention: the tone tells you the priority (fast repeated bursts for high,
 * a slower three-pulse group for medium, a single soft pulse for low), it stops when the alarm is silenced,
 * acknowledged or resolved, and there is one global on/off switch that is remembered on this device.
 * The patterns are in the spirit of IEC 60601-1-8 priority coding; they are not a copy of any device's melody.
 */
import type { ActiveAlarm, AlarmPriority } from './types';

const PREF_KEY = 'vt-alarm-sound';
type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

export function isAlarmSoundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlarmSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
  } catch { /* storage blocked: the choice lasts for this page only */ }
  for (const l of listeners) l(enabled);
}

export function subscribeAlarmSound(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The alarm that should be sounding: the highest-priority alarm whose cause is still present and that nobody has acknowledged. */
export function audibleAlarm(alarms: readonly ActiveAlarm[]): ActiveAlarm | undefined {
  const order: Record<AlarmPriority, number> = { high: 0, med: 1, low: 2 };
  let best: ActiveAlarm | undefined;
  for (const a of alarms) {
    if (!a.conditionActive || a.acknowledgedAtSimSec !== undefined) continue;
    if (!best || order[a.priority] < order[best.priority]) best = a;
  }
  return best;
}

export interface TonePattern {
  /** Pulse start offsets in seconds from the start of a burst. */
  pulsesAtSec: readonly number[];
  pulseSec: number;
  frequencyHz: number;
  /** Seconds between burst starts. */
  repeatSec: number;
}

export const TONE_PATTERNS: Record<AlarmPriority, TonePattern> = {
  high: { pulsesAtSec: [0, 0.2, 0.4, 0.75, 0.95], pulseSec: 0.13, frequencyHz: 880, repeatSec: 3 },
  med: { pulsesAtSec: [0, 0.35, 0.7], pulseSec: 0.2, frequencyHz: 660, repeatSec: 8 },
  low: { pulsesAtSec: [0], pulseSec: 0.25, frequencyHz: 520, repeatSec: 16 },
};

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Plays the tone for one priority at a time. Safe to construct where Web Audio is missing (it then does nothing). */
export class AlarmSounder {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: AlarmPriority | null = null;
  /** Number of bursts started; exposed so tests can prove that sound was (or was not) requested. */
  public burstCount = 0;

  get playing(): AlarmPriority | null { return this.current; }

  set(priority: AlarmPriority | null): void {
    if (priority === this.current) return;
    this.stop();
    if (!priority) return;
    this.current = priority;
    const pattern = TONE_PATTERNS[priority];
    this.burst(pattern);
    this.timer = setInterval(() => this.burst(pattern), pattern.repeatSec * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current = null;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private burst(p: TonePattern): void {
    this.burstCount++;
    const Ctor = audioCtor();
    if (!Ctor) return;
    try {
      if (!this.ctx) this.ctx = new Ctor();
      const ctx = this.ctx;
      // Browsers keep audio suspended until the user has clicked something on the page.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const t0 = ctx.currentTime + 0.02;
      for (const at of p.pulsesAtSec) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = p.frequencyHz;
        const start = t0 + at;
        const end = start + p.pulseSec;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.09, start + 0.015);
        gain.gain.setValueAtTime(0.09, end - 0.03);
        gain.gain.linearRampToValueAtTime(0, end);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.01);
      }
    } catch { /* audio unavailable: the visual alarm still shows */ }
  }
}
