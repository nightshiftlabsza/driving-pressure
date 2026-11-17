/**
 * Types and interfaces for the ICU Respiratory Trainer Learning Pathway.
 */
import type { ActivityKind } from '../shared/events';
import type { ActivityCandidate, CompetencyState, Recommendation, RunSummary } from '../shared/learnerApi';

export type PathwayActivityType = ActivityKind; // 'case' | 'drill' | 'lab'

export interface PathwayActivityRef {
  type: PathwayActivityType;
  id: string;
}

export interface PathwayUnlockRule {
  unlockedByDefault?: boolean;
  prerequisiteLevel?: number;
  requiredCompetencies?: string[];
  minRequiredCompetencies?: number;
  description: string;
}

export interface PathwayLevelActivities {
  labs: string[];
  drills: string[];
  cases: string[];
}

export interface PathwayLevel {
  level: number;
  name: string;
  scope: string;
  description: string;
  keyCompetencies: string[];
  unlockRule: PathwayUnlockRule;
  activities: PathwayLevelActivities;
}

export interface PathwayDefinition {
  version: string;
  title: string;
  description: string;
  levels: PathwayLevel[];
}

export interface LevelUnlockStatus {
  unlocked: boolean;
  metCount: number;
  requiredCount: number;
  missingCompetencies: string[];
  reason: string;
}

export interface LevelProgress {
  level: number;
  totalActivities: number;
  completedActivities: number;
  totalCompetencies: number;
  masteredCompetencies: number;
  activityPercentage: number;
  competencyPercentage: number;
  overallPercentage: number;
}
