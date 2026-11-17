// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema } from '../../src/shared/caseSchema';
import { engine } from '../../src/engine/index';
import { CaseRunner } from '../../src/app/CaseRunner';
import { VentControls } from '../../src/app/vent/VentControls';
import { MemoryEventSink } from '../../src/shared/eventSink';
import type { DeviceSettings } from '../../src/shared/engineTypes';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const loadCase = (id: string) =>
  CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/cases/library', `${id}.json`), 'utf8')));

describe('Task 7: stray label and FiO2 unit', () => {
  it('displays "Roughly FiO2 60% to 85%" with percent unit matching FiO2 ~83%', () => {
    const nrb: DeviceSettings = { device: 'none', o2: 'non-rebreather', o2FlowLpm: 15 };
    render(
      <VentControls
        active={nrb}
        canChangeDevice={true}
        canChangeSettings={true}
        allowInvasiveSwitch={false}
        onApply={() => {}}
      />
    );
    expect(screen.getByText(/Roughly FiO2 60% to 85%/)).toBeTruthy();
    expect(screen.queryByText(/Roughly FiO2 0\.6 to 0\.85/)).toBeNull();
  });

  it('does not display a lone "Alarm limits" label under the open circuit panel in pneumonia-hfnc-01', async () => {
    render(
      <CaseRunner
        caseFile={loadCase('pneumonia-hfnc-01')}
        engine={engine}
        sink={new MemoryEventSink()}
        sessionId="s"
        onFinished={() => {}}
        autoplay
      />
    );
    await screen.findByTestId('case-runner');
    const openCircuitPanel = screen.getByTestId('open-circuit-panel');
    expect(openCircuitPanel).toBeTruthy();
    // In OpenCircuitPanel or underneath it, there is no lone "Alarm limits" button
    expect(screen.queryByRole('button', { name: 'Alarm limits' })).toBeNull();
  });
});
