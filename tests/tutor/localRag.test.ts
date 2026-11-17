import { describe, it, expect } from 'vitest';
import { retrieveLocalTeachingPearls, formatRagPearls } from '../../src/tutor/localRag';
import type { PracticeItem } from '../../src/practice/types';

const SAMPLE_ITEMS: PracticeItem[] = [
  {
    id: 'item-ap-1',
    kind: 'predict-then-reveal',
    source: { file: 'ventilator-book.pdf', chapter: 'The Ventilator Book', pageStart: 12, pageEnd: 13 },
    competencyId: 'mech.auto-peep',
    difficulty: 2,
    tags: ['auto-peep', 'expiratory-hold', 'misinterpretation'],
    scenario: 'Severe asthma with expiratory flow still -12 L/min at end expiration.',
    question: 'What happens if respiratory rate is increased from 18 to 26/min?',
    correctAnswer: 'Auto-PEEP rises further because expiratory time shortens.',
    explanation: 'Shorter expiratory time traps more alveolar gas when airway resistance is high.',
  },
  {
    id: 'item-ap-2',
    kind: 'flashcard',
    source: { file: 'icuedu.pdf', chapter: 'ICUedu Waveforms', pageStart: 4, pageEnd: 5 },
    competencyId: 'mech.auto-peep',
    difficulty: 1,
    tags: ['intrinsic-peep'],
    front: 'What maneuver quantifies total end-expiratory alveolar pressure?',
    back: 'An end-expiratory hold pause measures Total PEEP (set PEEP plus intrinsic PEEP).',
  },
  {
    id: 'item-ap-3',
    kind: 'flashcard',
    source: { file: 'ventilator-book.pdf', chapter: 'The Ventilator Book', pageStart: 15, pageEnd: 16 },
    competencyId: 'mech.auto-peep',
    difficulty: 2,
    tags: ['time-constant'],
    front: 'Which three levers relieve dynamic hyperinflation?',
    back: 'Lower respiratory rate, reduce tidal volume, or increase inspiratory flow to lengthen Te.',
  },
  {
    id: 'item-ards-1',
    kind: 'predict-then-reveal',
    source: { file: 'esicm-2023.pdf', chapter: 'ESICM 2023 ARDS Guideline', pageStart: 1, pageEnd: 3 },
    competencyId: 'disease.ards',
    difficulty: 2,
    tags: ['lung-protective', 'driving-pressure'],
    scenario: 'Moderate ARDS with Pplat 32 cmH2O on VT 8 mL/kg PBW.',
    question: 'What tidal volume target is recommended?',
    correctAnswer: 'Target 4-8 mL/kg PBW keeping Pplat <= 30 cmH2O and driving pressure < 15 cmH2O.',
    explanation: 'Limiting plateau and driving pressure reduces overdistension of the aerated baby lung.',
  },
];

describe('localRag.ts — Offline BM25 Teaching Pearl Retrieval', () => {
  it('returns [] when private pack / items are missing or empty', () => {
    const res = retrieveLocalTeachingPearls({
      competencyIds: ['mech.auto-peep'],
      helpLevelCap: 2,
      isRevealStep: true,
      items: [],
    });
    expect(res).toEqual([]);
  });

  it('withholds RAG retrieval at Level 0 and Level 1 unless reveal step is active', () => {
    const lvl0 = retrieveLocalTeachingPearls({
      competencyIds: ['mech.auto-peep'],
      queryText: 'expiratory hold',
      helpLevelCap: 0,
      items: SAMPLE_ITEMS,
    });
    const lvl1 = retrieveLocalTeachingPearls({
      competencyIds: ['mech.auto-peep'],
      queryText: 'expiratory hold',
      helpLevelCap: 1,
      items: SAMPLE_ITEMS,
    });
    expect(lvl0).toEqual([]);
    expect(lvl1).toEqual([]);
  });

  it('retrieves at most 2 items matching competencyId on reveal / cap >= 2 and respects token character budget', () => {
    const pearls = retrieveLocalTeachingPearls({
      competencyIds: ['mech.auto-peep'],
      misconceptionIds: ['misinterpretation'],
      queryText: 'respiratory rate expiratory time traps gas',
      helpLevelCap: 2,
      isRevealStep: true,
      items: SAMPLE_ITEMS,
      maxChars: 400,
    });
    expect(pearls.length).toBeGreaterThan(0);
    expect(pearls.length).toBeLessThanOrEqual(2);
    expect(pearls.every(p => p.competencyId === 'mech.auto-peep')).toBe(true);
    expect(pearls[0].id).toBe('item-ap-1');
    const totalSummaryLen = pearls.reduce((sum, p) => sum + p.summary.length, 0);
    expect(totalSummaryLen).toBeLessThanOrEqual(400);

    const formatted = formatRagPearls(pearls);
    expect(formatted[0]).toContain('[mech.auto-peep | The Ventilator Book]');
  });

  it('returns [] safely without failing if no items match the requested competencyId', () => {
    const res = retrieveLocalTeachingPearls({
      competencyIds: ['circ.rv-peep'],
      queryText: 'rv afterload',
      helpLevelCap: 3,
      isRevealStep: true,
      items: SAMPLE_ITEMS,
    });
    expect(res).toEqual([]);
  });

  it('works cleanly when called against the workspace loadPracticeItems() (returns <= 2 items or [])', () => {
    const res = retrieveLocalTeachingPearls({
      competencyIds: ['mech.auto-peep'],
      queryText: 'intrinsic peep expiratory hold',
      helpLevelCap: 2,
      isRevealStep: true,
    });
    expect(res.length).toBeLessThanOrEqual(2);
  });
});
