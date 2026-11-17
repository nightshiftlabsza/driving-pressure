import { describe, it, expect } from 'vitest';
import competenciesData from '../shared/competencies.json';
import { alarmsDrillItems, abgDrillItems, waveformsDrillItems, allDrillSets } from './content';
import { engine, truth } from '../engine';
import { checkAbgConsistency, classifyAbg } from './abgRules';
import { shuffleOptions } from './DrillRunner';

// Gather valid competency IDs from competencies.json
const validCompetencyIds = new Set<string>();
for (const domain of competenciesData.domains) {
  for (const comp of domain.competencies) {
    validCompetencyIds.add(comp.id);
  }
}

describe('Drill Content Validation', () => {
  it('orders drill sets as waveforms -> abg -> alarms for prerequisite progression', () => {
    expect(allDrillSets.map((s) => s.id)).toEqual(['waveforms', 'abg', 'alarms']);
    expect(waveformsDrillItems[0].competency).toBe('wave.normal');
  });

  it('has three drill sets each with at least 12 items', () => {
    expect(allDrillSets).toHaveLength(3);
    expect(alarmsDrillItems.length).toBeGreaterThanOrEqual(12);
    expect(abgDrillItems.length).toBeGreaterThanOrEqual(12);
    expect(waveformsDrillItems.length).toBeGreaterThanOrEqual(12);
  });

  describe('Alarms drill set', () => {
    it('all items reference a valid competency ID and have required fields', () => {
      for (const item of alarmsDrillItems) {
        expect(validCompetencyIds.has(item.competency), `Invalid competency: ${item.competency} in ${item.id}`).toBe(true);
        expect(item.stem.trim().length).toBeGreaterThan(10);
        expect(item.explanation.trim().length).toBeGreaterThan(10);
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.alarmReadings).toBeDefined();
        if (item.alarmReadings) {
          expect(item.alarmReadings.mode).toBeTruthy();
          expect(item.alarmReadings.alarmText).toBeTruthy();
          expect(typeof item.alarmReadings.ppeakCmH2O).toBe('number');
          expect(typeof item.alarmReadings.vteMl).toBe('number');
          expect(typeof item.alarmReadings.rrBpm).toBe('number');
          expect(typeof item.alarmReadings.spo2Pct).toBe('number');
        }
      }
    });

    it('covers all required clinical alarm scenarios', () => {
      const texts = alarmsDrillItems.map((i) => (i.stem + ' ' + i.explanation).toLowerCase());
      const allText = texts.join(' ');

      expect(allText).toContain('secretion');
      expect(allText).toContain('biting');
      expect(allText).toContain('bronchospasm');
      expect(allText).toContain('pneumothorax');
      expect(allText).toContain('mainstem');
      expect(allText).toContain('auto-peep');
      expect(allText).toContain('disconnection');
      expect(allText).toContain('cuff');
      expect(allText).toContain('apnoea');
      expect(allText).toContain('respiratory rate');
      expect(allText).toContain('niv');
    });
  });

  describe('ABG drill set', () => {
    it('all items reference a valid competency ID and have required fields', () => {
      for (const item of abgDrillItems) {
        expect(validCompetencyIds.has(item.competency), `Invalid competency: ${item.competency} in ${item.id}`).toBe(true);
        expect(item.stem.trim().length).toBeGreaterThan(10);
        expect(item.explanation.trim().length).toBeGreaterThan(10);
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.abgValues).toBeDefined();
      }
    });

    it('every ABG item passes the Henderson-Hasselbalch consistency check', () => {
      for (const item of abgDrillItems) {
        const abg = item.abgValues!;
        const consistency = checkAbgConsistency(abg);
        expect(
          consistency.consistent,
          `Item ${item.id} failed Henderson-Hasselbalch consistency: pH ${abg.ph}, calc ${consistency.calculatedPh}, diff ${consistency.diff}`
        ).toBe(true);
      }
    });

    it('every ABG item answerKey matches the abgRules classification code', () => {
      for (const item of abgDrillItems) {
        const abg = item.abgValues!;
        const classification = classifyAbg(abg);
        expect(
          item.answerKey,
          `Item ${item.id} answerKey (${item.answerKey}) must match abgRules classification (${classification.code})`
        ).toBe(classification.code);
      }
    });
  });

  describe('Waveforms drill set', () => {
    it('all items reference a valid competency ID and specify PatientParams and DeviceSettings', () => {
      for (const item of waveformsDrillItems) {
        expect(validCompetencyIds.has(item.competency), `Invalid competency: ${item.competency} in ${item.id}`).toBe(true);
        expect(item.stem.trim().length).toBeGreaterThan(10);
        expect(item.explanation.trim().length).toBeGreaterThan(10);
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.waveformConfig).toBeDefined();
        expect(item.waveformConfig?.patient).toBeDefined();
        expect(item.waveformConfig?.device).toBeDefined();
        expect(typeof item.waveformConfig?.patient.complianceMlPerCmH2O).toBe('number');
        expect(typeof item.waveformConfig?.patient.inspResistanceCmH2OPerLps).toBe('number');
        expect(item.waveformConfig?.device.device).toBe('invasive');

        const optionIds = new Set(item.options.map((o) => o.id));
        if (Array.isArray(item.answerKey)) {
          for (const key of item.answerKey) {
            expect(optionIds.has(key), `Invalid answerKey ${key} in ${item.id}`).toBe(true);
          }
        } else {
          expect(optionIds.has(item.answerKey), `Invalid answerKey ${item.answerKey} in ${item.id}`).toBe(true);
        }
      }
    });
  });
  describe('items do not give the answer away', () => {
    // Words that describe a trace. An interpretation item must make the learner read the plot instead.
    const TRACE_WORDS = /square|decelerat|scoop|concave|plateau|blip|deflection|back-to-back|fails? to return|return(s|ing)? (smoothly |completely )?to (zero|baseline)|long.*tail/i;

    it('waveform interpretation stems do not describe the trace', () => {
      for (const item of waveformsDrillItems.filter((i) => i.evidenceType === 'interpretation')) {
        expect(TRACE_WORDS.test(item.stem), `${item.id} stem describes the waveform: "${item.stem}"`).toBe(false);
      }
    });

    it('ABG stems and vignettes do not name the disorder', () => {
      for (const item of abgDrillItems) {
        const text = `${item.stem} ${item.vignette ?? ''}`.replace('What is the acid-base disorder?', '');
        expect(/acidosis|alkalosis|compensat|hypoventilat|hyperventilat/i.test(text), `${item.id} names the disorder`).toBe(false);
      }
    });

    it('the correct option is not marked out by its length', () => {
      for (const item of [...waveformsDrillItems, ...abgDrillItems, ...alarmsDrillItems]) {
        if (Array.isArray(item.answerKey)) continue;
        const key = item.options.find((o) => o.id === item.answerKey)!;
        const longestOther = Math.max(...item.options.filter((o) => o.id !== item.answerKey).map((o) => o.text.length));
        expect(key.text.length, `${item.id}: correct option is much longer than every distractor`).toBeLessThanOrEqual(longestOther * 1.6);
      }
    });

    it('option order is shuffled per run and stable within a run', () => {
      const opts = ['a', 'b', 'c', 'd'];
      expect(shuffleOptions(opts, 'run1:item')).toEqual(shuffleOptions(opts, 'run1:item'));
      const firsts = new Set(Array.from({ length: 40 }, (_, k) => shuffleOptions(opts, `run${k}:item`)[0]));
      expect(firsts.size).toBe(4);
      expect([...shuffleOptions(opts, 'x')].sort()).toEqual(opts);
    });
  });

  describe('Waveforms drill simulation', () => {
    it('every waveform item with a waveformConfig simulates with the real engine', () => {
      let simulated = 0;
      for (const item of waveformsDrillItems) {
        const cfg = item.waveformConfig;
        if (!cfg) continue;
        let result;
        try {
          result = engine.simulateBreaths(cfg.patient, cfg.device, cfg.nBreaths ?? 3);
        } catch (err) {
          throw new Error(`Waveform item ${item.id} failed to simulate: ${String(err)}`);
        }
        expect(result.samples.length, `Waveform item ${item.id} returned no samples`).toBeGreaterThan(0);
        simulated++;
      }
      expect(simulated).toBe(12);
    });

    describe('waveform items show their lesson', () => {
      const cfgOf = (id: string) => {
        const cfg = waveformsDrillItems.find((i) => i.id === id)?.waveformConfig;
        if (!cfg) throw new Error(`missing waveformConfig for ${id}`);
        return cfg;
      };
      const run = (id: string) => {
        const cfg = cfgOf(id);
        return engine.simulateBreaths(cfg.patient, cfg.device, cfg.nBreaths ?? 3);
      };
      // Paw traces of each complete inspiration in the drawn window.
      const inspCurves = (samples: { phase: string; pawCmH2O: number }[]) => {
        const out: number[][] = [];
        let cur: number[] | null = null;
        for (const s of samples) {
          if (s.phase === 'insp') {
            if (!cur) { cur = []; out.push(cur); }
            cur.push(s.pawCmH2O);
          } else cur = null;
        }
        if (samples[0]?.phase === 'insp') out.shift();
        if (samples[samples.length - 1]?.phase === 'insp') out.pop();
        return out;
      };

      it('wave-01: expiratory flow has not returned to zero and auto-PEEP is present', () => {
        const r = run('wave-01');
        const peakExp = Math.min(...r.samples.map((s) => s.flowLps));
        for (const b of r.breaths) expect(b.endExpFlowLps / peakExp).toBeGreaterThanOrEqual(0.15);
        expect(truth(r.state).autoPeep ?? 0).toBeGreaterThanOrEqual(3);
      });

      it('wave-02: at least 1 in 3 efforts fails to trigger, with at least two wasted efforts drawn', () => {
        const r = run('wave-02');
        const ineffective = r.breaths.reduce((a, b) => a + b.ineffectiveEfforts, 0);
        const triggered = r.breaths.filter((b) => b.breathType === 'assisted').length;
        expect(ineffective).toBeGreaterThanOrEqual(2);
        expect(ineffective / (ineffective + triggered)).toBeGreaterThanOrEqual(1 / 3);
      });

      it('wave-03: inspiratory pressure scoops at least 3 cmH2O below the passive breath', () => {
        const cfg = cfgOf('wave-03');
        const dev = cfg.device as { mode?: string; inspFlowLpm?: number };
        expect(dev.mode).toBe('VC-AC');
        expect(dev.inspFlowLpm).toBe(30);
        const active = run('wave-03');
        const passive = engine.simulateBreaths(
          { ...cfg.patient, spontRateBpm: 0, pmusAmplitudeCmH2O: 0 }, cfg.device, 2);
        const ref = inspCurves(passive.samples)[0];
        const curves = inspCurves(active.samples);
        expect(curves.length).toBeGreaterThanOrEqual(2);
        for (const c of curves) {
          const deficit = Math.max(...c.map((v, k) => (k < ref.length ? ref[k] - v : -Infinity)));
          expect(deficit).toBeGreaterThanOrEqual(3);
          // visible scoop: pressure falls at least 3 cmH2O below its early-inspiration value
          expect(c[1] - Math.min(...c.slice(1))).toBeGreaterThanOrEqual(3);
        }
        expect(active.breaths.every((b) => b.flowStarved)).toBe(true);
      });
    });
  });
});
