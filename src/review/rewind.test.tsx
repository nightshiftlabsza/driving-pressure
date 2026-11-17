// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  prepareRewindRun,
  getRewindMetadata,
  setPendingRewind,
  consumePendingRewind,
} from './rewind';
import type { ReplayDecisionPoint } from './types';
import type { CaseFile } from '../shared/caseSchema';
import type { RunState } from '../runtime/caseRuntime';
import { startRun } from '../runtime/caseRuntime';
import { engine as defaultEngine } from '../engine/index';
import { CaseRunner } from '../app/CaseRunner';
import ardsCaseRaw from '../cases/library/ards-vent-01.json';

const ardsCase = ardsCaseRaw as unknown as CaseFile;

describe('Rewind System', () => {
  it('creates an isolated new RunState linked to the parent run', async () => {
    const dummySink = { record: async () => {} };
    const originalRun = await startRun({ engine: defaultEngine, sink: dummySink }, ardsCase, {
      sessionId: 'orig-sess',
      runId: 'orig-run-123',
    });
    originalRun.engine.simTimeSec = 300;

    const decisionPoint: ReplayDecisionPoint = {
      index: 1,
      decision: {
        simTimeSec: 300,
        kind: 'settings_change',
        detail: { settings: { peep: 12 } },
      },
      simTimeSec: 300,
      stateBefore: originalRun,
      stateAfter: originalRun,
    };

    const { state: rewindState, meta } = prepareRewindRun(decisionPoint, 'orig-run-123', ardsCase);

    expect(rewindState.runId).toMatch(/^rewind-/);
    expect(rewindState.runId).not.toBe('orig-run-123');
    expect(rewindState.finished).toBe(false);
    expect(rewindState.ended).toBeNull();
    expect(rewindState.engine.simTimeSec).toBe(300);

    expect(meta.parentRunId).toBe('orig-run-123');
    expect(meta.rewindRunId).toBe(rewindState.runId);
    expect(meta.rewindAtSimSec).toBe(300);
    expect(meta.decisionIndex).toBe(1);

    const lookup = getRewindMetadata(rewindState.runId);
    expect(lookup).toEqual(meta);
  });

  it('handles pending rewind storage across navigation', async () => {
    const dummySink = { record: async () => {} };
    const run = await startRun({ engine: defaultEngine, sink: dummySink }, ardsCase, {
      sessionId: 'sess-p',
      runId: 'run-p',
    });
    run.engine.simTimeSec = 120;

    const meta = {
      rewindRunId: 'rewind-abc',
      parentRunId: 'run-p',
      caseId: ardsCase.id,
      rewindAtSimSec: 120,
      decisionIndex: 0,
      createdAt: new Date().toISOString(),
    };

    setPendingRewind(run, meta);
    const consumed = consumePendingRewind();

    expect(consumed).not.toBeNull();
    expect(consumed!.meta.rewindRunId).toBe('rewind-abc');
    expect(consumed!.state.engine.simTimeSec).toBe(120);

    // After consume, pending rewind should be cleared
    expect(consumePendingRewind()).toBeNull();
  });

  it('mounts CaseRunner starting from provided initialRunState', async () => {
    const dummySink = { record: async () => {} };
    const parentRun = await startRun({ engine: defaultEngine, sink: dummySink }, ardsCase, {
      sessionId: 'sess-cr',
      runId: 'parent-run-456',
    });
    parentRun.engine.simTimeSec = 360; // 6 minutes in

    const { state: rewindRun } = prepareRewindRun(
      {
        index: 2,
        decision: { simTimeSec: 360, kind: 'order', order: 'abg' },
        simTimeSec: 360,
        stateBefore: parentRun,
        stateAfter: parentRun,
      },
      'parent-run-456',
      ardsCase
    );

    let finishedRunId: string | null = null;

    render(
      <CaseRunner
        caseFile={ardsCase}
        engine={defaultEngine}
        sink={dummySink}
        sessionId="sess-cr"
        autoplay={false}
        initialRunState={rewindRun}
        onFinished={id => {
          finishedRunId = id;
        }}
      />
    );

    // Verify time display shows 0:06:00 (simTimeSec = 360) rather than 0:00:00
    await waitFor(() => {
      expect(screen.getByText('0:06:00')).toBeTruthy();
    });
  });
});
