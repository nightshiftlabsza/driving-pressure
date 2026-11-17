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
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function loadCase(id: string) {
  return CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8')));
}

async function answerWeightQuestion() {
  await screen.findByText(/Predict before you see/);
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
  fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
}

async function commitSheetIfOpen() {
  const sheet = screen.queryByTestId('commit-sheet');
  if (sheet) {
    fireEvent.click(sheet.querySelector("[data-testid^=assessment-option-]")!);
    fireEvent.click(screen.getByTestId('confidence-option-certain'));
    await act(async () => { fireEvent.click(screen.getByTestId('commit-button')); });
  }
}

async function answerPredictionIfAny() {
  await waitFor(() => expect(screen.queryByText(/Predict before/)).toBeTruthy(), { timeout: 10000 }).catch(() => {});
  const commit = screen.queryByRole('button', { name: 'Commit answer' });
  if (commit) {
    for (const b of screen.getAllByRole('button', { name: 'no change' })) fireEvent.click(b);
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(commit); });
    const cont = screen.queryByRole('button', { name: 'Continue' });
    if (cont) fireEvent.click(cont);
  }
}

async function dismissLoopIfAny() {
  const skip = screen.queryByTestId('setting-loop-skip');
  if (skip) fireEvent.click(skip);
}

async function changeSetting(testId: string, value: string) {
  fireEvent.click(screen.getByTestId(testId));
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
  await act(async () => { fireEvent.click(screen.getByTestId('control-apply')); });
  await commitSheetIfOpen();
  await answerPredictionIfAny();
  await dismissLoopIfAny();
}

describe('hold line after a settings change', () => {
  it('shows the hold result, blanks it after a PEEP change, and shows a new hold again', async () => {
    render(<CaseRunner caseFile={loadCase('ards-vent-01')} engine={engine} sink={new MemoryEventSink()} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    fireEvent.click(screen.getByTestId('take-over-button'));
    await answerWeightQuestion();
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });

    // Inspiratory hold: the span reports the measured plateau.
    fireEvent.click(screen.getByRole('button', { name: 'Inspiratory hold' }));
    await waitFor(() => expect(screen.getByTestId('hold-result').textContent).toContain('Pplat'), { timeout: 20000 });

    // PEEP 5 -> 12 with no new hold: the old number must not stay on screen.
    await changeSetting('control-peep', '12');
    await waitFor(() => expect(screen.getByTestId('hold-result').textContent).toContain('Repeat the hold'), { timeout: 10000 });
    const span = screen.getByTestId('hold-result');
    expect(span.textContent).not.toContain('driving pressure');
    expect(span.textContent).not.toMatch(/\d/);

    // A new hold measures again.
    fireEvent.click(screen.getByRole('button', { name: 'Inspiratory hold' }));
    await waitFor(() => expect(screen.getByTestId('hold-result').textContent).toContain('Pplat'), { timeout: 20000 });
  }, 120000);
});
