import type { EngineState } from '../shared/engineTypes';
import type { Metric } from '../shared/caseSchema';
import { truth } from './core';
import { pbwKg } from './devices';

/**
 * Pure evaluation of a named metric against an engine state.
 * Shared between the runtime (conditions, predictions) and benchmark assertions.
 */
export function metricOf(s: EngineState, m: Metric): number | null {
  const mon = s.monitored;
  const t = truth(s);
  switch (m) {
    case 'simMin': return s.simTimeSec / 60;
    case 'ph': return t.ph;
    case 'paco2': return t.paco2;
    case 'pao2': return t.pao2;
    case 'pfRatio': return t.pfRatio;
    case 'spo2': return mon.spo2Pct;
    case 'etco2': return mon.etco2MmHg;
    case 'rrTotal': return mon.rrTotalBpm;
    case 'rrSpont': return mon.rrSpontBpm;
    case 'vte': return mon.vteMl;
    case 'vteMlKgPbw': return mon.vteMl === null ? null : mon.vteMl / pbwKg(s.patient);
    case 'minuteVent': return mon.minuteVentLpm;
    case 'ppeak': return mon.ppeakCmH2O;
    case 'pplat': return t.pplat;
    case 'drivingPressure': return t.drivingPressure;
    case 'autoPeep': return t.autoPeep;
    case 'pmean': return mon.pmeanCmH2O;
    case 'peep': return mon.peepSetCmH2O;
    case 'fio2': return mon.fio2;
    case 'leak': return mon.leakLpm;
    case 'map': return mon.mapMmHg;
    case 'hr': return mon.hrBpm;
    case 'sbp': return mon.sbpMmHg;
    case 'fatigue': return t.fatigue;
    case 'hfncPressure':
    case 'hfncPaw': return mon.hfncPressureCmH2O ?? null;
    case 'p01': return mon.p01CmH2O ?? (s.lastManoeuvre?.kind === 'occlusion' ? s.lastManoeuvre.p01CmH2O ?? null : null);
    case 'deltaPocc': return mon.deltaPoccCmH2O ?? (s.lastManoeuvre?.kind === 'occlusion' ? s.lastManoeuvre.deltaPoccCmH2O ?? null : null);
    case 'plEndInsp': return mon.plEndInspCmH2O ?? null;
    case 'plEndExp': return mon.plEndExpCmH2O ?? null;
    case 'pes': return mon.pesCmH2O ?? null;
    case 'doubleTriggerCount': return typeof s.internal.doubleTriggerCount === 'number' ? s.internal.doubleTriggerCount : null;
    case 'prematureCycleCount': return typeof s.internal.prematureCycleCount === 'number' ? s.internal.prematureCycleCount : null;
    case 'delayedCycleCount': return typeof s.internal.delayedCycleCount === 'number' ? s.internal.delayedCycleCount : null;
    case 'flowStarvationCount': return typeof s.internal.flowStarvationCount === 'number' ? s.internal.flowStarvationCount : null;
    case 'autoTriggerCount': return typeof s.internal.autoTriggerCount === 'number' ? s.internal.autoTriggerCount : null;
    case 'reverseTriggerCount': return typeof s.internal.reverseTriggerCount === 'number' ? s.internal.reverseTriggerCount : null;
    // Phase 7 addition: Rapid Shallow Breathing Index (Yang & Tobin 1991, NEJM 324(21):1445-1450)
    // rsbi = spontaneous RR / VT in litres
    case 'rsbi': {
      if (mon.vteMl === null || mon.vteMl <= 0) return null;
      const spontRr = mon.rrSpontBpm > 0 ? mon.rrSpontBpm : (s.patient.spontRateBpm > 0 ? mon.rrTotalBpm : 0);
      const vtL = mon.vteMl / 1000;
      return vtL > 0 ? spontRr / vtL : null;
    }
    default: {
      if (typeof m === 'string' && m.startsWith('alarmActive:')) {
        const id = m.slice('alarmActive:'.length);
        if (id === 'ppeak-high') {
          return (Boolean(s.lastBreath?.pmaxLimited) || (mon.ppeakCmH2O !== null && mon.ppeakCmH2O >= 40)) ? 1 : 0;
        }
        if (id === 'ppeak-low') {
          return (mon.ppeakCmH2O !== null && mon.ppeakCmH2O < 10) ? 1 : 0;
        }
        if (id === 'vte-low') {
          return (mon.vteMl !== null && mon.vteMl < 200) ? 1 : 0;
        }
        if (id === 'vte-high') {
          return (mon.vteMl !== null && mon.vteMl > 800) ? 1 : 0;
        }
        if (id === 'apnoea') {
          return (mon.apnoeaBackupActive || (mon.rrTotalBpm !== null && mon.rrTotalBpm < 1)) ? 1 : 0;
        }
        if (id === 'leak-high') {
          return (mon.leakLpm !== null && mon.leakLpm > 30) ? 1 : 0;
        }
        if (id === 'peep-low') {
          return (mon.peepSetCmH2O !== null && mon.ppeakCmH2O !== null && mon.ppeakCmH2O < mon.peepSetCmH2O - 2) ? 1 : 0;
        }
        if (id === 'spo2-low') {
          return (mon.spo2Pct !== null && mon.spo2Pct < 88) ? 1 : 0;
        }
      }
      return null;
    }
  }
}
