import type { EngineApi, EngineState } from '../shared/engineTypes';
import { TREND_WINDOW_SEC, type VitalSample } from './OpenCircuitPanel';

/**
 * Wraps the engine so the monitored vital signs are copied into `history` as the simulation runs (real-time
 * ticks, +5/15/30 min skips and Observe all go through the engine). Nothing is computed here: values are the
 * engine's own. The array is changed in place and keeps about 30 simulated minutes.
 */
export function withVitalsRecording(engine: EngineApi, history: VitalSample[], everySec = 10): EngineApi {
  const record = (state: EngineState): EngineState => {
    const m = state.monitored;
    if (m) {
      const last = history[history.length - 1];
      if (last && m.simTimeSec < last.t) history.length = 0; // a new run started
      const prev = history[history.length - 1];
      if (!prev || m.simTimeSec - prev.t >= everySec) {
        history.push({ t: m.simTimeSec, spo2: m.spo2Pct, rr: m.rrTotalBpm, hr: m.hrBpm, sbp: m.sbpMmHg, dbp: m.dbpMmHg });
        let drop = 0;
        while (drop < history.length && history[drop]!.t < m.simTimeSec - TREND_WINDOW_SEC - everySec) drop++;
        if (drop) history.splice(0, drop);
      }
    }
    return state;
  };
  return {
    createState: (...a) => record(engine.createState(...a)),
    step: (state, dt) => { const r = engine.step(state, dt); record(r.state); return r; },
    fastForward: (state, sec) => record(engine.fastForward(state, sec)),
    setDevice: (state, d) => engine.setDevice(state, d),
    setPatient: (state, p) => engine.setPatient(state, p),
    startManoeuvre: (state, mn) => engine.startManoeuvre(state, mn),
    drawAbg: state => engine.drawAbg(state),
    simulateBreaths: (...a) => engine.simulateBreaths(...a),
  };
}
