/**
 * Pure functions and helpers for the ICU Respiratory Trainer Learning Pathway.
 */
import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import type { ActivityCandidate, CompetencyState, Recommendation, RunSummary } from '../shared/learnerApi';
import type { DrillSet } from '../drills/types';
import type { LabExperiment } from '../lab/schema';
import { deriveEntrustmentLevels } from '../adaptive/entrustment';
import { hasTierCriticalBlocker } from '../adaptive/progression';
import pathwayJson from './pathway.json';
import type {
  LevelProgress,
  LevelUnlockStatus,
  PathwayDefinition,
  PathwayLevel,
} from './types';

export const defaultPathway: PathwayDefinition = pathwayJson as PathwayDefinition;

/**
 * Checks if a competency status is considered independent, mastered, or retained.
 */
export function isCompetencyMasteredOrIndependent(state?: CompetencyState): boolean {
  if (!state) return false;
  return state.status === 'independent' || state.status === 'mastered' || state.status === 'retained';
}

/**
 * Resolves a level input (either level number or level object).
 */
function resolveLevel(
  levelInput: PathwayLevel | number,
  pathway: PathwayDefinition = defaultPathway
): PathwayLevel {
  if (typeof levelInput === 'number') {
    const found = pathway.levels.find(l => l.level === levelInput);
    if (!found) {
      throw new Error(`Pathway level ${levelInput} not found in pathway definition.`);
    }
    return found;
  }
  return levelInput;
}

/**
 * Pure function evaluating whether a level is unlocked.
 *
 * Rules:
 * - If overrideAll is true, always unlocked.
 * - If unlockRule.unlockedByDefault is true, always unlocked.
 * - Otherwise, checks required competencies against competencyStates.
 * - When events are provided for Level 4, EPA Tier 1 entrustment feeds progression:
 *   Tier 1 Indirect/Independent can reinforce Level 4 readiness, while unresolved
 *   critical Tier 1 mistakes block progression into Tier 3 ICU crisis cases until addressed.
 */
export function evaluateLevelUnlock(
  levelInput: PathwayLevel | number,
  competencyStates: CompetencyState[],
  overrideAll = false,
  pathway: PathwayDefinition = defaultPathway,
  events?: LearnerEvent[]
): LevelUnlockStatus {
  const level = resolveLevel(levelInput, pathway);

  if (overrideAll) {
    const reqCount = level.unlockRule.minRequiredCompetencies ?? 0;
    return {
      unlocked: true,
      metCount: reqCount,
      requiredCount: reqCount,
      missingCompetencies: [],
      reason: 'Browse mode override: all activities unlocked.',
    };
  }

  if (level.unlockRule.unlockedByDefault) {
    return {
      unlocked: true,
      metCount: 0,
      requiredCount: 0,
      missingCompetencies: [],
      reason: 'Unlocked by default for all learners.',
    };
  }

  // Determine required competencies
  let required = level.unlockRule.requiredCompetencies;
  if (!required || required.length === 0) {
    if (level.unlockRule.prerequisiteLevel) {
      const prereq = pathway.levels.find(l => l.level === level.unlockRule.prerequisiteLevel);
      required = prereq?.keyCompetencies ?? [];
    } else {
      required = [];
    }
  }

  const minRequired = Math.min(level.unlockRule.minRequiredCompetencies ?? required.length, required.length);
  const stateMap = new Map<string, CompetencyState>(competencyStates.map(s => [s.competency, s]));

  const metComps = required.filter(c => isCompetencyMasteredOrIndependent(stateMap.get(c)));
  const missingComps = required.filter(c => !metComps.includes(c));
  let unlocked = metComps.length >= minRequired;
  let reason = unlocked
    ? `Prerequisites met (${metComps.length}/${minRequired} completed).`
    : `Requires at least ${minRequired} prerequisite competencies (${metComps.length}/${minRequired} met).`;

  if (level.level === 4 && events && events.length > 0) {
    const entrustment = deriveEntrustmentLevels(events);
    const tier1 = entrustment[1];
    const hasCritical = hasTierCriticalBlocker(events, 1);

    if (hasCritical) {
      unlocked = false;
      reason = 'Resolve critical safety mistakes in Tier 1 cases (or complete clean re-test) before unlocking Level 4 crises.';
    } else if (!unlocked && (tier1.level === 'Indirect' || tier1.level === 'Independent')) {
      unlocked = true;
      reason = `Unlocked via Tier 1 clinical entrustment (${tier1.level}) with clean safety record.`;
    }
  }

  return {
    unlocked,
    metCount: metComps.length,
    requiredCount: minRequired,
    missingCompetencies: missingComps,
    reason,
  };
}

/**
 * Convenience helper returning boolean unlock status.
 */
export function isLevelUnlocked(
  levelInput: PathwayLevel | number,
  competencyStates: CompetencyState[],
  overrideAll = false,
  pathway: PathwayDefinition = defaultPathway,
  events?: LearnerEvent[]
): boolean {
  return evaluateLevelUnlock(levelInput, competencyStates, overrideAll, pathway, events).unlocked;
}

/**
 * Pure function computing learner progress within a specific pathway level.
 */
export function computeLevelProgress(
  levelInput: PathwayLevel | number,
  competencyStates: CompetencyState[],
  runs: RunSummary[],
  pathway: PathwayDefinition = defaultPathway
): LevelProgress {
  const level = resolveLevel(levelInput, pathway);

  const totalActivities =
    level.activities.labs.length + level.activities.drills.length + level.activities.cases.length;

  const activityIdSet = new Set<string>([
    ...level.activities.labs,
    ...level.activities.drills,
    ...level.activities.cases,
  ]);

  const completedActivityIds = new Set<string>();
  for (const run of runs) {
    if (activityIdSet.has(run.activityId)) {
      if (run.outcome !== 'abandoned' && run.endedAt !== null) {
        completedActivityIds.add(run.activityId);
      }
    }
  }

  const completedActivities = completedActivityIds.size;

  const totalCompetencies = level.keyCompetencies.length;
  const stateMap = new Map<string, CompetencyState>(competencyStates.map(s => [s.competency, s]));

  const masteredCompetencies = level.keyCompetencies.filter(c =>
    isCompetencyMasteredOrIndependent(stateMap.get(c))
  ).length;

  const activityPercentage =
    totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 100;
  const competencyPercentage =
    totalCompetencies > 0 ? Math.round((masteredCompetencies / totalCompetencies) * 100) : 100;
  const overallPercentage =
    totalActivities > 0 && totalCompetencies > 0
      ? Math.round((activityPercentage + competencyPercentage) / 2)
      : totalActivities > 0
      ? activityPercentage
      : totalCompetencies > 0
      ? competencyPercentage
      : 100;

  return {
    level: level.level,
    totalActivities,
    completedActivities,
    totalCompetencies,
    masteredCompetencies,
    activityPercentage,
    competencyPercentage,
    overallPercentage,
  };
}

/**
 * Builds activity candidates for a given pathway level.
 */
export function buildActivityCandidatesForLevel(
  levelInput: PathwayLevel | number,
  cases: CaseFile[],
  drillSets: DrillSet[],
  labExperiments: LabExperiment[],
  pathway: PathwayDefinition = defaultPathway
): ActivityCandidate[] {
  const level = resolveLevel(levelInput, pathway);
  const candidates: ActivityCandidate[] = [];

  for (const labId of level.activities.labs) {
    const exp = labExperiments.find(e => e.id === labId);
    if (exp) {
      candidates.push({
        activity: 'lab',
        id: exp.id,
        competencies: exp.competencies,
        hiddenCompetencies: [],
        contextTags: exp.contextTags,
        difficulty: exp.difficulty,
      });
    }
  }

  for (const drillId of level.activities.drills) {
    const set = drillSets.find(d => d.id === drillId);
    if (set) {
      candidates.push({
        activity: 'drill',
        id: set.id,
        competencies: set.competencies,
        hiddenCompetencies: [],
        contextTags: [set.id],
        difficulty: set.id === 'waveforms' ? 1 : set.id === 'abg' ? 2 : 3,
      });
    }
  }

  for (const caseId of level.activities.cases) {
    const c = cases.find(cs => cs.id === caseId);
    if (c) {
      candidates.push({
        activity: 'case',
        id: c.id,
        competencies: c.competencies,
        hiddenCompetencies: c.hiddenCompetencies ?? [],
        contextTags: c.contextTags ?? [],
        difficulty: c.difficulty,
      });
    }
  }

  return candidates;
}

/**
 * Filters a list of recommendations from learner.recommend down to those
 * that belong to the specified pathway level.
 */
export function filterRecommendationsForLevel(
  recommendations: Recommendation[],
  levelInput: PathwayLevel | number,
  pathway: PathwayDefinition = defaultPathway
): Recommendation[] {
  const level = resolveLevel(levelInput, pathway);
  const levelActivityIds = new Set<string>([
    ...level.activities.labs,
    ...level.activities.drills,
    ...level.activities.cases,
  ]);
  return recommendations.filter(r => levelActivityIds.has(r.id));
}

/**
 * Determines the current active level for a learner.
 * Returns the lowest unlocked level that is not yet 100% complete,
 * or the highest unlocked level if all unlocked levels are complete.
 */
export function getActiveLevel(
  competencyStates: CompetencyState[],
  runs: RunSummary[],
  overrideAll = false,
  pathway: PathwayDefinition = defaultPathway,
  events?: LearnerEvent[]
): PathwayLevel {
  const unlockedLevels: PathwayLevel[] = [];

  for (const level of pathway.levels) {
    const isUnlocked = isLevelUnlocked(level, competencyStates, overrideAll, pathway, events);
    if (isUnlocked) {
      unlockedLevels.push(level);
      const progress = computeLevelProgress(level, competencyStates, runs, pathway);
      if (progress.overallPercentage < 100) {
        return level;
      }
    }
  }

  if (unlockedLevels.length > 0) {
    return unlockedLevels[unlockedLevels.length - 1];
  }

  return pathway.levels[0];
}
