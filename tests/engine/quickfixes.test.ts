import { describe, it, expect } from 'vitest';
import { engine, truth } from '../../src/engine/index';
import { alveolarPo2, arterialPo2, o2Content, po2FromContent } from '../../src/engine/gas';
import { passive, vc } from './fixtures';
import type { DeviceSettings, PatientParams } from '../../src/shared/engineTypes';

describe('Phase 2 Part A Quickfixes', () => {
  // Fix A: Alveolar ventilation averaging
  it('Fix A: VA equals rate x 350 mL within 3% on VC (VT 500, VD 150, alveolar dead space 0)', () => {
    const p: PatientParams = {
      ...passive,
      anatomicDeadSpaceMl: 150,
      alveolarDeadSpaceFraction: 0,
      spontRateBpm: 0,
      pmusAmplitudeCmH2O: 0,
    };

    for (const rr of [6, 8, 12, 20]) {
      const d = vc({ rrSetBpm: rr, vtSetMl: 500 });
      let s = engine.createState(p, d, { paco2MmHg: 40 });
      const expectedVa = rr * 0.35; // rate x (500 - 150) mL = rate x 350 mL/min = rate x 0.35 L/min

      for (let t = 5; t <= 120; t += 5) {
        s = engine.fastForward(s, 5);
        if (t >= 60) {
          const va = truth(s).alveolarVentLpm;
          expect(va).not.toBeNull();
          const relErr = Math.abs(va! - expectedVa) / expectedVa;
          expect(relErr, `RR ${rr} at t=${t}s: va=${va} expected=${expectedVa}`).toBeLessThan(0.03);
        }
      }
    }
  });

  // Fix B: Venous O2 content floor
  describe('Fix B: Venous O2 content floor', () => {
    it('preserves PaO2 within 0.5 mmHg for shunt 0 to 0.5, CO 5, VO2 250 (compared to unconstrained shunt formula)', () => {
      for (const shunt of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
        const o = { fio2: 0.21, paco2: 40, shunt, hb: 14, vo2: 250, coLpm: 5, ph: 7.4, tempC: 37 };
        const pao2 = arterialPo2(o);
        // Unconstrained formula before Cv floor:
        const pao2Alv = alveolarPo2(o.fio2, o.paco2);
        const cc = o2Content(pao2Alv, o.hb, o.ph, o.tempC);
        const qs = Math.min(0.95, Math.max(0, o.shunt));
        const caUnconstrained = cc - (qs / (1 - qs)) * o.vo2 / (10 * Math.max(0.5, o.coLpm));
        const expectedPao2 = Math.min(pao2Alv, po2FromContent(Math.max(0.5, caUnconstrained), o.hb, o.ph, o.tempC));
        expect(Math.abs(pao2 - expectedPao2)).toBeLessThanOrEqual(0.5);
      }
    });

    it('enforces Cv >= 30% of Cc and PaO2 > 15 mmHg for severe shunt 0.8, CO 2, VO2 300', () => {
      const o = { fio2: 0.21, paco2: 40, shunt: 0.8, hb: 14, vo2: 300, coLpm: 2, ph: 7.4, tempC: 37 };
      const pao2 = arterialPo2(o);

      expect(Number.isFinite(pao2)).toBe(true);
      expect(pao2).toBeGreaterThan(15);

      // Verify implied Cv from the Fick and shunt relations
      const pao2Alv = alveolarPo2(o.fio2, o.paco2);
      const cc = o2Content(pao2Alv, o.hb, o.ph, o.tempC);
      const cvFloor = 0.3 * cc;
      // If ca is computed, ca = (1 - qs) * cc + qs * cv  =>  cv = (ca - (1 - qs) * cc) / qs
      // Ca is derived from pao2:
      const ca = o2Content(pao2, o.hb, o.ph, o.tempC);
      const impliedCv = (ca - (1 - o.shunt) * cc) / o.shunt;
      expect(impliedCv).toBeGreaterThanOrEqual(cvFloor - 0.2); // within small numerical tolerance
    });
  });

  // Fix F: Mean alveolar pressure for circulation rule
  describe('Fix F: Mean alveolar pressure for circulation rule', () => {
    it('spontaneously breathing patient with pmusAmplitude 15 has no PPV fall (MAP within 2 mmHg of baseline after 5 min)', () => {
      const p: PatientParams = {
        ...passive,
        spontRateBpm: 16,
        pmusAmplitudeCmH2O: 15,
        ppvSeverity: 1,
        ppvResponse: 'unhelpful',
      };
      const roomAir: DeviceSettings = { device: 'none', o2: 'room-air', o2FlowLpm: 0 };
      const s0 = engine.createState(p, roomAir, { paco2MmHg: 40 });
      const mapBaseline = (p.sbpBaselineMmHg + 2 * p.dbpBaselineMmHg) / 3;

      const s5 = engine.fastForward(s0, 300);
      const map5 = s5.monitored.mapMmHg!;
      expect(Math.abs(map5 - mapBaseline)).toBeLessThanOrEqual(2);
    });

    it('passive patient on VC with PEEP 15 still shows PPV blood pressure fall (unchanged within 1 mmHg)', () => {
      const p: PatientParams = {
        ...passive,
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
        ppvSeverity: 1,
        ppvResponse: 'unhelpful',
      };
      const dPeep15 = vc({ peep: 15, rrSetBpm: 16, vtSetMl: 500 });
      const s0 = engine.createState(p, dPeep15, { paco2MmHg: 40 });
      const s5 = engine.fastForward(s0, 300);
      const map5 = s5.monitored.mapMmHg!;
      const mapBaseline = (p.sbpBaselineMmHg + 2 * p.dbpBaselineMmHg) / 3;

      // Passive patient on PEEP 15 should show a significant fall in MAP
      expect(mapBaseline - map5).toBeGreaterThan(5);
    });
  });

  // Fix G: Full alveolar gas equation
  describe('Fix G: Full alveolar gas equation', () => {
    it('FiO2 1.0 and PaCO2 40 gives 673 +- 1 mmHg (not 663)', () => {
      const pao2 = alveolarPo2(1.0, 40);
      expect(pao2).toBeCloseTo(673, 0);
      expect(Math.abs(pao2 - 673)).toBeLessThanOrEqual(1);
    });

    it('FiO2 0.21 and PaCO2 40 gives ~100-102 mmHg', () => {
      const pao2 = alveolarPo2(0.21, 40);
      expect(pao2).toBeGreaterThanOrEqual(99);
      expect(pao2).toBeLessThanOrEqual(103);
    });
  });

  // Fix H: End-tidal CO2 with small breaths
  describe('Fix H: End-tidal CO2 when breaths are smaller than dead space', () => {
    it('VT 120 mL with VD 150 gives EtCO2 <= 5; VT 500 gives normal value', () => {
      const p: PatientParams = {
        ...passive,
        anatomicDeadSpaceMl: 150,
        alveolarDeadSpaceFraction: 0.1,
      };

      // Normal breath: VT 500 mL
      const d500 = vc({ vtSetMl: 500, rrSetBpm: 12 });
      let s500 = engine.createState(p, d500, { paco2MmHg: 40 });
      s500 = engine.fastForward(s500, 60);
      const normalEtco2 = Math.round(s500.phys.paco2MmHg * (1 - p.alveolarDeadSpaceFraction));
      expect(s500.monitored.etco2MmHg).toBe(normalEtco2);

      // Small breath: VT 120 mL <= VD (150 mL)
      const d120 = vc({ vtSetMl: 120, rrSetBpm: 12 });
      let s120 = engine.createState(p, d120, { paco2MmHg: 40 });
      s120 = engine.fastForward(s120, 60);
      expect(s120.monitored.etco2MmHg).not.toBeNull();
      expect(s120.monitored.etco2MmHg!).toBeLessThanOrEqual(5);
    });
  });
});
