// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { engine } from '../../src/engine/index';
import { createLearner } from '../../src/learner/learner';
import { MemoryStorage } from '../../src/learner/storage';
import { TrainerApp } from '../../src/app/TrainerApp';
import { CaseRunner } from '../../src/app/CaseRunner';
import { MemoryEventSink } from '../../src/shared/eventSink';

const libDir = join(__dirname, '../../src/cases/library');
const cases: CaseFile[] = readdirSync(libDir).filter(f => f.endsWith('.json')).map(f => CaseSchema.parse(JSON.parse(readFileSync(join(libDir, f), 'utf8'))));
const copd = cases.find(c => c.id === 'copd-niv-01')!;

afterEach(() => cleanup());

describe('TrainerApp', () => {
  it('defaults #/trainer with no view parameter to the Pathway Home screen while #/trainer?view=cases opens CaseLibrary', async () => {
    const learner = createLearner(new MemoryStorage());
    window.location.hash = '#/trainer';
    const { unmount } = render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    expect(await screen.findByTestId('pathway-home')).toBeTruthy();
    unmount();

    window.location.hash = '#/trainer?view=cases';
    render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    expect(await screen.findByText('Case Library')).toBeTruthy();
  });

  it('supports hash query parameters for direct case and lab launch (#/trainer?case=... and #/trainer?lab=...)', async () => {
    const learner = createLearner(new MemoryStorage());
    window.location.hash = '#/trainer?case=copd-niv-01';
    const { unmount } = render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    expect(await screen.findByTestId('case-runner', {}, { timeout: 5000 })).toBeTruthy();
    unmount();

    window.location.hash = '#/trainer?lab=01-rc-time-constant-exhalation';
    render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    expect(await screen.findByTestId('lab-runner', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('lists cases, plays one through to a debrief, and records the run', async () => {
    window.location.hash = '#/trainer?view=cases';
    const learner = createLearner(new MemoryStorage());
    render(<TrainerApp learner={learner} engine={engine} catalog={{ cases: [copd], failures: [], invalid: [] }} defaultTab="cases" />);
    expect(await screen.findByText(copd.title)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /start/i })[0]!);
    expect(await screen.findByTestId('case-runner', {}, { timeout: 5000 })).toBeTruthy();
    if (screen.queryByTestId('take-over-button')) fireEvent.click(screen.getByTestId('take-over-button'));

    // order a gas, then skip 5 minutes so it returns
    fireEvent.click(screen.getByRole('tab', { name: /^Orders/ }));
    fireEvent.click(screen.getByRole('button', { name: /Arterial blood gas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+5 min' })); });
    fireEvent.click(screen.getByRole('tab', { name: /^Blood gases/ }));
    await waitFor(() => expect(screen.getByTestId('case-runner').querySelectorAll('tbody tr.font-mono').length).toBe(1), { timeout: 10000 });

    // switch to NIV: first therapeutic titration shows CommitSheet, then prediction modal appears
    fireEvent.click(screen.getByRole('button', { name: /^Device:/ }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Choose device' })).getByRole('button', { name: 'NIV' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm device' })); });
    if (screen.queryByTestId('commit-sheet')) {
      fireEvent.click(screen.getByTestId('assessment-option-hypercapnic_failure'));
      fireEvent.click(screen.getByTestId('confidence-option-fairly_sure'));
      await act(async () => { fireEvent.click(screen.getByTestId('commit-button')); });
    }
    expect(await screen.findByText(/Predict before you see/)).toBeTruthy();
    const commit = screen.getByRole('button', { name: 'Commit answer' }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    for (const row of ['PaCO2', 'pH', 'Resp rate']) {
      const label = within(screen.getByRole('dialog')).getByText(row);
      const buttons = label.parentElement!.querySelectorAll('button');
      fireEvent.click(row === 'pH' ? buttons[0]! : buttons[2]!); // pH up, others down
    }
    fireEvent.click(screen.getByRole('button', { name: 'Fairly sure' }));
    await act(async () => { fireEvent.click(commit); });
    expect(await screen.findByText(/Answer saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // An engine-marked answer is scored 30 simulated minutes after it was given, so wait a little longer than that.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+30 min' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+5 min' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Stop case|Go to debrief/ })); });
    await waitFor(() => expect(screen.queryByTestId('case-runner')).toBeNull(), { timeout: 10000 });

    const runs = await learner.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]!.activityId).toBe('copd-niv-01');
    expect(runs[0]!.ordersTimeline.map(o => o.order)).toEqual(expect.arrayContaining(['abg', 'change-device']));
    expect(runs[0]!.predictions.length).toBe(1);
  }, 30000);

  it('opens the drills and progress tabs', async () => {
    const learner = createLearner(new MemoryStorage());
    render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drills' }));
    expect(screen.getAllByRole('button', { name: 'Start' }).length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    expect(await screen.findByRole('button', { name: /Export JSON/i })).toBeTruthy();
  });
});

describe('CaseRunner', () => {
  it('runs an inspiratory hold on an invasive case and reports Pplat', async () => {
    // ards-vent-01 opens with a numeric prediction (PBW) that must be committed before time runs
    const vent = cases.find(c => c.id === 'ards-vent-01')!;
    render(<CaseRunner caseFile={vent} engine={engine} sink={new MemoryEventSink()} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    if (screen.queryByTestId('take-over-button')) fireEvent.click(screen.getByTestId('take-over-button'));
    expect(await screen.findByText(/predicted body weight/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    expect(await screen.findByText('Correct.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    fireEvent.click(screen.getByRole('button', { name: 'Inspiratory hold' }));
    await waitFor(() => expect(screen.getByTestId('hold-result').textContent).toMatch(/Pplat 3\d/), { timeout: 15000 });
  }, 20000);

  it('starts only one run under StrictMode', async () => {
    const sink = new MemoryEventSink();
    render(<React.StrictMode><CaseRunner caseFile={copd} engine={engine} sink={sink} sessionId="s" onFinished={() => {}} autoplay={false} /></React.StrictMode>);
    await screen.findByTestId('case-runner');
    expect(sink.events.filter(e => e.type === 'run_start').length).toBe(1);
  });

  it('does not freeze sim clock after answering first prediction when startRun has async delay', async () => {
    const vent = cases.find(c => c.id === 'ards-vent-01')!;
    const events: unknown[] = [];
    const delayedSink = {
      events,
      async record(e: unknown) {
        await new Promise(r => setTimeout(r, 150));
        events.push(e);
      },
    };
    render(<CaseRunner caseFile={vent} engine={engine} sink={delayedSink} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    if (screen.queryByTestId('take-over-button')) fireEvent.click(screen.getByTestId('take-over-button'));
    expect(await screen.findByText(/predicted body weight/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    expect(await screen.findByText('Correct.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      const timeDisplay = screen.getByLabelText('Simulated time').textContent;
      expect(timeDisplay).not.toBe('0:00:00');
    }, { timeout: 10000 });
  }, 15000);
});
