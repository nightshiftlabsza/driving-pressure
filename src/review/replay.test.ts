import { describe, it, expect } from 'vitest';
import { replayRun, extractDecisionsFromEvents, sampleMetrics } from './replay';
import type { DecisionInput } from './types';
import type { LearnerEvent } from '../shared/events';
import ardsCase from '../cases/library/ards-vent-01.json';
import hfncCase from '../cases/library/pneumonia-hfnc-01.json';
import type { CaseFile } from '../shared/caseSchema';

describe('Replay Engine', () => {
  it('extracts decisions from learner events', () => {
    const events: LearnerEvent[] = [
      {
        v: 1,
        id: 'ev-1',
        wallTime: '2026-11-08T00:00:00Z',
        sessionId: 'sess-1',
        runId: 'run-1',
        simTimeSec: 60,
        type: 'order',
        order: 'abg',
      },
      {
        v: 1,
        id: 'ev-2',
        wallTime: '2026-11-08T00:01:00Z',
        sessionId: 'sess-1',
        runId: 'run-1',
        simTimeSec: 120,
        type: 'order',
        order: 'change-settings',
        detail: { settings: { peep: 12, fio2: 0.8 } },
      },
    ];

    const decisions = extractDecisionsFromEvents(events, 'run-1');
    expect(decisions).toHaveLength(2);
    expect(decisions[0].kind).toBe('order');
    expect(decisions[0].order).toBe('abg');
    expect(decisions[0].simTimeSec).toBe(60);

    expect(decisions[1].kind).toBe('settings_change');
    expect(decisions[1].order).toBe('change-settings');
    expect(decisions[1].simTimeSec).toBe(120);
  });

  it('replaying a scripted run twice produces identical metric trajectories (determinism)', async () => {
    const decisions: DecisionInput[] = [
      {
        simTimeSec: 60,
        kind: 'order',
        order: 'abg',
      },
      {
        simTimeSec: 180,
        kind: 'settings_change',
        order: 'change-settings',
        detail: {
          settings: {
            peep: 14,
            fio2: 0.7,
            vtSetMl: 380,
            rrSetBpm: 24,
          },
        },
      },
      {
        simTimeSec: 600,
        kind: 'order',
        order: 'prone',
      },
    ];

    const replay1 = await replayRun(ardsCase as unknown as CaseFile, decisions, {
      sampleIntervalSec: 10,
      maxSimSec: 900,
    });

    const replay2 = await replayRun(ardsCase as unknown as CaseFile, decisions, {
      sampleIntervalSec: 10,
      maxSimSec: 900,
    });

    expect(replay1.metrics.length).toBe(replay2.metrics.length);
    expect(replay1.metrics.length).toBeGreaterThan(10);

    for (let i = 0; i < replay1.metrics.length; i++) {
      const m1 = replay1.metrics[i];
      const m2 = replay2.metrics[i];
      expect(m1.simTimeSec).toBe(m2.simTimeSec);
      expect(m1.spo2).toBe(m2.spo2);
      expect(m1.paco2).toBe(m2.paco2);
      expect(m1.ph).toBe(m2.ph);
      expect(m1.pplat).toBe(m2.pplat);
      expect(m1.drivingPressure).toBe(m2.drivingPressure);
      expect(m1.map).toBe(m2.map);
    }

    expect(replay1.decisions.length).toBe(3);
    expect(replay2.decisions.length).toBe(3);
  });

  it('preserves isolated RunState snapshots before and after each decision', async () => {
    const decisions: DecisionInput[] = [
      {
        simTimeSec: 120,
        kind: 'settings_change',
        order: 'change-settings',
        detail: { settings: { fio2: 0.9, peep: 12 } },
      },
    ];

    const res = await replayRun(ardsCase as unknown as CaseFile, decisions, {
      maxSimSec: 300,
    });

    expect(res.decisions).toHaveLength(1);
    const dec = res.decisions[0];

    // Snapshot before decision should have previous device settings
    expect(dec.stateBefore.engine.simTimeSec).toBeCloseTo(120, 0);
    expect(dec.stateBefore.engine.device.device).toBe('invasive');
    if (dec.stateBefore.engine.device.device === 'invasive') {
      expect(dec.stateBefore.engine.device.fio2).not.toBe(0.9);
    }

    // Snapshot after decision should have updated device settings
    if (dec.stateAfter.engine.device.device === 'invasive') {
      expect(dec.stateAfter.engine.device.fio2).toBe(0.9);
      expect(dec.stateAfter.engine.device.peep).toBe(12);
    }

    // Final state has advanced further, ensuring snapshots remained isolated
    expect(res.finalState.engine.simTimeSec).toBeGreaterThan(dec.stateAfter.engine.simTimeSec);
  });

  it('runs on pneumonia-hfnc-01 with device change and orders', async () => {
    const decisions: DecisionInput[] = [
      {
        simTimeSec: 60,
        kind: 'order',
        order: 'examine',
      },
      {
        simTimeSec: 300,
        kind: 'order',
        order: 'intubate',
      },
    ];

    const res = await replayRun(hfCaseFile(hfncCase), decisions, {
      sampleIntervalSec: 15,
      maxSimSec: 600,
    });

    expect(res.decisions.length).toBe(2);
    expect(res.metrics.length).toBeGreaterThan(5);
    const last = res.metrics[res.metrics.length - 1];
    expect(last.spo2).not.toBeNull();
  });
});

function hfCaseFile(raw: unknown): CaseFile {
  return raw as CaseFile;
}
