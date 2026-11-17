import { describe, it, expect } from 'vitest';
import {
  competencyTitle,
  mistakeTitle,
  formatSimTime,
  outcomeSentence,
  pickEndpoints,
  buildChartSeries,
  pickDecisions,
} from './story';
import type { CaseFile } from '../../shared/caseSchema';
import type { DebriefRun } from './story';
import type { MetricPoint, DecisionClassification, ReplayDecisionPoint } from '../../review/types';

describe('story helpers', () => {
  describe('competencyTitle', () => {
    it('returns human-readable title for known competency IDs', () => {
      expect(competencyTitle('mech.eom')).toBe(
        'Equation of motion: pressure = flow x resistance + volume / compliance + PEEP'
      );
      expect(competencyTitle('gas.acid-base')).toBe(
        'Interpret ABGs: primary disorder, compensation, mixed disorders'
      );
    });

    it('returns "Other clinical skill" for unknown IDs and never returns raw ID', () => {
      expect(competencyTitle('unknown.raw.id')).toBe('Other clinical skill');
      expect(competencyTitle('mech.eom')).not.toContain('mech.eom');
      expect(competencyTitle('r-vt')).toBe('Other clinical skill');
    });
  });

  describe('mistakeTitle', () => {
    it('returns known title from mistakes.json', () => {
      expect(mistakeTitle('unsafe_action')).toBe('Unsafe action');
      expect(mistakeTitle('failure_to_recognise')).toBe('Failure to recognise');
    });

    it('humanises unknown mistake IDs', () => {
      expect(mistakeTitle('custom-mistake-id')).toBe('Custom mistake id');
    });
  });

  describe('formatSimTime', () => {
    it('formats seconds into +MM:SS format', () => {
      expect(formatSimTime(0)).toBe('+00:00');
      expect(formatSimTime(45)).toBe('+00:45');
      expect(formatSimTime(90)).toBe('+01:30');
      expect(formatSimTime(3600)).toBe('+60:00');
    });
  });

  describe('outcomeSentence', () => {
    it('returns precise sentence for each known outcome', () => {
      expect(outcomeSentence('improved')).toBe('The patient improved.');
      expect(outcomeSentence('stable')).toBe('The patient was stable at the end of the case.');
      expect(outcomeSentence('deteriorated')).toBe('The patient deteriorated.');
      expect(outcomeSentence('died')).toBe('The patient died.');
      expect(outcomeSentence('escalated')).toBe('The case was escalated.');
      expect(outcomeSentence('abandoned')).toBe('The case was abandoned before it finished.');
      expect(outcomeSentence('completed')).toBe('The case was completed.');
    });

    it('returns fallback for null or unknown outcome', () => {
      expect(outcomeSentence(null)).toBe('The case is finished.');
      expect(outcomeSentence('unexpected')).toBe('The case is finished.');
    });
  });

  describe('pickEndpoints', () => {
    const baseCase = {
      id: 'test-case',
      contextTags: [],
    } as unknown as CaseFile;

    it('returns up to 4 endpoints for invasive run', () => {
      const metrics: MetricPoint[] = [
        {
          simTimeSec: 60,
          pplat: 28,
          drivingPressure: 14,
          vteMlKgPbw: 6.0,
          spo2: 94,
          paco2: 42,
          ph: 7.36,
          pao2: 80,
          ppeak: 35,
          peep: 10,
          vte: 420,
          fio2: 0.5,
          map: 75,
          hr: 85,
          rrTotal: 20,
          pfRatio: 160,
        },
      ];

      const endpoints = pickEndpoints(baseCase, metrics);
      expect(endpoints.length).toBeLessThanOrEqual(4);
      expect(endpoints.map(e => e.label)).toEqual(['Pplat', 'Driving pressure', 'Vt', 'SpO2']);
      expect(endpoints[0]).toEqual({ label: 'Pplat', unit: 'cmH2O', value: '28' });
      expect(endpoints[1]).toEqual({ label: 'Driving pressure', unit: 'cmH2O', value: '14' });
      expect(endpoints[2]).toEqual({ label: 'Vt', unit: 'mL/kg PBW', value: '6.0' });
      expect(endpoints[3]).toEqual({ label: 'SpO2', unit: '%', value: '94' });
    });

    it('returns non-invasive endpoints when pplat and drivingPressure are absent', () => {
      const metrics: MetricPoint[] = [
        {
          simTimeSec: 60,
          pplat: null,
          drivingPressure: null,
          vteMlKgPbw: null,
          spo2: 92,
          paco2: 55,
          ph: 7.31,
          pao2: 70,
          ppeak: null,
          peep: null,
          vte: null,
          fio2: 0.28,
          map: 80,
          hr: 90,
          rrTotal: 24,
          pfRatio: null,
        },
      ];

      const endpoints = pickEndpoints(baseCase, metrics);
      expect(endpoints.length).toBeLessThanOrEqual(4);
      expect(endpoints.map(e => e.label)).toEqual(['SpO2', 'PaCO2', 'pH']);
      expect(endpoints[0]).toEqual({ label: 'SpO2', unit: '%', value: '92' });
      expect(endpoints[1]).toEqual({ label: 'PaCO2', unit: 'mmHg', value: '55' });
      expect(endpoints[2]).toEqual({ label: 'pH', unit: '', value: '7.31' });
    });

    it('includes P:F ratio when contextTags contains ards', () => {
      const ardsCase = {
        id: 'ards-case',
        contextTags: ['ards'],
      } as unknown as CaseFile;

      const metrics: MetricPoint[] = [
        {
          simTimeSec: 60,
          pplat: 26,
          drivingPressure: 12,
          vteMlKgPbw: null,
          spo2: 90,
          paco2: 45,
          ph: 7.35,
          pao2: 65,
          ppeak: 32,
          peep: 14,
          vte: 400,
          fio2: 0.7,
          map: 70,
          hr: 95,
          rrTotal: 22,
          pfRatio: 93,
        },
      ];

      const endpoints = pickEndpoints(ardsCase, metrics);
      expect(endpoints.some(e => e.label === 'P:F')).toBe(true);
      expect(endpoints.find(e => e.label === 'P:F')?.value).toBe('93');
    });
  });

  describe('buildChartSeries', () => {
    const ardsCase = {
      id: 'ards-case',
      contextTags: ['ards'],
    } as unknown as CaseFile;

    const nonArdsCase = {
      id: 'copd-case',
      contextTags: ['copd', 'obstructive'],
    } as unknown as CaseFile;

    it('includes SpO2 band only when case has ards tag', () => {
      const metrics: MetricPoint[] = [
        { simTimeSec: 0, spo2: 90, pplat: 25, drivingPressure: 12, paco2: 45, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
        { simTimeSec: 60, spo2: 92, pplat: 26, drivingPressure: 13, paco2: 46, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
      ];

      const ardsSeries = buildChartSeries(ardsCase, metrics);
      const spo2Ards = ardsSeries.find(s => s.key === 'spo2');
      expect(spo2Ards?.band).toEqual({
        lo: 88,
        hi: 95,
        label: 'Target 88-95% (ARDSNet)',
      });

      const nonArdsSeries = buildChartSeries(nonArdsCase, metrics);
      const spo2NonArds = nonArdsSeries.find(s => s.key === 'spo2');
      expect(spo2NonArds?.band).toBeUndefined();
    });

    it('includes pressure bands only on invasive runs and not on non-invasive runs', () => {
      const invasiveMetrics: MetricPoint[] = [
        { simTimeSec: 0, spo2: 92, pplat: 25, drivingPressure: 12, paco2: 45, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
        { simTimeSec: 60, spo2: 94, pplat: 27, drivingPressure: 14, paco2: 44, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
      ];

      const invSeries = buildChartSeries(nonArdsCase, invasiveMetrics);
      const pplatSeries = invSeries.find(s => s.key === 'pplat');
      const dpSeries = invSeries.find(s => s.key === 'drivingPressure');
      expect(pplatSeries?.band).toEqual({ lo: null, hi: 30, label: 'Target at or below 30' });
      expect(dpSeries?.band).toEqual({ lo: null, hi: 15, label: 'Target at or below 15' });

      // Non-invasive metrics: pplat and drivingPressure null
      const nonInvasiveMetrics: MetricPoint[] = [
        { simTimeSec: 0, spo2: 89, pplat: null, drivingPressure: null, paco2: 58, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
        { simTimeSec: 60, spo2: 91, pplat: null, drivingPressure: null, paco2: 54, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
      ];

      const nonInvSeries = buildChartSeries(nonArdsCase, nonInvasiveMetrics);
      expect(nonInvSeries.find(s => s.key === 'pplat')).toBeUndefined();
      expect(nonInvSeries.find(s => s.key === 'drivingPressure')).toBeUndefined();
      const paco2Series = nonInvSeries.find(s => s.key === 'paco2');
      expect(paco2Series?.band).toBeUndefined();
    });

    it('never places a band on PaCO2', () => {
      const metrics: MetricPoint[] = [
        { simTimeSec: 0, spo2: 90, pplat: 25, drivingPressure: 12, paco2: 45, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
        { simTimeSec: 60, spo2: 92, pplat: 26, drivingPressure: 13, paco2: 46, pao2: null, ph: null, ppeak: null, peep: null, vte: null, vteMlKgPbw: null, fio2: null, map: null, hr: null, rrTotal: null, pfRatio: null },
      ];
      const series = buildChartSeries(ardsCase, metrics);
      const paco2 = series.find(s => s.key === 'paco2');
      expect(paco2).toBeDefined();
      expect(paco2?.band).toBeUndefined();
    });
  });

  describe('pickDecisions', () => {
    const caseFile = {
      id: 'test-case',
      contextTags: [],
      rubric: [
        { id: 'rub-1', description: 'Initial blood gas', critical: true, competency: 'gas.acid-base' },
        { id: 'rub-2', description: 'Set protective VT', critical: true, competency: 'disease.ards' },
        { id: 'rub-3', description: 'Titrate PEEP', critical: true, competency: 'modes.peep-fio2' },
        { id: 'rub-4', description: 'Suction airway', critical: false, competency: 'airway.suction' },
      ],
    } as unknown as CaseFile;

    const createRun = (partial: Partial<DebriefRun>): DebriefRun => ({
      runId: 'r1',
      activity: 'case',
      activityId: 'test-case',
      startedAt: '2026-11-01T00:00:00Z',
      endedAt: '2026-11-01T00:30:00Z',
      outcome: 'deteriorated',
      score: 5,
      maxScore: 10,
      predictions: [],
      ordersTimeline: [],
      rubric: [],
      mistakes: [],
      ...partial,
    });

    it('returns at most 3 decisions even when more candidates exist', () => {
      const run = createRun({
        rubric: [
          { rubricId: 'rub-1', met: false, critical: true, competency: 'gas.acid-base' },
          { rubricId: 'rub-2', met: false, critical: true, competency: 'disease.ards' },
          { rubricId: 'rub-3', met: false, critical: true, competency: 'modes.peep-fio2' },
        ],
        mistakes: [
          { mistake: 'unsafe_action', severity: 'critical', competency: 'safety.airway', detail: 'Pressure too high' },
          { mistake: 'delayed_action', severity: 'major', competency: 'monitoring.gas', detail: 'Delayed gas' },
        ],
      });

      const classifications = [
        {
          decisionIndex: 0,
          decision: { simTimeSec: 60, kind: 'order', order: 'abg' },
          processClass: 'unsafe',
          ruleExplanation: 'High risk maneuver',
          response: { summary: 'Patient deteriorated' },
        },
        {
          decisionIndex: 1,
          decision: { simTimeSec: 120, kind: 'settings_change' },
          processClass: 'wrong-target',
          ruleExplanation: 'Targeted wrong variable',
          response: { summary: 'No change' },
        },
      ] as unknown as DecisionClassification[];

      const replayDecisions = [
        { index: 0, simTimeSec: 60, kind: 'order' },
        { index: 1, simTimeSec: 120, kind: 'settings_change' },
      ] as unknown as ReplayDecisionPoint[];

      const decisions = pickDecisions(run, caseFile, classifications, replayDecisions, 3);
      expect(decisions.length).toBeLessThanOrEqual(3);
      expect(decisions.length).toBe(3);
    });

    it('prioritises unsafe action and links replay decision point', () => {
      const run = createRun({});
      const replayPt = { index: 0, simTimeSec: 60, kind: 'order' } as unknown as ReplayDecisionPoint;

      const classifications = [
        {
          decisionIndex: 0,
          decision: { simTimeSec: 60, kind: 'order', order: 'abg' },
          processClass: 'unsafe',
          ruleExplanation: 'Unsafe intervention',
          response: { summary: 'Severe desaturation occurred' },
        },
      ] as unknown as DecisionClassification[];

      const decisions = pickDecisions(run, caseFile, classifications, [replayPt]);
      expect(decisions.length).toBe(1);
      expect(decisions[0].tone).toBe('bad');
      expect(decisions[0].title).toContain('an unsafe action');
      expect(decisions[0].point).toBe(replayPt);
      expect(decisions[0].why).toBe('Unsafe intervention');
    });

    it('returns empty array when there are no standout decisions', () => {
      const emptyRun = createRun({ outcome: 'completed' });
      const decisions = pickDecisions(emptyRun, caseFile, [], []);
      expect(decisions).toEqual([]);
    });

    it('deduplicates items sharing the same bad competency', () => {
      const run = createRun({
        outcome: 'stable',
        rubric: [
          { rubricId: 'rub-1', met: false, critical: true, competency: 'gas.acid-base' },
        ],
        mistakes: [
          { mistake: 'unsafe_action', severity: 'critical', competency: 'gas.acid-base', detail: 'Acid base mistake' },
        ],
      });

      const decisions = pickDecisions(run, caseFile, [], []);
      // Should pick only one for 'gas.acid-base'
      expect(decisions.length).toBe(1);
    });

    it('describes what changed against starting settings (Vt 650 to 400 without Flow pattern)', () => {
      const run = createRun({});
      const testCase = {
        ...caseFile,
        initialDevice: {
          device: 'invasive',
          mode: 'VC-AC',
          fio2: 0.7,
          peep: 5,
          rrSetBpm: 16,
          vtSetMl: 650,
          inspFlowLpm: 60,
          flowPattern: 'square',
        },
      } as unknown as CaseFile;

      const classifications = [
        {
          decisionIndex: 0,
          decision: {
            simTimeSec: 60,
            kind: 'settings_change',
            settings: {
              device: 'invasive',
              mode: 'VC-AC',
              fio2: 0.7,
              peep: 5,
              rrSetBpm: 16,
              vtSetMl: 400,
              inspFlowLpm: 60,
              flowPattern: 'square',
            },
          },
          processClass: 'unsafe',
          ruleExplanation: 'Changed settings',
          response: { summary: 'Settings changed' },
        },
      ] as unknown as DecisionClassification[];

      const decisions = pickDecisions(run, testCase, classifications, []);
      expect(decisions.length).toBe(1);
      expect(decisions[0].did).toContain('Vt');
      expect(decisions[0].did).toContain('400');
      expect(decisions[0].did).not.toContain('Flow pattern');
    });
  });
});
