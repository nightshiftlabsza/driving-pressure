// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema } from '../../src/shared/caseSchema';
import { engine } from '../../src/engine/index';
import { CaseRunner } from '../../src/app/CaseRunner';
import { MemoryEventSink } from '../../src/shared/eventSink';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function loadCase(id: string) {
  return CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8')));
}

async function start(id: string, sink: MemoryEventSink) {
  render(<CaseRunner caseFile={loadCase(id)} engine={engine} sink={sink} sessionId="s" onFinished={() => {}} autoplay={false} />);
  await screen.findByTestId('case-runner');
  fireEvent.click(screen.getByTestId('take-over-button'));
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

describe('queued status label', () => {
  it('reads "Queued for next breath" after a settings change and clears after the next breath', async () => {
    const sink = new MemoryEventSink();
    await start('asthma-vent-01', sink);
    await raisePeep();
    await waitFor(() => expect(screen.getByTestId('queued-label').textContent).toBe('Queued for next breath'));
    // The case may raise its own prediction after a settings order; answer it so time can run.
    await waitFor(() => expect(screen.queryByText(/Predict before/)).toBeTruthy());
    for (const b of screen.getAllByRole('button', { name: 'no change' })) fireEvent.click(b);
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    const cont = screen.queryByRole('button', { name: 'Continue' });
    if (cont) fireEvent.click(cont);
    // Skip five minutes: the next breaths complete and the label clears.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+5 min' })); });
    await waitFor(() => expect(screen.queryByTestId('queued-label')).toBeNull());
  }, 30000);

  it('reads "Hold queued" while a hold runs and clears when the hold returns its result', async () => {
    const sink = new MemoryEventSink();
    await start('asthma-vent-01', sink);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspiratory hold' }));
    await waitFor(() => expect(screen.getByTestId('queued-label').textContent).toBe('Hold queued'), { timeout: 15000 });
    // The hold finishes within a couple of real seconds at 1x speed; then the label clears.
    await waitFor(() => expect(screen.queryByTestId('queued-label')).toBeNull(), { timeout: 15000 });
    expect(screen.getByTestId('hold-result').textContent).not.toBe('');
  }, 30000);
});
