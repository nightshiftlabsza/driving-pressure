import { describe, it, expect } from 'vitest';
import type { DeviceSettings } from '../shared/engineTypes';
import {
  DEAD_BAND, afterChange, afterOutcome, classifySettingChange, compareExpectations, directionOf, fullyMatched, loopReassessReady, loopScoringDecision, shouldPrompt, type FadeState,
} from './settingLoop';

const vc: DeviceSettings = { device: 'invasive', mode: 'VC-AC', fio2: 0.4, peep: 5, rrSetBpm: 14, vtSetMl: 450, inspFlowLpm: 60, flowPattern: 'square' };

describe('classifySettingChange', () => {
  it('names the setting that changed', () => {
    expect(classifySettingChange(vc, { ...vc, peep: 8 })).toBe('peep');
    expect(classifySettingChange(vc, { ...vc, fio2: 0.6 })).toBe('fio2');
    expect(classifySettingChange(vc, { ...vc, rrSetBpm: 20 })).toBe('rate');
    expect(classifySettingChange(vc, { ...vc, vtSetMl: 400 })).toBe('volume-pressure');
    expect(classifySettingChange(vc, { ...vc, mode: 'PC-AC' } as DeviceSettings)).toBe('mode');
  });
});

describe('directionOf and compareExpectations', () => {
  it('treats moves inside the dead-band as no change', () => {
    expect(directionOf('ppeak', 20, 20 + DEAD_BAND.ppeak - 0.1)).toBe('same');
    expect(directionOf('ppeak', 20, 22)).toBe('up');
    expect(directionOf('spo2', 94, 93.5)).toBe('same');
    expect(directionOf('spo2', 94, 91)).toBe('down');
    expect(directionOf('vte', 400, 410)).toBe('same');
    expect(directionOf('etco2', 40, 44)).toBe('up');
  });
  it('marks each row matched or not, and skips unavailable readouts', () => {
    const before = { ppeak: 20, vte: 400, spo2: 90, etco2: null };
    const after = { ppeak: 25, vte: 405, spo2: 95, etco2: null };
    const rows = compareExpectations({ ppeak: 'up', vte: 'up', spo2: 'up', etco2: 'down' }, before, after);
    expect(rows.map(r => r.matched)).toEqual([true, false, true, null]);
    expect(rows[1]!.actual).toBe('same');
    expect(fullyMatched(rows)).toBe(false);
    expect(fullyMatched(rows.filter(r => r.matched !== false))).toBe(true);
    expect(fullyMatched([])).toBe(false);
  });
});

describe('fading', () => {
  const change = (s: FadeState): { s: FadeState; prompted: boolean } => {
    const prompted = shouldPrompt(s);
    return { s: afterChange(s, prompted), prompted };
  };
  it('prompts every change until three matches in a row, then every third change', () => {
    let s: FadeState = { streak: 0, unprompted: 0 };
    for (let i = 0; i < 3; i++) {
      const r = change(s); expect(r.prompted).toBe(true); s = afterOutcome(r.s, true);
    }
    const seq: boolean[] = [];
    for (let i = 0; i < 6; i++) { const r = change(s); seq.push(r.prompted); s = r.s; if (r.prompted) s = afterOutcome(s, true); }
    expect(seq).toEqual([false, false, true, false, false, true]);
  });
  it('resets to every change after any mismatch', () => {
    let s: FadeState = { streak: 5, unprompted: 1 };
    s = afterOutcome(s, false);
    expect(s).toEqual({ streak: 0, unprompted: 0 });
    expect(shouldPrompt(s)).toBe(true);
    expect(shouldPrompt(afterChange(s, true))).toBe(true);
  });
  it('two matches are not enough to fade', () => {
    expect(shouldPrompt({ streak: 2, unprompted: 0 })).toBe(true);
  });
});

describe('loopReassessReady', () => {
  const change = 600;
  it("'after next blood gas' ignores a gas sampled before the change even if it arrives after", () => {
    expect(loopReassessReady({ dueSimSec: null, changeSimSec: change }, [{ sampledAtSimSec: 500 }], 800)).toBe(false);
  });
  it("'after next blood gas' accepts a gas sampled after the change", () => {
    expect(loopReassessReady({ dueSimSec: null, changeSimSec: change }, [{ sampledAtSimSec: 500 }, { sampledAtSimSec: 700 }], 900)).toBe(true);
  });
  it('a timed reassessment is ready once its time arrives', () => {
    expect(loopReassessReady({ dueSimSec: 900, changeSimSec: change }, [], 899)).toBe(false);
    expect(loopReassessReady({ dueSimSec: 900, changeSimSec: change }, [], 900)).toBe(true);
  });
});

describe('loopScoringDecision', () => {
  it('scores nothing when three changes land within 20 sim-seconds', () => {
    const times = [0, 10, 20];
    expect(loopScoringDecision({ changeSimSec: 0 }, 60, times)).toBe('not-scored');
    expect(loopScoringDecision({ changeSimSec: 10 }, 70, times)).toBe('not-scored');
    expect(loopScoringDecision({ changeSimSec: 20 }, 80, times)).toBe('not-scored');
  });
  it('scores an isolated change as before', () => {
    expect(loopScoringDecision({ changeSimSec: 100 }, 160, [100])).toBe('scored');
  });
  it('ignores a later change that lands after the look-again time', () => {
    expect(loopScoringDecision({ changeSimSec: 100 }, 160, [100, 161])).toBe('scored');
  });
  it('does not score when a change was made 59 s earlier but does when 60 s earlier', () => {
    expect(loopScoringDecision({ changeSimSec: 159 }, 300, [100, 159])).toBe('not-scored');
    expect(loopScoringDecision({ changeSimSec: 160 }, 300, [100, 160])).toBe('scored');
  });
});
