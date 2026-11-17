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

async function waitForAutoPeepTile(): Promise<string> {
  let text = '';
  await waitFor(() => {
    text = screen.getByTestId('vent-auto-peep').textContent ?? '';
    expect(/^[0-9]/.test(text.replace('Auto-PEEPcmH2O', ''))).toBe(true);
  }, { timeout: 20000 });
  return text.replace('Auto-PEEPcmH2O', '');
}

describe('auto-PEEP settling cue', () => {
  it('does not show when consecutive expiratory holds agree, and shows when they differ by more than 1 cmH2O', async () => {
    render(<CaseRunner caseFile={loadCase('asthma-vent-01')} engine={engine} sink={new MemoryEventSink()} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    fireEvent.click(screen.getByTestId('take-over-button'));
    const cont = screen.queryByRole('button', { name: 'Continue' });
    if (cont) fireEvent.click(cont);
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });

    // First expiratory hold: no cue yet.
    fireEvent.click(screen.getByRole('button', { name: 'Expiratory hold' }));
    const first = await waitForAutoPeepTile();
    expect(screen.queryByTestId('autopeep-cue')).toBeNull();

    // Raise the set rate sharply so trapping increases between the two measurements.
    await act(async () => { fireEvent.click(screen.getByTestId('control-rr')); });
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByLabelText('Increase Rate'));
    await act(async () => { fireEvent.click(screen.getByTestId('control-apply')); });
    await commitSheetIfOpen();
    await answerPredictionIfAny();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+5 min' })); });

    // Second expiratory hold: the measured auto-PEEP moved by more than 1 cmH2O.
    fireEvent.click(screen.getByRole('button', { name: 'Expiratory hold' }));
    const second = await waitForAutoPeepTile();
    expect(Math.abs(Number(second) - Number(first))).toBeGreaterThan(1);
    await waitFor(() => expect(screen.getByTestId('autopeep-cue').textContent).toBe('Auto-PEEP still changing, wait a few breaths'), { timeout: 10000 });
  }, 60000);
});
