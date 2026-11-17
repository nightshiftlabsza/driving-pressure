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
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const loadCase = (id: string) => CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8')));

describe('ards-vent-01 opening', () => {
  it('shows the handoff alone, hides PBW until p-pbw is answered, then shows it', async () => {
    render(<CaseRunner caseFile={loadCase('ards-vent-01')} engine={engine} sink={new MemoryEventSink()} sessionId="s" onFinished={() => {}} autoplay />);
    await screen.findByTestId('case-runner');
    expect(screen.getByTestId('take-over-button')).toBeTruthy();
    expect(screen.queryByText(/Predict before you see/)).toBeNull();
    expect(screen.queryByText(/PBW/)).toBeNull();

    await act(async () => { fireEvent.click(screen.getByTestId('take-over-button')); });
    await screen.findByText(/Predict before you see/);
    expect(screen.queryByText(/PBW/)).toBeNull(); // the question itself says "predicted body weight", never "PBW"
    expect(screen.getByTestId('case-runner').textContent).toMatch(/170 cm · \d+ kg/);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '66' } });
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit answer' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByTestId('case-runner').textContent).toMatch(/PBW 66 kg/));
  });
});
