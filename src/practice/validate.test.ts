import { describe, it, expect } from 'vitest';
import { validatePracticeItem, validatePracticePack } from './validate';
import { loadPracticeItems, hasPracticePack } from './index';
import type { PredictThenRevealItem, CaseDrillItem, FlashcardItem } from './types';

describe('Practice Item Validation', () => {
  it('loads practice items with foundational Ventilator Book mechanics first rather than advanced haemodynamics', () => {
    if (!hasPracticePack()) return;
    const items = loadPracticeItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source.file).toBe('The Ventilator Book -3rd edition.pdf');
    expect(items[0].source.chapter).toMatch(/Philosophy|Chapter 1|Chapter 2/);
  });

  it('validates a correct predict-then-reveal item', () => {
    const item: PredictThenRevealItem = {
      id: 'ptr-01',
      kind: 'predict-then-reveal',
      source: {
        file: 'The Ventilator Book -3rd edition.pdf',
        chapter: 'Chapter 1: Initial Settings',
        pageStart: 13,
        pageEnd: 15,
      },
      competencyId: 'modes.vc-vs-pc',
      difficulty: 2,
      tags: ['modes', 'vc'],
      scenario: 'A 70 kg PBW patient is ventilated in VC-AC with set VT 450 mL. Lung compliance drops from 50 to 25 mL/cmH2O.',
      question: 'What happens to the delivered tidal volume and peak inspiratory pressure?',
      options: [
        'Delivered VT drops by 50%, PIP stays constant',
        'Delivered VT stays 450 mL, PIP rises significantly',
        'Delivered VT drops, PIP drops',
      ],
      correctAnswer: 'Delivered VT stays 450 mL, PIP rises significantly',
      explanation: 'In volume-control (VC-AC), the set tidal volume is guaranteed breath-by-breath (unless Pmax is breached). When compliance falls, driving pressure and PIP must rise to deliver the same volume.',
      simulatorCheckLink: {
        type: 'case',
        id: 'ards-vent-01',
        label: 'Explore in ARDS case',
      },
    };

    const res = validatePracticeItem(item);
    expect(res.success).toBe(true);
  });

  it('validates a correct case drill item', () => {
    const item: CaseDrillItem = {
      id: 'drill-01',
      kind: 'case-drill',
      source: {
        file: 'vents101.pdf',
        chapter: 'Part IV: High Peak Pressure Troubleshooting',
        pageStart: 84,
        pageEnd: 88,
      },
      competencyId: 'safety.crisis',
      difficulty: 2,
      tags: ['alarms', 'troubleshooting'],
      vignette: 'An intubated patient suddenly triggers a high peak pressure alarm. Monitored PIP is 48 cmH2O.',
      steps: [
        {
          stepNumber: 1,
          prompt: 'What is your immediate diagnostic action on the ventilator?',
          options: [
            {
              text: 'Perform an inspiratory pause to measure plateau pressure',
              isCorrect: true,
              feedback: 'Correct: Checking Pplat separates resistive (high PIP, normal Pplat) from compliance (high PIP, high Pplat) problems.',
            },
            {
              text: 'Immediately increase the high pressure alarm limit to 60',
              isCorrect: false,
              feedback: 'Incorrect: Silencing or raising alarms without diagnosing the cause risks barotrauma or asphyxiation.',
            },
          ],
        },
      ],
    };

    const res = validatePracticeItem(item);
    expect(res.success).toBe(true);
  });

  it('validates a correct flashcard item', () => {
    const item: FlashcardItem = {
      id: 'card-01',
      kind: 'flashcard',
      source: {
        file: 'The Ventilator Book -3rd edition.pdf',
        chapter: 'Chapter 22: Liberation from Mechanical Ventilation',
        pageStart: 212,
        pageEnd: 215,
      },
      competencyId: 'safety.liberation',
      difficulty: 1,
      tags: ['liberation', 'rsbi'],
      front: 'What is the formula and passing threshold for the Rapid Shallow Breathing Index (RSBI)?',
      back: 'RSBI = f / VT (spontaneous RR divided by VT in litres). A value < 105 breaths/min/L indicates high likelihood of successful extubation.',
      subheading: 'Liberation threshold',
    };

    const res = validatePracticeItem(item);
    expect(res.success).toBe(true);
  });

  it('rejects items with invalid competencyId', () => {
    const item = {
      id: 'bad-comp',
      kind: 'flashcard',
      source: { file: 'a.pdf', chapter: 'b', pageStart: 1, pageEnd: 2 },
      competencyId: 'nonexistent.competency',
      difficulty: 1,
      tags: [],
      front: 'Test front',
      back: 'Test back',
    };

    const res = validatePracticeItem(item);
    expect(res.success).toBe(false);
  });

  it('rejects items with invalid page ranges (pageEnd < pageStart)', () => {
    const item = {
      id: 'bad-page',
      kind: 'flashcard',
      source: { file: 'a.pdf', chapter: 'b', pageStart: 10, pageEnd: 5 },
      competencyId: 'mech.eom',
      difficulty: 1,
      tags: [],
      front: 'Test front',
      back: 'Test back',
    };

    const res = validatePracticeItem(item);
    expect(res.success).toBe(false);
  });

  it('detects duplicate IDs across a pack', () => {
    const pack = [
      {
        id: 'dup-1',
        kind: 'flashcard',
        source: { file: 'a.pdf', chapter: 'b', pageStart: 1, pageEnd: 2 },
        competencyId: 'mech.eom',
        difficulty: 1,
        tags: [],
        front: 'Front 1',
        back: 'Back 1',
      },
      {
        id: 'dup-1',
        kind: 'flashcard',
        source: { file: 'a.pdf', chapter: 'b', pageStart: 1, pageEnd: 2 },
        competencyId: 'mech.eom',
        difficulty: 1,
        tags: [],
        front: 'Front 2',
        back: 'Back 2',
      },
    ];

    const result = validatePracticePack(pack);
    expect(result.validCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Duplicate item id');
  });
});
