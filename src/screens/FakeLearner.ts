import type { LearnerApi, CompetencyState, RunSummary, ActivityCandidate, Recommendation, CompetencyStatus } from '../shared/learnerApi';
import type { LearnerEvent, GuidanceLevel } from '../shared/events';
import competenciesJson from '../shared/competencies.json';

export function createDefaultCompetencyStates(): CompetencyState[] {
  const allCompetencies = competenciesJson.domains.flatMap(d => d.competencies);
  return allCompetencies.map(c => ({
    competency: c.id,
    status: 'not_seen' as CompetencyStatus,
    guidance: 'guided' as GuidanceLevel,
    guidanceOverride: null,
    dueAt: null,
    intervalDays: null,
    evidenceCount: 0,
    correctCount: 0,
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
  }));
}

export class FakeLearner implements LearnerApi {
  private states: CompetencyState[];
  private runs: Map<string, RunSummary> = new Map();
  private events: LearnerEvent[] = [];
  private cannedRecommendations: Recommendation[] | null = null;
  public resetCallCount = 0;
  public importedJson: string | null = null;
  public setGuidanceOverrideCalls: Array<{ competency: string; level: GuidanceLevel | null }> = [];

  constructor(initialStates?: CompetencyState[]) {
    this.states = initialStates ?? createDefaultCompetencyStates();
  }

  public setStates(states: CompetencyState[]): void {
    this.states = [...states];
  }

  public setRun(run: RunSummary): void {
    this.runs.set(run.runId, run);
  }

  public setRecommendations(recs: Recommendation[]): void {
    this.cannedRecommendations = [...recs];
  }

  public getRecordedEvents(): LearnerEvent[] {
    return [...this.events];
  }

  async record(e: LearnerEvent): Promise<void> {
    this.events.push(e);
  }

  async getCompetencyStates(_now?: Date): Promise<CompetencyState[]> {
    return JSON.parse(JSON.stringify(this.states)) as CompetencyState[];
  }

  async setGuidanceOverride(competency: string, level: GuidanceLevel | null): Promise<void> {
    this.setGuidanceOverrideCalls.push({ competency, level });
    const match = this.states.find(s => s.competency === competency);
    if (match) {
      match.guidanceOverride = level;
      if (level !== null) {
        match.guidance = level;
      }
    }
  }

  async getRun(runId: string): Promise<RunSummary | null> {
    const run = this.runs.get(runId);
    return run ? JSON.parse(JSON.stringify(run)) : null;
  }

  async listRuns(_limit?: number): Promise<RunSummary[]> {
    return Array.from(this.runs.values());
  }

  async recommend(candidates: ActivityCandidate[], _now?: Date): Promise<Recommendation[]> {
    if (this.cannedRecommendations) {
      return [...this.cannedRecommendations];
    }

    // Default basic recommendation: prioritize first candidate with a realistic reason
    return candidates.map((cand, index) => {
      const topDomain = cand.competencies[0]?.split('.')[0] ?? 'General';
      return {
        id: cand.id,
        score: Math.max(0.1, 1 - index * 0.15),
        reasons: index === 0 ? [`${topDomain} is recommended for your current learning path`] : [],
      };
    });
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      format: 'ovs-learner',
      version: 1,
      exportedAt: new Date().toISOString(),
      events: this.events,
      states: this.states,
    });
  }

  async importJson(json: string): Promise<void> {
    this.importedJson = json;
    const parsed = JSON.parse(json) as { states?: CompetencyState[]; events?: LearnerEvent[] };
    if (parsed.states && Array.isArray(parsed.states)) {
      this.states = parsed.states;
    }
    if (parsed.events && Array.isArray(parsed.events)) {
      this.events = parsed.events;
    }
  }

  async resetAll(): Promise<void> {
    this.resetCallCount++;
    this.events = [];
    this.runs.clear();
    this.states = createDefaultCompetencyStates();
    this.setGuidanceOverrideCalls = [];
  }
}
