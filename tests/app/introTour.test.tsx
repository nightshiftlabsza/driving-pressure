// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IntroTour, introTourSeen, INTRO_TOUR_KEY } from '../../src/app/IntroTour';
import { TrainerApp } from '../../src/app/TrainerApp';
import { engine } from '../../src/engine/index';
import { createLearner } from '../../src/learner/learner';
import { MemoryStorage } from '../../src/learner/storage';
import { CaseSchema, type CaseFile } from '../../src/shared/caseSchema';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  window.location.hash = '#/trainer';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const libDir = join(__dirname, '../../src/cases/library');
const cases: CaseFile[] = readdirSync(libDir).filter(f => f.endsWith('.json')).map(f => CaseSchema.parse(JSON.parse(readFileSync(join(libDir, f), 'utf8'))));

describe('IntroTour component', () => {
  it('walks through five steps: waveforms, settings, alarms, patient, consultant', () => {
    const onClose = vi.fn();
    render(<IntroTour onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Intro tour' })).toBeTruthy();
    expect(screen.getByText('Waveforms')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    expect(screen.getByText('Settings')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    expect(screen.getByText('Alarms')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    expect(screen.getByText('Patient')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    expect(screen.getByText('Consultant')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(store.get(INTRO_TOUR_KEY)).toBe('1');
  });

  it('is skippable from the first step', () => {
    const onClose = vi.fn();
    render(<IntroTour onClose={onClose} />);
    fireEvent.click(screen.getByTestId('intro-tour-skip'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(store.get(INTRO_TOUR_KEY)).toBe('1');
  });

  it('can go back a step', () => {
    render(<IntroTour onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('intro-tour-next'));
    fireEvent.click(screen.getByTestId('intro-tour-back'));
    expect(screen.getByText('Waveforms')).toBeTruthy();
  });

  it('reports seen before the flag is set and after it', () => {
    expect(introTourSeen()).toBe(false);
    store.set(INTRO_TOUR_KEY, '1');
    expect(introTourSeen()).toBe(true);
  });
});

describe('TrainerApp intro tour integration', () => {
  function renderApp() {
    const learner = createLearner(new MemoryStorage());
    render(<TrainerApp learner={learner} engine={engine} catalog={{ cases, failures: [], invalid: [] }} />);
    return learner;
  }

  it('shows the tour on the first Home visit and not again after it is dismissed', async () => {
    renderApp();
    expect(await screen.findByTestId('intro-tour')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-skip'));
    await waitFor(() => expect(screen.queryByTestId('intro-tour')).toBeNull());
    expect(store.get(INTRO_TOUR_KEY)).toBe('1');
  });

  it('does not show the tour when the flag is already set, but "Replay intro" brings it back', async () => {
    store.set(INTRO_TOUR_KEY, '1');
    renderApp();
    await waitFor(() => expect(screen.queryByTestId('intro-tour')).toBeNull(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId('replay-intro'));
    expect(await screen.findByTestId('intro-tour')).toBeTruthy();
    fireEvent.click(screen.getByTestId('intro-tour-skip'));
    await waitFor(() => expect(screen.queryByTestId('intro-tour')).toBeNull());
  });
});
