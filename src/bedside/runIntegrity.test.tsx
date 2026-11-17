// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, type CaseFile } from '../shared/caseSchema';
import { engine } from '../engine/index';
import { CaseRunner } from '../app/CaseRunner';
import { MemoryEventSink } from '../shared/eventSink';
import { isEvidenceEvent } from '../shared/events';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

function loadCase(id: string): CaseFile {
  const p = join(__dirname, '../cases/library', `${id}.json`);
  return CaseSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

describe('Run Integrity and Bedside Loop Guarantees', () => {
  it('pauses the simulation clock until "Take over the patient" is pressed', async () => {
    vi.useFakeTimers();
    const ventCase = loadCase('vent-high-pressure-01');
    const sink = new MemoryEventSink();

    render(
      <CaseRunner
        caseFile={ventCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={true}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('handoff-card')).toBeTruthy();
    expect(screen.getByLabelText('Simulated time').textContent).toBe('0:00:00');

    // Advance fake timers by 10 real seconds while handoff card is open
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByLabelText('Simulated time').textContent).toBe('0:00:00');

    // Take over patient and confirm clock starts advancing and resource_opened is logged
    await act(async () => {
      fireEvent.click(screen.getByTestId('take-over-button'));
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(screen.queryByTestId('handoff-card')).toBeNull();
    expect(screen.getByLabelText('Simulated time').textContent).not.toBe('0:00:00');
    expect(
      sink.events.some(e => e.type === 'resource_opened' && e.resource === 'blind-handoff:vent-high-pressure-01')
    ).toBe(true);
  });

  it('guarantees rescue actions (suction, disconnect, call-senior, needle-decompression, FiO2 1.0) are never gated or confirmed even at guided level', async () => {
    const ventCase = loadCase('vent-high-pressure-01');
    const sink = new MemoryEventSink();
    const guidedMap = Object.fromEntries(ventCase.competencies.map(c => [c, 'guided' as const]));

    render(
      <CaseRunner
        caseFile={ventCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={false}
        guidanceMap={guidedMap}
      />
    );

    // Wait for case to load
    await screen.findByTestId('case-runner');

    // Initial handoff is shown
    expect(screen.getByTestId('handoff-card')).toBeTruthy();
    // Dismiss handoff to take over the patient
    fireEvent.click(screen.getByTestId('take-over-button'));
    expect(screen.queryByTestId('handoff-card')).toBeNull();

    // 1. Rescue order: Suction tube
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    fireEvent.click(screen.getByRole('button', { name: /Suction tube/ }));
    expect(screen.queryByTestId('commit-sheet')).toBeNull();
    await waitFor(() => {
      expect(sink.events.some(e => e.type === 'order' && e.order === 'suction')).toBe(true);
    });

    // 2. Rescue order: Needle decompression — must execute immediately WITHOUT CommitSheet or Confirm modal
    fireEvent.click(screen.getByRole('button', { name: /Needle decompression/ }));
    expect(screen.queryByTestId('commit-sheet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    await waitFor(() => {
      expect(sink.events.some(e => e.type === 'order' && e.order === 'needle-decompression')).toBe(true);
    });
  });

  it('gates the first non-rescue titration with CommitSheet, emits evidence, and executes after commit', async () => {
    const ardsCase = loadCase('ards-vent-01');
    const sink = new MemoryEventSink();

    render(
      <CaseRunner
        caseFile={ardsCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={false}
      />
    );

    await screen.findByTestId('case-runner');

    // Dismiss initial handoff
    if (screen.queryByTestId('take-over-button')) {
      fireEvent.click(screen.getByTestId('take-over-button'));
    }

    // ards-vent-01 has an opening prediction (p-pbw); answer it first to clear prediction modal
    const predModal = screen.queryByText(/predicted body weight/);
    if (predModal) {
      fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
      fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit answer' }));
      });
      const contBtn = screen.queryByRole('button', { name: 'Continue' });
      if (contBtn) fireEvent.click(contBtn);
    }

    // Now attempt first non-rescue therapeutic order: Prone position
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    const proneBtn = screen.getByRole('button', { name: /Prone position/ });
    fireEvent.click(proneBtn);

    // Commit sheet MUST appear!
    expect(screen.getByTestId('commit-sheet')).toBeTruthy();
    expect(screen.getAllByText(/Prone position/).length).toBeGreaterThanOrEqual(1);

    // Select assessment and confidence (max 3 taps)
    fireEvent.click(screen.getByTestId('assessment-option-low_compliance'));
    fireEvent.click(screen.getByTestId('confidence-option-certain'));
    fireEvent.click(screen.getByTestId('commit-button'));

    // Commit sheet is dismissed
    expect(screen.queryByTestId('commit-sheet')).toBeNull();

    // Verifies assessment_commit was recorded with valid EvidenceFields
    const commitEvent = sink.events.find(e => e.type === 'assessment_commit');
    expect(commitEvent).toBeDefined();
    if (commitEvent && commitEvent.type === 'assessment_commit') {
      expect(commitEvent.assessments).toEqual(['low_compliance']);
      expect(commitEvent.confidence).toBe('certain');
      expect(commitEvent.evidenceType).toBe('interpretation');
      expect(commitEvent.correct).toBe(true);
      expect(isEvidenceEvent(commitEvent)).toBe(true);
      expect(typeof commitEvent.simTimeSec).toBe('number');
    }

    // And the intercepted order (prone) was executed!
    await waitFor(() => {
      expect(sink.events.some(e => e.type === 'order' && e.order === 'prone')).toBe(true);
    });

    // Subsequent titrations do NOT re-trigger commit sheet
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-peep'));
    });
    fireEvent.click(screen.getByLabelText(/^Increase/));
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-apply'));
    });
    expect(screen.queryByTestId('commit-sheet')).toBeNull();
  });

  it('allows revising assessment and records another assessment_commit with revised flag', async () => {
    const copdCase = loadCase('copd-niv-01');
    const sink = new MemoryEventSink();

    render(
      <CaseRunner
        caseFile={copdCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={false}
      />
    );

    await screen.findByTestId('case-runner');

    // Dismiss handoff
    fireEvent.click(screen.getByTestId('take-over-button'));

    // First titration: Bronchodilator
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bronchodilator/ }));
    expect(screen.getByTestId('commit-sheet')).toBeTruthy();

    fireEvent.click(screen.getByTestId('assessment-option-high_resistance'));
    fireEvent.click(screen.getByTestId('confidence-option-fairly_sure'));
    fireEvent.click(screen.getByTestId('commit-button'));

    const initialCommits = sink.events.filter(e => e.type === 'assessment_commit');
    expect(initialCommits.length).toBe(1);

    // Now click the revision button in header
    const reviseBtn = screen.getByRole('button', { name: /Working assessment.*Revise/ });
    expect(reviseBtn).toBeTruthy();
    fireEvent.click(reviseBtn);

    // Revision sheet appears
    expect(screen.getByTestId('commit-sheet')).toBeTruthy();
    expect(screen.getByText('Update your working assessment')).toBeTruthy();

    // Change to hypercapnic failure + high resistance
    fireEvent.click(screen.getByTestId('assessment-option-hypercapnic_failure'));
    fireEvent.click(screen.getByTestId('confidence-option-certain'));
    fireEvent.click(screen.getByTestId('commit-button'));

    const allCommits = sink.events.filter(e => e.type === 'assessment_commit');
    expect(allCommits.length).toBe(2);
    const rev = allCommits[1];
    if (rev && rev.type === 'assessment_commit') {
      expect(rev.revised).toBe(true);
      expect(rev.confidence).toBe('certain');
      expect(rev.assessments).toContain('hypercapnic_failure');
    }
  });

  it('displays optional rationale chip on major settings change, records rationale event, and respects rate limit', async () => {
    const ardsCase = loadCase('ards-vent-01');
    const sink = new MemoryEventSink();
    // Faded-out path: PEEP prompts are in every-3rd mode and this change is one to skip, so the old chip applies.
    const store = new Map<string, string>([['ovs_setting_loop_v1', JSON.stringify({ peep: { streak: 3, unprompted: 0 } })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

    render(
      <CaseRunner
        caseFile={ardsCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={false}
      />
    );

    await screen.findByTestId('case-runner');

    // Dismiss handoff
    fireEvent.click(screen.getByTestId('take-over-button'));

    // Answer opening prediction
    const predModal = screen.queryByText(/predicted body weight/);
    if (predModal) {
      fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
      fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit answer' }));
      });
      const contBtn = screen.queryByRole('button', { name: 'Continue' });
      if (contBtn) fireEvent.click(contBtn);
    }

    // Commit working assessment first so settings change can proceed
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    fireEvent.click(screen.getByRole('button', { name: /Prone position/ }));
    fireEvent.click(screen.getByTestId('assessment-option-low_compliance'));
    fireEvent.click(screen.getByTestId('confidence-option-certain'));
    fireEvent.click(screen.getByTestId('commit-button'));

    // Now make a major ventilator settings change via VentControls: increase PEEP by +3 (from 5 to 8)
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-peep'));
    });
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByLabelText(/^Increase/));
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-apply'));
    });

    // Rationale chip should now appear!
    await waitFor(() => {
      expect(screen.getByTestId('rationale-chip-container')).toBeTruthy();
    });

    // Select reason: Lung protection
    fireEvent.click(screen.getByTestId('rationale-option-lung_protection'));

    // Verify rationale event was recorded
    const ratEvent = sink.events.find(e => e.type === 'rationale');
    expect(ratEvent).toBeDefined();
    if (ratEvent && ratEvent.type === 'rationale') {
      expect(ratEvent.reasonId).toBe('lung_protection');
      expect(ratEvent.targetAction.kind).toBe('settings_change');
    }

    // Rationale chip is dismissed
    expect(screen.queryByTestId('rationale-chip-container')).toBeNull();

    // Make another major change immediately: PEEP +3 more (8 to 11)
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-peep'));
    });
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByLabelText(/^Increase/));
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-apply'));
    });

    // Because < 2 sim-minutes have passed, rate limit prevents showing rationale chip again
    expect(screen.queryByTestId('rationale-chip-container')).toBeNull();
  });

  it('routes transfer variant events through effectiveSink with transfer_probe context tag', async () => {
    const baseCase = loadCase('ards-vent-01');
    const transferVariantCase: CaseFile = {
      ...baseCase,
      id: 'ards-vent-01--pbw-short-female',
      contextTags: ['transfer_probe', 'ards'],
    };
    const sink = new MemoryEventSink();

    render(
      <CaseRunner
        caseFile={transferVariantCase}
        engine={engine}
        sink={sink}
        sessionId="test-session"
        onFinished={() => {}}
        autoplay={false}
      />
    );

    await screen.findByTestId('case-runner');

    // Initial handoff card is displayed; click Take over
    await waitFor(() => {
      expect(screen.getByTestId('handoff-card')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('take-over-button'));
    });
    expect(screen.queryByTestId('handoff-card')).toBeNull();

    // Verify handleTakeOver recorded resource_opened via effectiveSink with transfer_probe context tag
    const handoffEv = sink.events.find(
      e => e.type === 'resource_opened' && e.resource === 'blind-handoff:ards-vent-01--pbw-short-female'
    );
    expect(handoffEv).toBeDefined();
    expect(handoffEv?.contextTags).toContain('transfer_probe');

    // Clear opening prediction if present
    const predModal = screen.queryByText(/predicted body weight/);
    if (predModal) {
      fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
      fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit answer' }));
      });
      const contBtn = screen.queryByRole('button', { name: 'Continue' });
      if (contBtn) fireEvent.click(contBtn);
    }

    // Trigger CommitSheet via first non-rescue therapeutic order: Prone position
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    const proneBtn = screen.getByRole('button', { name: /Prone position/ });
    fireEvent.click(proneBtn);
    expect(screen.getByTestId('commit-sheet')).toBeTruthy();

    fireEvent.click(screen.getByTestId('assessment-option-low_compliance'));
    fireEvent.click(screen.getByTestId('confidence-option-certain'));
    fireEvent.click(screen.getByTestId('commit-button'));

    // Verify handleCommitAssessment recorded assessment_commit via effectiveSink carrying transfer_probe context tag and transfer flags
    const commitEv = sink.events.find(e => e.type === 'assessment_commit');
    expect(commitEv).toBeDefined();
    expect(commitEv?.contextTags).toContain('transfer_probe');
    const customCommit = commitEv as (typeof commitEv & { isTransferVariant?: boolean; transferVariantId?: string });
    expect(customCommit?.isTransferVariant).toBe(true);
    expect(customCommit?.transferVariantId).toBe('ards-vent-01--pbw-short-female');
  });
});
