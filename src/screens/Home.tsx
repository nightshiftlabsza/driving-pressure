import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import type { LearnerApi, CompetencyState, Recommendation, RunSummary } from '../shared/learnerApi';
import type { DrillSet } from '../drills/types';
import type { LabExperiment } from '../lab/schema';
import type { CaseVariantMetadata } from '../cases/variants/loader';
import competenciesJson from '../shared/competencies.json';
import {
  defaultPathway,
  evaluateLevelUnlock,
  computeLevelProgress,
  buildActivityCandidatesForLevel,
  filterRecommendationsForLevel,
  getActiveLevel,
  isCompetencyMasteredOrIndependent,
} from '../pathway/unlock';
import type { PathwayLevel, PathwayActivityType } from '../pathway/types';
import { deriveEntrustmentLevels } from '../adaptive/entrustment';
import { readLearnerEvents } from '../adaptive/learnerEvents';
import { rankCasesUnified } from '../adaptive/progression';
import { getPresentationTitle } from './CaseLibrary';
import { DueTodayStrip } from './DueTodayStrip';
import { buildPathwayContext } from '../tutor/context';

export interface HomeProps {
  learner: LearnerApi;
  catalogCases: CaseFile[];
  drillSets: DrillSet[];
  labExperiments: LabExperiment[];
  variantsMeta?: Record<string, CaseVariantMetadata>;
  onStartCase: (c: CaseFile) => void;
  onStartDrill: (s: DrillSet) => void;
  onStartLab: (exp: LabExperiment) => void;
}

const CASE_TITLE_FALLBACKS: Record<string, { title: string; summary: string }> = {
  'copd-niv-01': { title: 'Breathless at 3 a.m. on the respiratory ward', summary: 'COPD acute hypercapnic respiratory failure' },
  'apo-cpap-01': { title: 'Acute cardiogenic pulmonary oedema in ED', summary: 'Acute cardiogenic pulmonary oedema responding to CPAP' },
  'pneumonia-hfnc-01': { title: 'Severe hypoxaemia on a non-rebreather in the ED', summary: 'Hypoxaemic respiratory failure and ROX index monitoring' },
  'copd-psv-trigger-01': { title: 'Deteriorating COPD on pressure support ventilation', summary: 'Ineffective triggering from dynamic hyperinflation and auto-PEEP' },
  'dka-intubated-01': { title: 'DKA patient intubated after severe aspiration', summary: 'Profound metabolic acidosis requiring matched minute ventilation' },
  'ards-vent-01': { title: 'Severe ARDS from septic shock', summary: 'Lung-protective ventilation with low tidal volume and driving pressure' },
  'asthma-vent-01': { title: 'Life-threatening asthma crisis', summary: 'Severe bronchospasm, dynamic hyperinflation and permissive hypercapnia' },
  'vent-high-pressure-01': { title: 'High airway pressure alarm in medical ICU', summary: 'Differentiating resistance vs compliance crisis' },
  'sbt-pass-01': { title: 'Spontaneous breathing trial: extubation readiness', summary: 'Recovering pneumonia patient meeting liberation criteria' },
  'sbt-fail-01': { title: 'Spontaneous breathing trial: rapid shallow breathing failure', summary: 'Early fatigue and RSBI exceeding 105 during SBT' },
  'dyssynchrony-01': { title: 'Patient-ventilator dyssynchrony at 2 a.m.', summary: 'Severe double triggering and flow starvation corrected by settings' },
};

function getCompetencyName(id: string): string {
  for (const domain of competenciesJson.domains) {
    const comp = domain.competencies.find(c => c.id === id);
    if (comp) return comp.name;
  }
  return id;
}

/**
 * Strips any hidden competency terms from recommendation rationale
 * so hidden assessments are never leaked to the learner.
 */
function sanitizeReasons(reasons: string[], hiddenComps: string[]): string[] {
  if (!hiddenComps || hiddenComps.length === 0) return reasons;
  const terms: string[] = [];
  for (const hid of hiddenComps) {
    terms.push(hid.toLowerCase());
    const name = getCompetencyName(hid);
    if (name) terms.push(name.toLowerCase());
  }
  return reasons.filter(r => {
    const lower = r.toLowerCase();
    return !terms.some(t => t.length > 0 && lower.includes(t));
  });
}

const EMPTY_VARIANTS_META: Record<string, CaseVariantMetadata> = {};

export const Home: React.FC<HomeProps> = ({
  learner,
  catalogCases,
  drillSets,
  labExperiments,
  variantsMeta = EMPTY_VARIANTS_META,
  onStartCase,
  onStartDrill,
  onStartLab,
}) => {
  const [states, setStates] = useState<CompetencyState[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [events, setEvents] = useState<LearnerEvent[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [caseRecommendations, setCaseRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Browse mode override toggle: stored in localStorage
  const [browseMode, setBrowseMode] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('ovs-browse-mode') === 'true';
      }
    } catch { /* storage blocked */ }
    return false;
  });

  const toggleBrowseMode = useCallback(() => {
    setBrowseMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('ovs-browse-mode', String(next));
      } catch { /* storage blocked */ }
      return next;
    });
  }, []);

  // Fetch learner states, runs, and raw events for entrustment & adaptive re-tests
  const reloadData = useCallback(async () => {
    if (!learner) return;
    try {
      setIsLoading(true);
      const [st, rn, evs] = await Promise.all([
        learner.getCompetencyStates(),
        learner.listRuns(100),
        readLearnerEvents(learner),
      ]);
      setStates(st);
      setRuns(rn);
      setEvents(evs);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [learner]);

  useEffect(() => {
    reloadData();
    const handleUpdate = () => reloadData();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleUpdate);
      window.addEventListener('ovs-learner-updated', handleUpdate);
      return () => {
        window.removeEventListener('focus', handleUpdate);
        window.removeEventListener('ovs-learner-updated', handleUpdate);
      };
    }
  }, [reloadData]);

  const entrustmentByTier = useMemo(() => deriveEntrustmentLevels(events), [events]);

  // Compute active level
  const activeLevel = useMemo(() => {
    return getActiveLevel(states, runs, browseMode, defaultPathway, events);
  }, [states, runs, browseMode, events]);

  // Change A: which levels are expanded. null = default behaviour (only the
  // learner's CURRENT level is open); a Set takes over after the first toggle.
  // Collapse behaves identically in browse mode and normal mode; browse mode
  // only changes what is unlocked.
  const [openLevels, setOpenLevels] = useState<Set<number> | null>(null);
  // Change A: per-level "Target Competencies" checklist disclosure, hidden by default.
  const [openChecklists, setOpenChecklists] = useState<Set<number>>(() => new Set());

  const isLevelOpen = useCallback(
    (level: number, isCurrent: boolean) =>
      openLevels === null ? isCurrent : openLevels.has(level),
    [openLevels]
  );

  const toggleLevelOpen = useCallback((level: number) => {
    setOpenLevels(prev => {
      // First toggle seeds the set with the level that was open by default (the
      // current one), so expanding another level does not collapse it.
      const base = prev ?? new Set<number>([activeLevel.level]);
      const next = new Set(base);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, [activeLevel.level]);

  const toggleChecklist = useCallback((level: number) => {
    setOpenChecklists(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  // Request recommendations for the active level AND unified case pool
  useEffect(() => {
    let active = true;
    if (!learner || !activeLevel) return;

    const candidates = buildActivityCandidatesForLevel(
      activeLevel,
      catalogCases,
      drillSets,
      labExperiments,
      defaultPathway
    );

    if (candidates.length === 0) {
      setRecommendations([]);
    } else {
      learner
        .recommend(candidates)
        .then(recs => {
          if (active) {
            const filtered = filterRecommendationsForLevel(recs, activeLevel, defaultPathway);
            setRecommendations(filtered);
          }
        })
        .catch(err => {
          console.warn('Failed to load pathway recommendations:', err);
        });
    }

    const caseCandidates = catalogCases.map(c => ({
      activity: 'case' as const,
      id: c.id,
      competencies: c.competencies,
      hiddenCompetencies: c.hiddenCompetencies ?? [],
      contextTags: c.contextTags ?? [],
      difficulty: c.difficulty,
    }));

    if (caseCandidates.length === 0) {
      setCaseRecommendations([]);
    } else {
      learner
        .recommend(caseCandidates)
        .then(recs => {
          if (active) setCaseRecommendations(recs);
        })
        .catch(() => {
          if (active) setCaseRecommendations([]);
        });
    }

    return () => {
      active = false;
    };
  }, [learner, activeLevel, catalogCases, drillSets, labExperiments]);

  const completedRunsSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      if (r.outcome !== 'abandoned' && r.endedAt !== null) {
        set.add(r.activityId);
        if (r.activityId.includes('--')) {
          set.add(r.activityId.split('--')[0]!);
        }
      }
    }
    return set;
  }, [runs]);

  const unifiedCaseRec = useMemo(() => {
    return rankCasesUnified({
      cases: catalogCases,
      events,
      learnerRecommendations: caseRecommendations,
      variantsMeta,
      browseMode,
    });
  }, [catalogCases, events, caseRecommendations, variantsMeta, browseMode]);

  // Find top recommended activity using the ONE unified progression + entrustment rule
  const topRecommended = useMemo(() => {
    // Urgent spaced clinical re-test (disguised variant) takes top priority once unlocked or in browse mode
    if (
      unifiedCaseRec.topCase &&
      unifiedCaseRec.topCase.kind === 'retest' &&
      (browseMode || activeLevel.level >= 3)
    ) {
      const sc = unifiedCaseRec.topCase.caseFile;
      return {
        type: 'case' as const,
        id: sc.id,
        title: getPresentationTitle(sc, completedRunsSet.has(sc.id)),
        description: sc.summary,
        reasons: sanitizeReasons(unifiedCaseRec.topCase.reasons, sc.hiddenCompetencies ?? []),
        launch: () => onStartCase(sc),
      };
    }

    if (recommendations.length === 0) return null;
    const rec = recommendations[0];
    const recId = rec.id;

    // Check labs
    const lab = labExperiments.find(e => e.id === recId);
    if (lab) {
      return {
        type: 'lab' as const,
        id: lab.id,
        title: lab.title,
        description: lab.subtitle || 'Targeted respiratory physiology simulation.',
        reasons: sanitizeReasons(rec.reasons, []),
        launch: () => onStartLab(lab),
      };
    }

    // Check drills
    const drill = drillSets.find(d => d.id === recId);
    if (drill) {
      return {
        type: 'drill' as const,
        id: drill.id,
        title: drill.title,
        description: drill.description,
        reasons: sanitizeReasons(rec.reasons, []),
        launch: () => onStartDrill(drill),
      };
    }

    // When active level recommends a case, keep it aligned with unified Tier Entrustment ranking
    const levelCaseIds = new Set(activeLevel.activities.cases);
    const levelUnified = rankCasesUnified({
      cases: catalogCases.filter(cs => levelCaseIds.has(cs.id)),
      events,
      learnerRecommendations: recommendations.filter(r => levelCaseIds.has(r.id)),
      variantsMeta,
      browseMode,
    }).topCase;

    const chosenCase = levelUnified?.caseFile ?? catalogCases.find(cs => cs.id === recId);
    if (chosenCase) {
      return {
        type: 'case' as const,
        id: chosenCase.id,
        title: getPresentationTitle(chosenCase, completedRunsSet.has(chosenCase.id)),
        description: chosenCase.summary,
        reasons: sanitizeReasons(levelUnified?.reasons ?? rec.reasons, chosenCase.hiddenCompetencies ?? []),
        launch: () => onStartCase(chosenCase),
      };
    }

    // Fallback if case in library is not yet loaded into catalogCases
    const fallback = CASE_TITLE_FALLBACKS[recId];
    if (fallback) {
      return {
        type: 'case' as const,
        id: recId,
        title: fallback.title,
        description: fallback.summary,
        reasons: sanitizeReasons(rec.reasons, []),
        launch: null,
      };
    }

    return null;
  }, [
    recommendations,
    unifiedCaseRec,
    browseMode,
    activeLevel,
    completedRunsSet,
    events,
    variantsMeta,
    labExperiments,
    drillSets,
    catalogCases,
    onStartLab,
    onStartDrill,
    onStartCase,
  ]);

  // Helper to start an activity from the level list
  const handleLaunch = useCallback(
    (type: PathwayActivityType, id: string) => {
      if (type === 'lab') {
        const exp = labExperiments.find(e => e.id === id);
        if (exp) onStartLab(exp);
      } else if (type === 'drill') {
        const set = drillSets.find(s => s.id === id);
        if (set) onStartDrill(set);
      } else if (type === 'case') {
        const c = catalogCases.find(cs => cs.id === id);
        if (c) onStartCase(c);
      }
    },
    [labExperiments, drillSets, catalogCases, onStartLab, onStartDrill, onStartCase]
  );

  const stateMap = useMemo(() => {
    return new Map<string, CompetencyState>(states.map(s => [s.competency, s]));
  }, [states]);

  return (
    <div className="vt-page p-4 sm:p-6" data-testid="pathway-home">
      {/* Due today: spaced-review cards and retests that are due, from the same selector the Practice screen uses. */}
      <DueTodayStrip
        learner={learner}
        onOpenPractice={() => { window.location.hash = '#/trainer?view=practice'; }}
      />
      {/* Header and Hero Banner */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--line)' }}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Curriculum Pathway</h1>
            <span className="vt-badge" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>
              Level {activeLevel.level} of 4
            </span>
          </div>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-2)' }}>
            Progressive clinical training from basic ventilator literacy to acute ICU management.
          </p>
        </div>

        {/* Browse Mode Override Toggle */}
        <div className="flex items-center gap-3 self-start md:self-center shrink-0">
          <button
            type="button"
            data-testid="toggle-browse-mode"
            aria-pressed={browseMode}
            onClick={toggleBrowseMode}
            className={`vt-btn text-xs !py-1.5 !px-3 font-medium transition-colors ${
              browseMode ? 'vt-btn--secondary' : 'vt-btn--quiet'
            }`}
            title="Browse mode unlocks all curriculum levels and activities immediately without prerequisite checks."
          >
            {browseMode ? '✓ Browse mode active (all unlocked)' : 'Browse mode (unlock all)'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 text-xs p-3 rounded" style={{ background: 'var(--alarm-med)', color: 'var(--alarm-med-ink)' }}>
          {loadError}
        </div>
      )}

      {/* Recommended Next Activity Card */}
      {topRecommended && (
        <div
          data-testid="home-recommended-card"
          className="mb-8 rounded-lg p-5 border relative overflow-hidden transition-all shadow-sm"
          style={{
            borderColor: 'var(--sel)',
            background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="vt-badge text-[11px] font-bold uppercase tracking-wider px-2 py-0.5"
                  style={{
                    background: 'var(--sel)',
                    color: 'var(--primary-ink)',
                  }}
                >
                  Recommended Next
                </span>
                <span className="vt-badge text-[11px] uppercase" style={{ color: 'var(--text-3)', background: 'var(--surface-3)' }}>
                  {topRecommended.type}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold mb-1" style={{ color: 'var(--text)' }}>
                {topRecommended.title}
              </h2>
              <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
                {topRecommended.description}
              </p>
              {topRecommended.reasons.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-2)' }}>Why:</span>
                  {topRecommended.reasons.map((r, i) => (
                    <span key={i} className="inline-block px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-3)' }}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 self-start sm:self-center">
              {topRecommended.launch ? (
                <button
                  type="button"
                  data-testid="btn-start-recommended"
                  onClick={topRecommended.launch}
                  className="vt-btn vt-btn--primary !px-5 !py-2 font-bold text-sm shadow-md"
                >
                  Start Activity →
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="vt-btn vt-btn--quiet !px-4 !py-2 text-xs opacity-60 cursor-not-allowed"
                >
                  In preparation
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Curriculum Levels Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide uppercase" style={{ color: 'var(--text-2)' }}>
            Curriculum Stages
          </h2>
          <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
            {browseMode ? 'Browse mode: unrestricted' : 'Progression: locked until mastery'}
          </span>
        </div>

        <div className="space-y-4">
          {defaultPathway.levels.map(lvl => {
            const unlockStatus = evaluateLevelUnlock(lvl, states, browseMode, defaultPathway, events);
            const progress = computeLevelProgress(lvl, states, runs, defaultPathway);
            const isCurrentActive = lvl.level === activeLevel.level;
            const isCompleted = progress.overallPercentage === 100;
            const tierBadge =
              lvl.level === 3
                ? `Tier 1 Entrustment: ${entrustmentByTier[1].level}`
                : lvl.level === 4
                ? `Tier 2 Entrustment: ${entrustmentByTier[2].level}`
                : null;

            const isOpen = isLevelOpen(lvl.level, isCurrentActive);
            const checklistOpen = openChecklists.has(lvl.level);

            return (
              <div
                key={lvl.level}
                data-testid={`pathway-level-${lvl.level}`}
                className="rounded-lg border transition-all"
                style={{
                  borderColor: isCurrentActive ? 'var(--sel)' : 'var(--line)',
                  background: 'var(--surface)',
                }}
              >
                {!isOpen ? (
                  <button
                    type="button"
                    data-testid={`pathway-level-toggle-${lvl.level}`}
                    aria-expanded={false}
                    aria-controls={`pathway-level-body-${lvl.level}`}
                    onClick={() => toggleLevelOpen(lvl.level)}
                    className="w-full text-left p-3 sm:p-4 flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>▶</span>
                      <span className="font-semibold text-sm truncate">Level {lvl.level}: {lvl.name}</span>
                      {!unlockStatus.unlocked && (
                        <span className="vt-badge text-[11px]" style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>
                          🔒 Locked
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-3)' }}>
                      {progress.overallPercentage}%
                    </span>
                  </button>
                ) : (
                  <>
                {/* Level Header Bar */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b" style={{ borderColor: 'var(--line)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-base sm:text-lg">
                        Level {lvl.level}: {lvl.name}
                      </span>
                      {tierBadge && (
                        <span className="vt-badge text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                          {tierBadge}
                        </span>
                      )}
                      {isCurrentActive && (
                        <span className="vt-badge text-[11px] font-bold" style={{ background: 'var(--sel)', color: 'var(--primary-ink)' }}>
                          Active
                        </span>
                      )}
                      {isCompleted && (
                        <span className="vt-badge text-[11px] font-bold" style={{ background: 'var(--ok)', color: '#000' }}>
                          ✓ Completed
                        </span>
                      )}
                      {!unlockStatus.unlocked && (
                        <span className="vt-badge text-[11px] font-bold" style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>
                          🔒 Locked
                        </span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                      <strong className="font-medium text-[var(--text)]">Scope:</strong> {lvl.scope}
                    </p>
                  </div>

                  {/* Progress Indicator */}
                  <div className="w-full md:w-56 shrink-0 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span style={{ color: 'var(--text-3)' }}>Progress</span>
                      <span className="font-bold" style={{ color: isCompleted ? 'var(--ok)' : 'var(--text)' }}>
                        {progress.overallPercentage}%
                      </span>
                    </div>
                    {/* Clean progress bar */}
                    <div
                      role="progressbar"
                      aria-valuenow={progress.overallPercentage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="w-full h-2 rounded-full overflow-hidden"
                      style={{ background: 'var(--surface-3)' }}
                    >
                      <div
                        className="h-full transition-all duration-300 rounded-full"
                        style={{
                          width: `${progress.overallPercentage}%`,
                          background: isCompleted ? 'var(--ok)' : 'var(--act)',
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
                      <span>{progress.completedActivities}/{progress.totalActivities} activities</span>
                      <span>{progress.masteredCompetencies}/{progress.totalCompetencies} mastered</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`pathway-level-toggle-${lvl.level}`}
                    aria-expanded={true}
                    aria-controls={`pathway-level-body-${lvl.level}`}
                    onClick={() => toggleLevelOpen(lvl.level)}
                    className="vt-btn vt-btn--quiet shrink-0 self-center text-xs !py-1 !px-2"
                  >
                    ▲ Collapse
                  </button>
                </div>

                {/* Level Details & Activities Body */}
                <div id={`pathway-level-body-${lvl.level}`} className="p-4 sm:p-5 space-y-4">
                  {/* Unlock Requirement Banner when level is locked */}
                  {!unlockStatus.unlocked && (
                    <div
                      className="p-3 rounded text-xs flex items-center gap-2"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
                    >
                      <span className="text-base">🔒</span>
                      <div>
                        <span className="font-semibold text-[var(--text)]">Unlock Requirement: </span>
                        {unlockStatus.reason}
                        <div className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Complete prerequisite activities in previous levels to advance, or enable <em>Browse mode</em> above.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Key Competencies Summary: 2-column architectural checklist */}
                  <div className="mb-4">
                    <button
                      type="button"
                      data-testid={`pathway-level-checklist-toggle-${lvl.level}`}
                      aria-expanded={checklistOpen}
                      aria-controls={`pathway-level-checklist-${lvl.level}`}
                      onClick={() => toggleChecklist(lvl.level)}
                      className="text-[10px] font-mono font-semibold uppercase tracking-wider block mb-2 vt-btn vt-btn--quiet"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {checklistOpen ? '▾' : '▸'} Target Competencies
                    </button>
                    {checklistOpen && (
                    <div id={`pathway-level-checklist-${lvl.level}`} className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 py-1">
                      {lvl.keyCompetencies.map(compId => {
                        const st = stateMap.get(compId);
                        const mastered = isCompetencyMasteredOrIndependent(st);
                        return (
                          <div
                            key={compId}
                            className="flex items-center gap-2 text-xs py-0.5"
                            style={{ color: mastered ? 'var(--text)' : 'var(--text-2)' }}
                            title={`${compId}: ${getCompetencyName(compId)} (${st?.status || 'not_seen'})`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-xs flex items-center justify-center text-[10px] shrink-0 border"
                              style={{
                                borderColor: mastered ? 'var(--ok)' : 'var(--line-strong)',
                                background: mastered ? 'var(--ok)' : 'transparent',
                                color: mastered ? '#ffffff' : 'var(--text-3)',
                              }}
                            >
                              {mastered ? '✓' : '·'}
                            </span>
                            <span className="truncate">{getCompetencyName(compId)}</span>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>

                  {/* Activities List */}
                  <div className="space-y-3">
                    {/* Physiology Labs */}
                    {lvl.activities.labs.length > 0 && (
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-3)' }}>
                          Physiology Labs
                        </span>
                        <div className="divide-y rounded border vt-list-cols" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                          {lvl.activities.labs.map(labId => {
                            const exp = labExperiments.find(e => e.id === labId);
                            const isDone = completedRunsSet.has(labId);
                            const isLocked = !unlockStatus.unlocked && !browseMode;

                            return (
                              <div key={labId} className="p-3 flex items-center justify-between gap-3 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">
                                      {exp?.title || labId}
                                    </span>
                                    {isDone && (
                                      <span className="vt-badge" style={{ background: 'var(--ok)', color: '#000', fontSize: '10px' }}>
                                        Done
                                      </span>
                                    )}
                                    {isLocked && (
                                      <span className="vt-badge" style={{ background: 'var(--surface-3)', color: 'var(--text-3)', fontSize: '10px' }}>
                                        🔒 Locked
                                      </span>
                                    )}
                                  </div>
                                  {exp?.subtitle && (
                                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                                      {exp.subtitle}
                                    </p>
                                  )}
                                </div>
                                {isLocked ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="vt-btn vt-btn--quiet shrink-0 text-xs !py-1 !px-3 opacity-50 cursor-not-allowed"
                                    title={`Requires Level ${lvl.level} unlock or Browse mode`}
                                  >
                                    Locked 🔒
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={`vt-btn shrink-0 text-xs !py-1 !px-3 ${isDone ? 'vt-btn--quiet' : 'vt-btn--primary'}`}
                                    onClick={() => handleLaunch('lab', labId)}
                                  >
                                    {isDone ? 'Review' : 'Start'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Drills */}
                    {lvl.activities.drills.length > 0 && (
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-3)' }}>
                          Clinical Drills
                        </span>
                        <div className="divide-y rounded border vt-list-cols" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                          {lvl.activities.drills.map(drillId => {
                            const set = drillSets.find(s => s.id === drillId);
                            const isDone = completedRunsSet.has(drillId);
                            const isLocked = !unlockStatus.unlocked && !browseMode;

                            return (
                              <div key={drillId} className="p-3 flex items-center justify-between gap-3 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">
                                      {set?.title || `${drillId.toUpperCase()} Drill`}
                                    </span>
                                    {isDone && (
                                      <span className="vt-badge" style={{ background: 'var(--ok)', color: '#000', fontSize: '10px' }}>
                                        Done
                                      </span>
                                    )}
                                    {isLocked && (
                                      <span className="vt-badge" style={{ background: 'var(--surface-3)', color: 'var(--text-3)', fontSize: '10px' }}>
                                        🔒 Locked
                                      </span>
                                    )}
                                  </div>
                                  {set?.description && (
                                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                                      {set.description}
                                    </p>
                                  )}
                                </div>
                                {isLocked ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="vt-btn vt-btn--quiet shrink-0 text-xs !py-1 !px-3 opacity-50 cursor-not-allowed"
                                    title={`Requires Level ${lvl.level} unlock or Browse mode`}
                                  >
                                    Locked 🔒
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={`vt-btn shrink-0 text-xs !py-1 !px-3 ${isDone ? 'vt-btn--quiet' : 'vt-btn--primary'}`}
                                    onClick={() => handleLaunch('drill', drillId)}
                                  >
                                    {isDone ? 'Review' : 'Start'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Clinical Cases */}
                    {lvl.activities.cases.length > 0 && (
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-3)' }}>
                          Clinical Cases
                        </span>
                        <div className="divide-y rounded border vt-list-cols" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                          {lvl.activities.cases.map(caseId => {
                            const c = catalogCases.find(cs => cs.id === caseId);
                            const fallback = CASE_TITLE_FALLBACKS[caseId];
                            const isDone = completedRunsSet.has(caseId);
                            const title = c ? getPresentationTitle(c, isDone) : fallback?.title || caseId;
                            const summary = c?.summary || fallback?.summary;
                            const canLaunch = !!c;
                            const isLocked = !unlockStatus.unlocked && !browseMode;

                            return (
                              <div key={caseId} className="p-3 flex items-center justify-between gap-3 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">{title}</span>
                                    {isDone && (
                                      <span className="vt-badge" style={{ background: 'var(--ok)', color: '#000', fontSize: '10px' }}>
                                        Done
                                      </span>
                                    )}
                                    {isLocked && (
                                      <span className="vt-badge" style={{ background: 'var(--surface-3)', color: 'var(--text-3)', fontSize: '10px' }}>
                                        🔒 Locked
                                      </span>
                                    )}
                                  </div>
                                  {summary && (
                                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                                      {summary}
                                    </p>
                                  )}
                                </div>
                                {isLocked ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="vt-btn vt-btn--quiet shrink-0 text-xs !py-1 !px-3 opacity-50 cursor-not-allowed"
                                    title={`Requires Level ${lvl.level} unlock or Browse mode`}
                                  >
                                    Locked 🔒
                                  </button>
                                ) : canLaunch ? (
                                  <button
                                    type="button"
                                    className={`vt-btn shrink-0 text-xs !py-1 !px-3 ${isDone ? 'vt-btn--quiet' : 'vt-btn--primary'}`}
                                    onClick={() => handleLaunch('case', caseId)}
                                  >
                                    {isDone ? 'Review' : 'Start'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="vt-btn vt-btn--quiet shrink-0 text-xs !py-1 !px-3 opacity-50 cursor-not-allowed"
                                    title="Case currently in preparation"
                                  >
                                    Pending
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
