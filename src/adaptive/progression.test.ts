import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseSchema, type CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import type { CompetencyState, Recommendation } from '../shared/learnerApi';
import { defaultPathway, evaluateLevelUnlock } from '../pathway/unlock';
import { rankCasesUnified } from './progression';
import { mergeVariant, type CaseVariantMetadata } from '../cases/variants/loader';

function loadLibCase(id: string): CaseFile {
  return CaseSchema.parse(JSON.parse(readFileSync(join(__dirname, '../cases/library', `${id}.json`), 'utf8')));
}

function loadVariant(filename: string, base: CaseFile): { file: CaseFile; meta: CaseVariantMetadata } {
  const meta = JSON.parse(readFileSync(join(__dirname, '../cases/variants', filename), 'utf8')) as CaseVariantMetadata;
  return { file: mergeVariant(base, meta), meta };
}

function makeState(competency: string, status: CompetencyState['status']): CompetencyState {
  return {
    competency,
    status,
    guidance: status === 'independent' || status === 'mastered' ? 'independent' : 'guided',
    guidanceOverride: null,
    dueAt: null,
    intervalDays: null,
    evidenceCount: 3,
    correctCount: 3,
    contextsCorrect: [],
    lastEvidenceAt: null,
    calibration: {
      byConfidence: {
        guess: { answered: 0, correct: 0 },
        fairly_sure: { answered: 0, correct: 0 },
        certain: { answered: 0, correct: 0 },
      },
    },
    topMistakes: [],
  };
}

describe('Unified Pathway + Entrustment Progression Rule (src/adaptive/progression.ts)', () => {
  it('routes Tier 1 Indirect entrustment into Level 4 unlock and blocks Level 4 when Tier 1 has critical safety errors', () => {
    const partialL3States = [makeState('niv.selection', 'independent')]; // only 1/3 L3 competencies

    const indirectTier1Events: LearnerEvent[] = [
      { v: 1, id: 's1', wallTime: '2026-11-01T10:00:00Z', sessionId: 's', runId: 'r1', activity: 'case', activityId: 'copd-niv-01', type: 'run_start', guidanceByCompetency: { 'niv.selection': 'prompted' } },
      { v: 1, id: 'e1', wallTime: '2026-11-01T10:20:00Z', sessionId: 's', runId: 'r1', type: 'run_end', outcome: 'improved' },
      { v: 1, id: 's2', wallTime: '2026-11-02T10:00:00Z', sessionId: 's', runId: 'r2', activity: 'case', activityId: 'apo-cpap-01', type: 'run_start', guidanceByCompetency: { 'niv.selection': 'independent' } },
      { v: 1, id: 'e2', wallTime: '2026-11-02T10:20:00Z', sessionId: 's', runId: 'r2', type: 'run_end', outcome: 'improved' },
    ];

    const unlocked = evaluateLevelUnlock(4, partialL3States, false, defaultPathway, indirectTier1Events);
    expect(unlocked.unlocked).toBe(true);
    expect(unlocked.reason).toContain('Tier 1 clinical entrustment');

    const criticalEvents: LearnerEvent[] = [
      ...indirectTier1Events,
      {
        v: 1,
        id: 'm-crit',
        wallTime: '2026-11-03T10:10:00Z',
        sessionId: 's',
        runId: 'r3',
        activity: 'case',
        activityId: 'copd-niv-01',
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'niv.selection',
        severity: 'critical',
        detail: 'Harmful unmanaged deterioration',
      },
    ];

    const blocked = evaluateLevelUnlock(4, partialL3States, false, defaultPathway, criticalEvents);
    expect(blocked.unlocked).toBe(false);
    expect(blocked.reason).toContain('critical safety mistakes');
  });

  it('unifies case recommendations: promotes due disguised re-test variants and otherwise aligns base cases with target Tier', () => {
    const ards = loadLibCase('ards-vent-01');
    const copd = loadLibCase('copd-niv-01');
    const ventCrisis = loadLibCase('vent-high-pressure-01');
    const variant = loadVariant('ards-vent-01--pbw-short-female.json', ards);

    const baseCases = [ventCrisis, ards, copd];
    const allCases = [...baseCases, variant.file];
    const variantsMeta = { [variant.meta.variantId]: variant.meta };

    const flatLearnerRecs: Recommendation[] = [
      { id: ventCrisis.id, score: 0.65, reasons: ['Novel context'] },
      { id: copd.id, score: 0.64, reasons: ['Core airway & NIV practice'] },
      { id: ards.id, score: 0.6, reasons: [] },
    ];

    // New learner (Tier 1 Observed): Tier 1 base case (copd-niv-01) wins over Tier 3 crisis despite 0.01 lower base score
    const freshRank = rankCasesUnified({
      cases: allCases,
      events: [],
      learnerRecommendations: flatLearnerRecs,
      variantsMeta,
    });
    expect(freshRank.targetTier).toBe(1);
    expect(freshRank.topCase?.caseFile.id).toBe('copd-niv-01');
    expect(freshRank.rankedRecommendations[0]!.id).toBe('copd-niv-01');

    // Learner with overdue Box 1 mistake on disease.ards -> disguised variant promoted cleanly without revealing PBW
    const mistakeEvents: LearnerEvent[] = [
      { v: 1, id: 's1', wallTime: '2026-11-01T10:00:00Z', sessionId: 's', runId: 'r1', activity: 'case', activityId: 'ards-vent-01', type: 'run_start', guidanceByCompetency: {} },
      { v: 1, id: 'm1', wallTime: '2026-11-01T10:10:00Z', sessionId: 's', runId: 'r1', activity: 'case', activityId: 'ards-vent-01', type: 'mistake', mistake: 'knowledge_gap', competency: 'disease.ards', severity: 'major', detail: 'Excessive Vt' },
      { v: 1, id: 'e1', wallTime: '2026-11-01T10:30:00Z', sessionId: 's', runId: 'r1', type: 'run_end', outcome: 'improved' },
    ];

    const retestRank = rankCasesUnified({
      cases: allCases,
      events: mistakeEvents,
      learnerRecommendations: flatLearnerRecs,
      variantsMeta,
      now: new Date('2026-11-03T10:00:00Z'),
    });
    expect(retestRank.topCase?.kind).toBe('retest');
    expect(retestRank.topCase?.caseFile.id).toBe('ards-vent-01--pbw-short-female');
    expect(retestRank.topCase?.learnerReason.toLowerCase()).not.toContain('pbw');
    expect(retestRank.topCase?.learnerReason.toLowerCase()).not.toContain('ards');
  });
});
