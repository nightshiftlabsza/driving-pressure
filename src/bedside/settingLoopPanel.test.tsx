// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, type CaseFile } from '../shared/caseSchema';
import { engine } from '../engine/index';
import { CaseRunner } from '../app/CaseRunner';
import { MemoryEventSink } from '../shared/eventSink';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function loadCase(id: string): CaseFile {
  return CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../cases/library', `${id}.json`), 'utf8')));
}

async function start(id: string, sink: MemoryEventSink) {
  render(<CaseRunner caseFile={loadCase(id)} engine={engine} sink={sink} sessionId="s" onFinished={() => {}} autoplay={false} />);
  await screen.findByTestId('case-runner');
  fireEvent.click(screen.getByTestId('take-over-button'));
  if (screen.queryByText(/predicted body weight/)) {
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    const cont = screen.queryByRole('button', { name: 'Continue' });
    if (cont) fireEvent.click(cont);
  }
}

async function raisePeep() {
  await act(async () => { fireEvent.click(screen.getByTestId("control-peep")); });
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText(/^Increase/));
  await act(async () => { fireEvent.click(screen.getByTestId('control-apply')); });
  const sheet = screen.queryByTestId("commit-sheet");
  if (sheet) {
    fireEvent.click(sheet.querySelector("[data-testid^=assessment-option-]")!);
    fireEvent.click(screen.getByTestId("confidence-option-certain"));
    await act(async () => { fireEvent.click(screen.getByTestId("commit-button")); });
  }
}

describe('setting change learning loop', () => {
  it('shows a non-blocking panel after a change that is already applied, and records the prediction', async () => {
    const sink = new MemoryEventSink();
    await start("asthma-vent-01", sink);
    await raisePeep();
    await waitFor(() => expect(screen.getByTestId('setting-loop-panel')).toBeTruthy());
    // Applied immediately, with the panel still open and unanswered.
    expect(sink.events.some(e => e.type === 'order' && e.order === 'change-settings')).toBe(true);
    expect(screen.getByTestId('control-peep')).toBeTruthy();
    fireEvent.click(screen.getByTestId('expect-ppeak-up'));
    fireEvent.click(screen.getByTestId('reassess-1min'));
    fireEvent.click(screen.getByTestId('setting-loop-save'));
    expect(screen.queryByTestId('setting-loop-panel')).toBeNull();
    // The case may raise its own prediction after a settings order; answer it so time can run.
    await waitFor(() => expect(screen.queryByText(/Predict before/)).toBeTruthy());
    for (const b of screen.getAllByRole('button', { name: 'no change' })) fireEvent.click(b);
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    const cont = screen.queryByRole('button', { name: 'Continue' });
    if (cont) fireEvent.click(cont);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+5 min' })); });
    await waitFor(() => expect(screen.getByTestId('setting-loop-result')).toBeTruthy(), { timeout: 15000 });
    expect(screen.getByTestId('result-ppeak').textContent).toMatch(/expected up, actual .*(matched|not matched)/);
    const ev = sink.events.find(e => e.type === 'prediction' && e.predictionId.startsWith('setting-change:'));
    expect(ev).toBeDefined();
  }, 30000);

  it('can be skipped', async () => {
    await start("asthma-vent-01", new MemoryEventSink());
    await raisePeep();
    await waitFor(() => screen.getByTestId('setting-loop-panel'));
    fireEvent.click(screen.getByTestId('setting-loop-skip'));
    expect(screen.queryByTestId('setting-loop-panel')).toBeNull();
  });

  it("still appears while a high-priority alarm is active, and the change applies", async () => {
    const sink = new MemoryEventSink();
    await start("ards-vent-01", sink);
    expect(screen.getByTestId("alarm-field").getAttribute("data-priority")).toBe("high");
    await raisePeep();
    await waitFor(() => expect(screen.getByTestId("setting-loop-panel")).toBeTruthy());
    expect(sink.events.some(e => e.type === "order" && e.order === "change-settings")).toBe(true);
  });

  it("shows no panel for a rescue change (FiO2 1.0)", async () => {
    const sink = new MemoryEventSink();
    await start("ards-vent-01", sink);
    await act(async () => { fireEvent.click(screen.getByTestId("control-fio2")); });
    for (let i = 0; i < 100; i++) fireEvent.click(screen.getByLabelText(/^Increase/));
    await act(async () => { fireEvent.click(screen.getByTestId("control-apply")); });
    await waitFor(() => expect(sink.events.some(e => e.type === "settings_change" && "fio2" in e.after && e.after.fio2 >= 0.999)).toBe(true));
    expect(screen.queryByTestId("setting-loop-panel")).toBeNull();
  });
});
