import { useState, useEffect, useRef, useCallback } from 'react';
import { engine } from '../engine';
import type {
  DeviceSettings,
  EngineState,
  PatientParams,
  WaveformSample,
  BreathSummary,
  ManoeuvreResult,
} from '../shared/engineTypes';
import { BEDSIDE_PATIENT_PRESETS } from './presets';
import type {
  EngineVentilatorHook,
  PatientPresetKey,
  UseEngineVentilatorOptions,
} from './types';

const ROLLING_BUFFER_DURATION_SEC = 15;
const STEP_DT_SEC = 0.04;
const INTERVAL_MS = 40;

export const DEFAULT_INITIAL_DEVICE: DeviceSettings = {
  device: 'invasive',
  mode: 'VC-AC',
  fio2: 0.4,
  peep: 5,
  rrSetBpm: 12,
  vtSetMl: 450,
  inspFlowLpm: 50,
  flowPattern: 'square',
};

export function useEngineVentilator(
  options?: UseEngineVentilatorOptions
): EngineVentilatorHook {
  const initialPatient =
    options?.initialPatient ??
    (options?.presetKey
      ? BEDSIDE_PATIENT_PRESETS[options.presetKey]
      : BEDSIDE_PATIENT_PRESETS.Normal);

  const initialDevice = options?.initialDevice ?? DEFAULT_INITIAL_DEVICE;

  // Initialize engine state
  const [engineState, setEngineState] = useState<EngineState>(() =>
    engine.createState(initialPatient, initialDevice)
  );

  const [samples, setSamples] = useState<WaveformSample[]>([]);
  const [lastBreath, setLastBreath] = useState<BreathSummary | null>(null);
  const [lastManoeuvre, setLastManoeuvre] = useState<ManoeuvreResult | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(options?.isPaused ?? false);

  const lastManoeuvreRef = useRef<ManoeuvreResult | null>(null);
  const stateRef = useRef<EngineState>(engineState);
  stateRef.current = engineState;

  const isPausedRef = useRef<boolean>(isPaused);
  isPausedRef.current = isPaused;

  // Real-time stepping loop
  useEffect(() => {
    const timer = setInterval(() => {
      if (isPausedRef.current) return;

      const res = engine.step(stateRef.current, STEP_DT_SEC);
      if (res.manoeuvre) {
        lastManoeuvreRef.current = res.manoeuvre;
        setLastManoeuvre(res.manoeuvre);
      }
      if (lastManoeuvreRef.current) {
        res.state.lastManoeuvre = lastManoeuvreRef.current;
      }

      stateRef.current = res.state;
      setEngineState(res.state);

      if (res.breaths && res.breaths.length > 0) {
        setLastBreath(res.breaths[res.breaths.length - 1]);
      } else if (res.state.lastBreath) {
        setLastBreath(res.state.lastBreath);
      }

      if (res.samples && res.samples.length > 0) {
        setSamples((prev) => {
          const combined = [...prev, ...res.samples];
          const cutoff = res.state.simTimeSec - ROLLING_BUFFER_DURATION_SEC;
          // Keep only samples within the rolling window
          const startIndex = combined.findIndex((s) => s.tSec >= cutoff);
          return startIndex > 0 ? combined.slice(startIndex) : combined;
        });
      }
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setIsPaused(paused);
  }, []);

  const appendSamples = useCallback((incoming: WaveformSample[], currentSimSec: number) => {
    if (!incoming || incoming.length === 0) return;
    setSamples((prev) => {
      const combined = [...prev, ...incoming];
      const cutoff = currentSimSec - ROLLING_BUFFER_DURATION_SEC;
      const startIndex = combined.findIndex((s) => s.tSec >= cutoff);
      return startIndex > 0 ? combined.slice(startIndex) : combined;
    });
  }, []);

  const setDevice = useCallback((device: DeviceSettings) => {
    const devObj = device as Partial<DeviceSettings>;
    const fullDevice = (devObj.device
      ? device
      : { ...stateRef.current.device, ...devObj }) as DeviceSettings;
    let nextState = engine.setDevice(stateRef.current, fullDevice);
    const rr = 'rrSetBpm' in fullDevice ? (fullDevice.rrSetBpm ?? 12) : 12;
    const breathDuration = Math.min(5, Math.max(2, 60 / rr));
    const collected: WaveformSample[] = [];
    for (let t = 0; t < breathDuration; t += STEP_DT_SEC) {
      const stepRes = engine.step(nextState, STEP_DT_SEC);
      nextState = stepRes.state;
      if (stepRes.samples && stepRes.samples.length > 0) {
        collected.push(...stepRes.samples);
      }
      if (stepRes.breaths && stepRes.breaths.length > 0) {
        setLastBreath(stepRes.breaths[stepRes.breaths.length - 1]);
      }
      if (stepRes.manoeuvre) {
        lastManoeuvreRef.current = stepRes.manoeuvre;
        setLastManoeuvre(stepRes.manoeuvre);
      }
    }
    if (lastManoeuvreRef.current) {
      nextState.lastManoeuvre = lastManoeuvreRef.current;
    }
    stateRef.current = nextState;
    setEngineState(nextState);
    appendSamples(collected, nextState.simTimeSec);
  }, [appendSamples]);

  const setPatientPreset = useCallback((presetKey: PatientPresetKey) => {
    const preset = BEDSIDE_PATIENT_PRESETS[presetKey];
    if (!preset) return;
    let nextState = engine.setPatient(stateRef.current, preset);
    const rr = 'rrSetBpm' in nextState.device ? (nextState.device.rrSetBpm ?? 12) : 12;
    const breathDuration = Math.min(5, Math.max(2, 60 / rr));
    const totalDuration = 4 * breathDuration;
    const collected: WaveformSample[] = [];
    for (let t = 0; t < totalDuration; t += STEP_DT_SEC) {
      const stepRes = engine.step(nextState, STEP_DT_SEC);
      nextState = stepRes.state;
      if (stepRes.samples && stepRes.samples.length > 0) {
        collected.push(...stepRes.samples);
      }
      if (stepRes.breaths && stepRes.breaths.length > 0) {
        setLastBreath(stepRes.breaths[stepRes.breaths.length - 1]);
      }
      if (stepRes.manoeuvre) {
        lastManoeuvreRef.current = stepRes.manoeuvre;
        setLastManoeuvre(stepRes.manoeuvre);
      }
    }
    if (lastManoeuvreRef.current) {
      nextState.lastManoeuvre = lastManoeuvreRef.current;
    }
    stateRef.current = nextState;
    setEngineState(nextState);
    appendSamples(collected, nextState.simTimeSec);
  }, [appendSamples]);

  const setPatient = useCallback((patch: Partial<PatientParams>) => {
    let nextState = engine.setPatient(stateRef.current, patch);
    const rr = 'rrSetBpm' in nextState.device ? (nextState.device.rrSetBpm ?? 12) : 12;
    const breathDuration = Math.min(5, Math.max(2, 60 / rr));
    const collected: WaveformSample[] = [];
    for (let t = 0; t < breathDuration; t += STEP_DT_SEC) {
      const stepRes = engine.step(nextState, STEP_DT_SEC);
      nextState = stepRes.state;
      if (stepRes.samples && stepRes.samples.length > 0) {
        collected.push(...stepRes.samples);
      }
      if (stepRes.breaths && stepRes.breaths.length > 0) {
        setLastBreath(stepRes.breaths[stepRes.breaths.length - 1]);
      }
      if (stepRes.manoeuvre) {
        lastManoeuvreRef.current = stepRes.manoeuvre;
        setLastManoeuvre(stepRes.manoeuvre);
      }
    }
    if (lastManoeuvreRef.current) {
      nextState.lastManoeuvre = lastManoeuvreRef.current;
    }
    stateRef.current = nextState;
    setEngineState(nextState);
    appendSamples(collected, nextState.simTimeSec);
  }, [appendSamples]);

  const startHold = useCallback(
    (kind: 'insp-hold' | 'exp-hold', durationSec?: number) => {
      const maxSec = durationSec ?? (kind === 'exp-hold' ? 0.8 : 2.0);
      const nextState = engine.startManoeuvre(stateRef.current, {
        kind,
        maxSec,
      });
      if (lastManoeuvreRef.current) {
        nextState.lastManoeuvre = lastManoeuvreRef.current;
      }
      stateRef.current = nextState;
      setEngineState(nextState);
    },
    []
  );

  const reset = useCallback(() => {
    const nextState = engine.createState(initialPatient, initialDevice);
    stateRef.current = nextState;
    setEngineState(nextState);
    setSamples([]);
    setLastBreath(null);
    setLastManoeuvre(null);
  }, [initialPatient, initialDevice]);

  // Debug hook for E2E tests only
  useEffect(() => {
    if (import.meta.env.VITE_E2E === 'true') {
      if (typeof window !== 'undefined') {
        (window as any).__ovsDebug = {
          getState: () => stateRef.current,
          setPatient,
          setDevice,
          startHold,
        };
      }
    }
  }, [setPatient, setDevice, startHold]);

  return {
    state: engineState,
    samples,
    lastBreath,
    lastManoeuvre,
    isPaused,
    togglePause,
    setPaused,
    setDevice,
    setPatientPreset,
    setPatient,
    startHold,
    reset,
  };
}
