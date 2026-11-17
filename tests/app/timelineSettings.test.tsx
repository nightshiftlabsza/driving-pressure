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

function timelineRows(): string[] {
  return Array.from(screen.getByTestId('timeline').querySelectorAll('li')).map(li => li.textContent ?? '');
}

describe('timeline rows for settings changes', () => {
  it('says what changed: Vt first, then a rate-only change without repeating Vt', async () => {
    render(<CaseRunner caseFile={loadCase('ards-vent-01')} engine={engine} sink={new MemoryEventSink()} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    fireEvent.click(screen.getByTestId('take-over-button'));
    await answerWeightQuestion();
    await act(async () => { await new Promise(r => setTimeout(r, 500)); });

    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));

    // Vt 650 -> 400
    await changeSetting('control-vt', '400');
    await waitFor(() => expect(timelineRows().some(r => r.includes('Vt') && r.includes('400'))).toBe(true), { timeout: 10000 });
    expect(timelineRows()[0]).toContain('Vt');

    // Rate only: 16 -> 20; the newest row names the rate, not Vt.
    await changeSetting('control-rr', '20');
    await waitFor(() => expect(timelineRows()[0]).toContain('Rate'), { timeout: 10000 });
    expect(timelineRows()[0]).toContain('20');
    expect(timelineRows()[0]).not.toContain('Vt');
  }, 120000);
});
