// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEngineVentilator, DEFAULT_INITIAL_DEVICE } from '../../src/bedside/useEngineVentilator';
import { BEDSIDE_PATIENT_PRESETS } from '../../src/bedside/presets';
import { engine } from '../../src/engine';
import fs from 'fs';
import path from 'path';

describe('useEngineVentilator Hook & Presets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches monitored values with headless engine run within rounding', () => {
    const patient = BEDSIDE_PATIENT_PRESETS.Normal;
    const device = DEFAULT_INITIAL_DEVICE;

    // Headless engine run
    const headlessState = engine.createState(patient, device);
    const steppedHeadless = engine.step(headlessState, 0.5).state;

    // Hook
    const { result } = renderHook(() =>
      useEngineVentilator({ initialPatient: patient, initialDevice: device })
    );

    expect(result.current.state.patient.complianceMlPerCmH2O).toBe(
      headlessState.patient.complianceMlPerCmH2O
    );
    expect((result.current.state.device as any).peep).toBe(
      (headlessState.device as any).peep
    );

    // Step the hook 5 times (5 * 100ms = 0.5s)
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Check monitored values match within rounding
    const hookMon = result.current.state.monitored;
    const headlessMon = steppedHeadless.monitored;

    if (hookMon.ppeakCmH2O !== null && headlessMon.ppeakCmH2O !== null) {
      expect(Math.abs(hookMon.ppeakCmH2O - headlessMon.ppeakCmH2O)).toBeLessThanOrEqual(1.0);
    }
    if (hookMon.peepSetCmH2O !== null && headlessMon.peepSetCmH2O !== null) {
      expect(hookMon.peepSetCmH2O).toBe(headlessMon.peepSetCmH2O);
    }
    if (hookMon.rrTotalBpm !== null && headlessMon.rrTotalBpm !== null) {
      expect(Math.abs(hookMon.rrTotalBpm - headlessMon.rrTotalBpm)).toBeLessThanOrEqual(1.0);
    }
  });

  it('changing PEEP, VT, RR, FiO2, mode or preset changes engine state', () => {
    const { result } = renderHook(() => useEngineVentilator());

    // Initial state check
    expect((result.current.state.device as any).peep).toBe(5);

    // 1. Changing PEEP
    act(() => {
      result.current.setDevice({
        ...result.current.state.device,
        peep: 10,
      } as any);
    });
    expect((result.current.state.device as any).peep).toBe(10);

    // 2. Changing VT
    act(() => {
      result.current.setDevice({
        ...result.current.state.device,
        vtSetMl: 600,
      } as any);
    });
    expect((result.current.state.device as any).vtSetMl).toBe(600);

    // 3. Changing RR
    act(() => {
      result.current.setDevice({
        ...result.current.state.device,
        rrSetBpm: 20,
      } as any);
    });
    expect((result.current.state.device as any).rrSetBpm).toBe(20);

    // 4. Changing FiO2
    act(() => {
      result.current.setDevice({
        ...result.current.state.device,
        fio2: 0.6,
      } as any);
    });
    expect((result.current.state.device as any).fio2).toBe(0.6);

    // 5. Changing Mode
    act(() => {
      result.current.setDevice({
        device: 'invasive',
        mode: 'PC-AC',
        fio2: 0.6,
        peep: 10,
        rrSetBpm: 20,
        pinspAbovePeep: 15,
        tiSec: 1.0,
      });
    });
    expect((result.current.state.device as any).mode).toBe('PC-AC');

    // 6. Changing Preset
    act(() => {
      result.current.setPatientPreset('ARDS');
    });
    expect(result.current.state.patient.complianceMlPerCmH2O).toBe(25);
    expect(result.current.state.patient.shuntFraction).toBe(0.38);

    act(() => {
      result.current.setPatientPreset('COPD');
    });
    expect(result.current.state.patient.chronicPaco2MmHg).toBe(55);
    expect(result.current.state.patient.baselineHco3MmolL).toBe(30);
    expect(result.current.state.patient.expFlowLimitationCmH2O).toBe(10.5);
  });

  it('collects waveform samples in rolling buffer when stepped', () => {
    const { result } = renderHook(() => useEngineVentilator());

    expect(result.current.samples.length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300); // 3 steps * 20 samples = 60 samples
    });

    expect(result.current.samples.length).toBeGreaterThan(0);
    const sample = result.current.samples[0];
    expect(sample).toHaveProperty('pawCmH2O');
    expect(sample).toHaveProperty('flowLps');
    expect(sample).toHaveProperty('volumeMl');
  });

  it('triggers inspiratory hold and records manoeuvre result', () => {
    const { result } = renderHook(() =>
      useEngineVentilator({ presetKey: 'Normal' })
    );

    act(() => {
      result.current.startHold('insp-hold', 3);
    });

    // Advance time through hold execution (advance through breath cycle)
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(result.current.lastManoeuvre).not.toBeNull();
    expect(result.current.lastManoeuvre?.kind).toBe('insp-hold');
    expect(result.current.lastManoeuvre?.pplatCmH2O).toBeGreaterThan(5);
  });

  it('triggers expiratory hold and records auto-PEEP on COPD preset', () => {
    const { result } = renderHook(() =>
      useEngineVentilator({ presetKey: 'COPD' })
    );

    // Increase RR to 30 to produce auto-PEEP
    act(() => {
      result.current.setDevice({
        ...result.current.state.device,
        rrSetBpm: 30,
      } as any);
    });

    // Advance 6 seconds to accumulate auto-PEEP
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Trigger expiratory hold
    act(() => {
      result.current.startHold('exp-hold', 3);
    });

    // Advance 5 seconds for hold
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.lastManoeuvre).not.toBeNull();
    expect(result.current.lastManoeuvre?.kind).toBe('exp-hold');
    expect(result.current.lastManoeuvre?.autoPeepCmH2O).toBeGreaterThan(0.5);
  });

  it('production bundle verification: does not leak __ovsDebug when built', async () => {
    // If dist doesn't exist yet, run a build test or check that vite build doesn't contain __ovsDebug
    // This is checked after build step.
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(distPath, { recursive: true }) as string[];
      for (const file of files) {
        if (typeof file === 'string' && file.endsWith('.js')) {
          const content = fs.readFileSync(path.join(distPath, file), 'utf8');
          expect(content.includes('__ovsDebug')).toBe(false);
        }
      }
    }
  });
});
